import { Router, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { authenticate, authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { enqueueJob, jobSelect, jobPayload } from '../services/jobQueue.service';
import { getReportRange } from '../services/reportDates.service';
import { exportPath } from '../services/queuedExport.service';
import { recordOperation } from '../services/operationReceipt.service';
import { requestHash } from '../services/managerApproval.service';
const router = Router();
router.use(authenticate, authorize('ADMIN', 'SUPER_ADMIN'));
const scope = (req: AuthRequest) => {
  if(req.user!.role==='SUPER_ADMIN')return{kind:'WEBHOOK'};
  if(!req.user!.locationId)throw new AppError('An assigned store is required',403);
  return{locationId:req.user!.locationId,kind:{in:['EMAIL','EXPORT']}};
};
const pageOf = (value: unknown) => z.coerce.number().int().min(1).max(100000).parse(value || 1);
const publicResult = (job: any) => {const {payload:privatePayload,idempotencyKey,...visible}=job;return{...visible,result:job.result?Object.fromEntries(Object.entries(job.result).filter(([key])=>key!=='artifactKey')):null};};
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = pageOf(req.query.page), where = scope(req);
  const [jobs, total, counts, oldest] = await prisma.$transaction([
    prisma.backgroundJob.findMany({ where, select: jobSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, skip: (page - 1) * 50 }),
    prisma.backgroundJob.count({ where }),
    prisma.backgroundJob.groupBy({ by: ['status'], where, orderBy: { status: 'asc' }, _count: { _all: true } }),
    prisma.backgroundJob.findFirst({ where: { ...where, status: { in: ['QUEUED','RETRY'] } }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  res.json({ success: true, data: { jobs: jobs.map(publicResult), pagination: { page, total, totalPages: Math.ceil(total / 50) },
    counts: Object.fromEntries(counts.map(row => [row.status, typeof row._count === 'object' ? row._count._all || 0 : 0])), oldestWaitingAt: oldest?.createdAt || null,
    workerDisabled: process.env.BACKGROUND_WORKER_DISABLED === 'true' || process.env.NODE_ENV === 'test' } });
}));
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await prisma.backgroundJob.findFirst({ where: { ...scope(req), id: req.params.id }, select: { ...jobSelect,payload:true,idempotencyKey:true,history: { select: { number:true,startedAt:true,finishedAt:true,outcome:true,code:true }, orderBy: { number: 'desc' } } } });
  if (!job) throw new AppError('Job not found',404);
  let destination:string|null=null;
  try{const payload=jobPayload(job);destination=job.kind==='EMAIL'?payload.to:job.kind==='WEBHOOK'?payload.url:null;}catch{destination='Unavailable: restore the job encryption key.';}
  res.json({ success: true, data: {...publicResult(job),destination,providerCorrelationId:job.id} });
}));
router.post('/exports', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = z.object({ idempotencyKey:z.string().uuid(), type:z.enum(['SALES_ACTIVITY','INVENTORY','EXPENSES']), startDate:z.string().min(1),endDate:z.string().min(1) }).strict().parse(req.body);
  const result = await recordOperation(req, 'EXPORT_REQUEST', input.type, input.idempotencyKey, input, async tx => {
    const period = await getReportRange({ locationId: req.user!.locationId! }, input.startDate, input.endDate);
    if (!period.start || period.end.getTime() - period.start.getTime() > 367 * 86400000) throw new AppError('Select at most 366 store dates per export',400);
    if (!period.endExclusive) throw new AppError('Use store calendar dates for queued exports',400);
    return enqueueJob(tx, { kind:'EXPORT',idempotencyKey:'export:'+input.idempotencyKey,requestedBy:req.user!.id,locationId:req.user!.locationId!,label:input.type.replace(/_/g,' ')+' CSV',
      payload:{ type:input.type,start:period.start.toISOString(),end:period.end.toISOString(),timezone:period.timezone } });
  });
  res.status(202).json({success:true,...result});
}));
router.post('/:id/retry', asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = z.object({ idempotencyKey:z.string().uuid(), expectedAttempts:z.number().int().nonnegative(), reason:z.string().trim().min(1).max(500),confirmedNotDelivered:z.boolean().default(false) }).strict().parse(req.body);
  const job = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${'job-control:'+input.idempotencyKey}))`;
    await tx.$queryRaw`SELECT id FROM background_jobs WHERE id = ${req.params.id} FOR UPDATE`;
    const existing = await tx.backgroundJob.findFirst({where:{...scope(req),id:req.params.id}});
    if (!existing) throw new AppError('Job not found',404);
    const hash = requestHash('JOB_RETRY',existing.id,{...input,userId:req.user!.id});
    const previous = await tx.activityLog.findFirst({where:{action:'BACKGROUND_JOB_RETRY',details:{path:['idempotencyKey'],equals:input.idempotencyKey}}});
    if (previous) {const details=previous.details as {hash:string;result:any}; if(previous.userId!==req.user!.id || details.hash!==hash) throw new AppError('This retry key belongs to a different job action',409); return details.result;}
    if (existing.attempts !== input.expectedAttempts) throw new AppError('Job attempts changed. Refresh its history before retrying.',409);
    if (!['FAILED','REVIEW'].includes(existing.status) || existing.attempts >= existing.maxAttempts) throw new AppError('This job cannot be retried; review its history or create a new reviewed request',409);
    if (existing.kind === 'EMAIL' && existing.status === 'REVIEW' && !input.confirmedNotDelivered) throw new AppError('Check provider history and confirm no delivery before retrying an uncertain email',409);
    try { jobPayload(existing); } catch { throw new AppError('The job encryption key is unavailable. Restore its configured key before retrying.',409); }
    const next = await tx.backgroundJob.update({where:{id:existing.id},data:{status:'QUEUED',availableAt:new Date(),finishedAt:null,lastError:null},select:jobSelect});
    await tx.activityLog.create({data:{userId:req.user!.id,locationId:existing.locationId,action:'BACKGROUND_JOB_RETRY',entity:'BackgroundJob',entityId:existing.id,details:JSON.parse(JSON.stringify({reason:input.reason,confirmedNotDelivered:input.confirmedNotDelivered,previousStatus:existing.status,idempotencyKey:input.idempotencyKey,hash,result:publicResult(next)}))}});
    return next;
  });
  res.json({success:true,data:publicResult(job)});
}));
router.get('/:id/download', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const job = await prisma.backgroundJob.findFirst({where:{...scope(req),id:req.params.id,kind:'EXPORT',status:'COMPLETE'}});
  if (!job) throw new AppError('Completed export not found',404);
  const result = job.result as {artifactKey:string;sha256:string;filename:string;bytes:number};
  const file = exportPath(job.id,result.artifactKey);
  const hash = createHash('sha256');
  try { if ((await fs.stat(file)).size !== result.bytes) throw new Error('SIZE'); for await (const chunk of createReadStream(file)) hash.update(chunk); }
  catch {throw new AppError('Export artifact is missing or incomplete. Restore the matching uploads backup.',409);}
  if (hash.digest('hex')!==result.sha256) throw new AppError('Export artifact failed its integrity check. Restore the matching uploads backup.',409);
  res.setHeader('Cache-Control','private, no-store');res.download(file,result.filename);
}));
export default router;
