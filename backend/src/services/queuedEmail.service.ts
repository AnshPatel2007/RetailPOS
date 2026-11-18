import { BackgroundJob, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import prisma from '../config/database';
import { enqueueJob, jobPayload, JobOutcome } from './jobQueue.service';
import { sendEmail } from '../utils/email';
import { publicStoreSettings } from '../validators/storeSettings.validator';
export type EmailPayload = { type: 'RECEIPT' | 'STATEMENT' | 'MARKETING' | 'BIRTHDAY' | 'LOW_STOCK' | 'SECURITY';
  to: string; subject: string; html: string; recipientId?: string; saleId?: string; accountId?: string; year?: number; tokenHash?:string; expiresAt?:string };
export const emailContentKey = (payload: EmailPayload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
export function queueEmail(tx: Prisma.TransactionClient, locationId: string, requestedBy: string | null, key: string, payload: EmailPayload) {
  return enqueueJob(tx, { kind: 'EMAIL', locationId, requestedBy, idempotencyKey: 'email:' + key, label: payload.type.replace(/_/g, ' '), payload });
}
export async function queueLowStockEmails(tx: Prisma.TransactionClient, locationId: string, saleId: string, products: { name: string; sku: string; stock: number; threshold: number }[]) {
  if (!products.length) return;
  const store = await tx.location.findUniqueOrThrow({ where: { id: locationId } });
  const settings = publicStoreSettings(store.settings).notificationSettings;
  if (settings?.lowStockAlerts === false || settings?.emailNotifications === false) return;
  const owners = await tx.user.findMany({ where: { locationId, role: 'ADMIN', isActive: true }, select: { id: true, email: true } });
  const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<h2>Low stock at ${esc(store.name)}</h2><p>Review current stock before ordering.</p><ul>${products.map(product => `<li>${esc(product.name)} (${esc(product.sku)}): ${product.stock} units; threshold ${product.threshold}</li>`).join('')}</ul>`;
  for (const owner of owners) await queueEmail(tx, locationId, null, 'low-stock:' + saleId + ':' + owner.id, { type: 'LOW_STOCK', to: owner.email, recipientId: owner.id, subject: 'Low stock at ' + store.name, html });
}
export async function deliverEmailJob(job: BackgroundJob): Promise<JobOutcome> {
  const payload = jobPayload<EmailPayload>(job);
  if(payload.type==='SECURITY'){
    const user=await prisma.user.findFirst({where:{id:payload.recipientId,email:payload.to,isActive:true},select:{id:true,passwordResetToken:true,passwordResetExpires:true}});
    if(!user || (payload.expiresAt && new Date(payload.expiresAt)<=new Date()) || (payload.tokenHash && (user.passwordResetToken!==payload.tokenHash || !user.passwordResetExpires || user.passwordResetExpires<=new Date())))return{status:'CANCELLED',code:'SECURITY_REQUEST_EXPIRED_OR_REPLACED'};
  }
  if(payload.type==='SECURITY')return sendQueuedMessage(payload,job.id);
  const store = job.locationId ? await prisma.location.findFirst({ where: { id: job.locationId, isActive: true } }) : null;
  if (!store) return { status: 'CANCELLED', code: 'STORE_NO_LONGER_ACTIVE' };
  if (['MARKETING', 'BIRTHDAY'].includes(payload.type)) {
    if (!payload.recipientId || !await prisma.customer.findFirst({ where: { id: payload.recipientId, locationId: store.id, email: payload.to, emailMarketing: true, isActive: true } })) return { status: 'CANCELLED', code: 'MARKETING_CONSENT_OR_RECIPIENT_CHANGED' };
  } else if (payload.type === 'LOW_STOCK') {
    if (!await prisma.user.findFirst({ where: { id: payload.recipientId, locationId: store.id, email: payload.to, isActive: true, ...(payload.type === 'LOW_STOCK' ? { role: 'ADMIN' } : {}) } })) return { status: 'CANCELLED', code: 'RECIPIENT_NO_LONGER_AUTHORIZED' };
    const notifications = publicStoreSettings(store.settings).notificationSettings;
    if (payload.type === 'LOW_STOCK' && (notifications?.emailNotifications === false || notifications?.lowStockAlerts === false)) return { status: 'CANCELLED', code: 'NOTIFICATION_DISABLED' };
  } else if (payload.type === 'RECEIPT') {
    if (!await prisma.sale.findFirst({ where: { id: payload.saleId, locationId: store.id } })) return { status: 'CANCELLED', code: 'RECEIPT_NOT_AVAILABLE' };
  } else if (payload.type === 'STATEMENT') {
    if (!await prisma.houseAccount.findFirst({ where: { id: payload.accountId, locationId: store.id, customer: { locationId: store.id, email: payload.to, isActive: true } } })) return { status: 'CANCELLED', code: 'STATEMENT_RECIPIENT_CHANGED' };
  } else return { status: 'FAILED', code: 'UNSUPPORTED_EMAIL_TYPE' };
  const result=await sendQueuedMessage(payload,job.id);
  if(result.status==='ACCEPTED' && payload.type==='BIRTHDAY' && payload.recipientId)await prisma.customer.updateMany({where:{id:payload.recipientId,locationId:store!.id},data:{lastBirthdayEmailAt:new Date()}});
  return result;
}
async function sendQueuedMessage(payload:EmailPayload,jobId:string):Promise<JobOutcome>{
  try {
    await sendEmail({ to: payload.to, subject: payload.subject, html: payload.html,correlationId:jobId });
    return { status: 'ACCEPTED',result:{providerCorrelationId:jobId} };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === 'NOT_CONFIGURED' || code === 'PROVIDER_REJECTED' ? { status: 'FAILED', code,result:{providerCorrelationId:jobId} } : { status: 'REVIEW', code: 'DELIVERY_UNKNOWN',result:{providerCorrelationId:jobId} };
  }
}
