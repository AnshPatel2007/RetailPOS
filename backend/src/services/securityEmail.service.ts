import {Prisma} from '@prisma/client';
import {config} from '../config';
import {enqueueJob} from './jobQueue.service';
type Recipient={id:string;email:string;firstName:string;locationId:string|null};
const esc=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export async function queueSecurityEmail(tx:Prisma.TransactionClient,user:Recipient,event:string,key:string,options?:{resetToken:string;tokenHash:string;expiresAt:Date}){
  const at=new Date().toISOString(),subject=options?'Password reset request':event.replace(/_/g,' ');
  const body=options?`<p>A password reset was requested for your account.</p><p><a href="${esc(config.app.url+'/reset-password?token='+options.resetToken)}">Reset your password</a></p><p>This link expires at ${options.expiresAt.toISOString()}. If you did not request it, ignore this message.</p>`
    :`<p>Your account recorded this security event: ${esc(subject)} at ${at}.</p><p>If you do not recognize it, contact your store owner or support and change your password.</p>`;
  return enqueueJob(tx,{kind:'EMAIL',locationId:user.locationId,requestedBy:user.id,idempotencyKey:'security:'+event+':'+user.id+':'+key,label:'ACCOUNT SECURITY',payload:{type:'SECURITY',recipientId:user.id,to:user.email,subject,
    html:`<h2>${esc(config.app.name)}</h2><p>Hello ${esc(user.firstName)},</p>${body}`,...(options?{tokenHash:options.tokenHash,expiresAt:options.expiresAt.toISOString()}:{})}});
}
