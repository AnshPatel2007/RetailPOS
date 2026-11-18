import request from 'supertest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { enqueueJob, jobPayload, processNextBackgroundJob, recoverExpiredJobs } from '../../services/jobQueue.service';
import { executeBackgroundJob } from '../../services/backgroundWorker.service';
import { queueEmail } from '../../services/queuedEmail.service';
import { sendEmail } from '../../utils/email';
import { exportPath } from '../../services/queuedExport.service';
import { sendBirthdayEmails } from '../../services/marketing.service';
jest.mock('../../utils/email',()=>({sendEmail:jest.fn().mockResolvedValue(undefined)}));

describe('durable background work and private artifacts',()=>{
  let data:TestData,token:string;
  const post=(path:string,body:object={},auth=token)=>request(app).post('/api'+path).set('Authorization','Bearer '+auth).send(body);
  const get=(path:string,auth=token)=>request(app).get('/api'+path).set('Authorization','Bearer '+auth);
  const due=()=>new Date(Date.now()+10000);
  beforeEach(async()=>{data=await seedTestData();token=await createTestToken(data.adminUser.id,'ADMIN');jest.mocked(sendEmail).mockClear();});

  it('commits sale webhooks with the sale, deduplicates retry and discards rolled-back delivery work',async()=>{
    await prisma.webhookEndpoint.create({data:{url:'https://example.test/hook',secret:'test-only',events:['sale.completed'],createdBy:data.adminUser.id}});
    await post('/shifts/clock-in',{startingCash:100}).expect(201);
    const input={idempotencyKey:randomUUID(),items:[{productId:data.product.id,quantity:1,price:19.99,discount:0}],paymentMethod:'CASH',amountPaid:30};
    await post('/sales',input).expect(201);await post('/sales',input).expect(200);
    expect(await prisma.backgroundJob.count({where:{kind:'WEBHOOK'}})).toBe(1);
    const stored=await prisma.backgroundJob.findFirstOrThrow();expect(stored.payload).not.toContain('saleNumber');
    expect(jobPayload(stored)).toMatchObject({endpointId:expect.any(String),eventId:expect.any(String)});
    await expect(prisma.$transaction(async tx=>{await enqueueJob(tx,{kind:'EXPORT',idempotencyKey:randomUUID(),locationId:data.location.id,label:'Rollback',payload:{}});throw new Error('rollback');})).rejects.toThrow('rollback');
    expect(await prisma.backgroundJob.count()).toBe(1);
  });

  it('claims one job across concurrent workers and records bounded immutable attempts',async()=>{
    await prisma.$transaction(tx=>enqueueJob(tx,{kind:'EXPORT',locationId:data.location.id,idempotencyKey:randomUUID(),label:'Claim',payload:{private:'original'}}));
    const execute=jest.fn().mockResolvedValue({status:'COMPLETE'});
    const results=await Promise.all([processNextBackgroundJob(execute,due()),processNextBackgroundJob(execute,due())]);
    expect(results.filter(Boolean)).toHaveLength(1);expect(execute).toHaveBeenCalledTimes(1);
    expect(await prisma.backgroundJobAttempt.count()).toBe(1);
    await expect(prisma.backgroundJobAttempt.updateMany({data:{outcome:'ALTERED'}})).rejects.toThrow(/immutable/);
    await expect(prisma.backgroundJob.updateMany({data:{payload:'ALTERED'}})).rejects.toThrow(/immutable/);
  });

  it('recovers expired webhook leases with the same event while uncertain email leases need review',async()=>{
    for(const kind of ['WEBHOOK','EMAIL'] as const){const queued=await prisma.$transaction(tx=>enqueueJob(tx,{kind,locationId:data.location.id,idempotencyKey:randomUUID(),label:kind,payload:{eventId:'stable-event'}}));
      await prisma.backgroundJob.update({where:{id:queued.id},data:{status:'RUNNING',attempts:1,leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()-1000)}});}
    await recoverExpiredJobs();
    expect((await prisma.backgroundJob.findFirstOrThrow({where:{kind:'WEBHOOK'}})).status).toBe('RETRY');
    const email=await prisma.backgroundJob.findFirstOrThrow({where:{kind:'EMAIL'}});expect(email.status).toBe('REVIEW');
    expect(jobPayload(email)).toEqual({eventId:'stable-event'});expect(await prisma.backgroundJobAttempt.count()).toBe(2);
    await post('/jobs/'+email.id+'/retry',{idempotencyKey:randomUUID(),expectedAttempts:1,reason:'Provider checked'}).expect(409);
    const retry={idempotencyKey:randomUUID(),expectedAttempts:1,reason:'Provider checked and no acceptance',confirmedNotDelivered:true};
    await post('/jobs/'+email.id+'/retry',retry).expect(200);await post('/jobs/'+email.id+'/retry',retry).expect(200);
    expect(await prisma.activityLog.count({where:{action:'BACKGROUND_JOB_RETRY'}})).toBe(1);
  });

  it('rechecks marketing consent before contacting the mocked provider',async()=>{
    await prisma.customer.update({where:{id:data.customer.id},data:{emailMarketing:true}});
    await prisma.$transaction(tx=>queueEmail(tx,data.location.id,data.adminUser.id,randomUUID(),{type:'MARKETING',recipientId:data.customer.id,to:data.customer.email,subject:'Private subject',html:'Private body'}));
    await prisma.customer.update({where:{id:data.customer.id},data:{emailMarketing:false}});
    await processNextBackgroundJob(executeBackgroundJob,due());expect(sendEmail).not.toHaveBeenCalled();
    expect((await prisma.backgroundJob.findFirstOrThrow()).status).toBe('CANCELLED');
    const history=(await get('/jobs').expect(200)).body;expect(JSON.stringify(history)).not.toMatch(/Private subject|Private body|payload|recipientEmail/);
  });

  it('queues one immutable campaign manifest across repeated requests and queues birthday emails once per store year',async()=>{
    await prisma.customer.update({where:{id:data.customer.id},data:{emailMarketing:true,birthDate:new Date('1990-10-19T00:00:00Z')}});
    const input={idempotencyKey:randomUUID(),segment:'all',subject:'Hello {firstName}',message:'A store update'};
    const responses=await Promise.all([post('/customers/campaign',input),post('/customers/campaign',input)]);
    expect(responses.map(response=>response.status)).toEqual([200,200]);expect(await prisma.backgroundJob.count()).toBe(1);
    expect(responses[0].body.data).toMatchObject({queued:1,sent:0});expect(sendEmail).not.toHaveBeenCalled();
    const at=new Date('2026-10-19T18:00:00Z');expect((await Promise.all([sendBirthdayEmails(at),sendBirthdayEmails(at)])).reduce((sum,n)=>sum+n,0)).toBe(1);
    expect(await prisma.backgroundJob.count()).toBe(2);
  });

  it('streams more than 5,000 activity rows to an owner-scoped checksummed artifact',async()=>{
    await prisma.sale.createMany({data:Array.from({length:5010},(_,n)=>({saleNumber:'EXPORT-'+n,userId:data.adminUser.id,locationId:data.location.id,createdAt:new Date('2026-10-18T12:00:00Z'),paymentMethod:'CASH' as const,total:2,subtotal:1.8,tax:.2,amountPaid:2}))});
    const input={idempotencyKey:randomUUID(),type:'SALES_ACTIVITY',startDate:'2026-10-18',endDate:'2026-10-18'};
    const response=await post('/jobs/exports',input).expect(202);const id=response.body.data.id;
    await post('/jobs/exports',input).expect(202);expect(await prisma.backgroundJob.count()).toBe(1);
    await processNextBackgroundJob(executeBackgroundJob,due());
    const job=await prisma.backgroundJob.findUniqueOrThrow({where:{id}}),result=job.result as any;
    expect(job.status).toBe('COMPLETE');expect(result).toMatchObject({recordCount:5010,netCollected:10020});
    const download=await get('/jobs/'+id+'/download').expect(200);expect(download.text.split('\r\n')).toHaveLength(5012);
    const manager=await prisma.user.create({data:{email:'jobs-manager@test.com',password:'unused',firstName:'Manager',lastName:'User',role:'MANAGER',locationId:data.location.id}});
    await get('/jobs/'+id+'/download',await createTestToken(manager.id,'MANAGER')).expect(403);
    const artifact=exportPath(id,result.artifactKey);await fs.appendFile(artifact,'TAMPERED');await get('/jobs/'+id+'/download').expect(409);
    await fs.rm(artifact,{force:true});
  });
});
