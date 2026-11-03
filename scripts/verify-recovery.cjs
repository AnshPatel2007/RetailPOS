// Read-only against the source; creates isolated fresh/restored acceptance DBs.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');require('dotenv').config({path:path.join(root,'backend/.env')});
const {PrismaClient}=require('@prisma/client');
const source=new URL(process.env.RECOVERY_SOURCE_DATABASE_URL||process.env.DATABASE_URL||'');
if(!['postgres:','postgresql:'].includes(source.protocol)||!['localhost','127.0.0.1','[::1]'].includes(source.hostname))throw Error('Recovery verification requires an explicit local PostgreSQL source');
const stamp=Date.now(),artifact=path.join(root,'.local','recovery-verification-'+stamp);
fs.mkdirSync(artifact,{recursive:true});const log=fs.openSync(path.join(artifact,'operations.log'),'a');
const pgDirectory=process.env.PG_BIN||'C:/Program Files/PostgreSQL/18/bin';
const pgEnv={...process.env,PGHOST:source.hostname,PGPORT:source.port||'5432',PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password)};
const suffix=process.platform==='win32'?'.exe':'';
const run=(file,args,env=pgEnv)=>{const result=cp.spawnSync(file,args,{cwd:root,env,stdio:['ignore',log,log]});if(result.status!==0)throw Error('Recovery command failed. Inspect the private operations log.');};
const databaseUrl=name=>{if(!/^[a-z0-9_]+_(test|e2e)$/.test(name)||name===decodeURIComponent(source.pathname.slice(1)))throw Error('Disposable recovery database required');const value=new URL(source);value.pathname='/'+name;return value.toString();};
const migrate=url=>{for(const mode of ['deploy','check'])run(process.execPath,['backend/scripts/migrate.cjs',mode],{...pgEnv,DATABASE_URL:url});};
const quote=value=>'"'+value.replaceAll('"','""')+'"';
async function snapshot(url,layout){
  const db=new PrismaClient({datasources:{db:{url}}});
  try{
    if(!layout){layout={};const rows=await db.$queryRaw`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`;for(const row of rows)(layout[row.table_name]||=[]).push(row.column_name);}
    const tables={};for(const [table,columns]of Object.entries(layout)){
      const [value]=await db.$queryRawUnsafe('SELECT COUNT(*)::int AS count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),\'\' ORDER BY md5(to_jsonb(t)::text)),\'\')) AS hash FROM (SELECT '+columns.map(quote).join(',')+' FROM '+quote(table)+') t');tables[table]=value;
    }
    return{layout,tables};
  }finally{await db.$disconnect();}
}
function fileManifest(directory){
  const result={};if(!fs.existsSync(directory))return result;
  const walk=relative=>{const folder=path.join(directory,relative);for(const item of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.join(relative,item.name);if(item.isSymbolicLink())throw Error('Uploads backup cannot contain symlinks');if(item.isDirectory())walk(name);else if(item.isFile()){const file=fs.openSync(path.join(directory,name),'r'),buffer=Buffer.alloc(1024*1024),hash=crypto.createHash('sha256');let bytes=0;try{let count;while((count=fs.readSync(file,buffer,0,buffer.length,null))>0){hash.update(buffer.subarray(0,count));bytes+=count;}}finally{fs.closeSync(file);}result[name.replaceAll('\\','/')]={bytes,sha256:hash.digest('hex')};}}};walk('');return result;
}
function equal(actual,expected,label){if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(label+' fingerprint mismatch');}
async function verifyRestoredJobs(db,uploads){
  let cursor,encryptedJobsChecked=0,exportArtifactsChecked=0;
  const exportFiles=fileManifest(path.join(uploads,'private','jobs'));
  for(;;){
    const jobs=await db.backgroundJob.findMany({where:cursor?{id:{gt:cursor}}:{},orderBy:{id:'asc'},take:100});
    for(const job of jobs){
      const value=process.env.JOB_ENCRYPTION_KEY||process.env.JWT_SECRET;
      if(!value||value.length<32)throw Error('Restored jobs require their deployment encryption key');
      const [version,iv,tag,content]=job.payload.split('.');if(version!=='v1'||!iv||!tag||!content)throw Error('Restored job payload is unreadable');
      const key=crypto.createHash('sha256').update('pos-background-jobs-v1:'+value).digest(),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));
      decipher.setAAD(Buffer.from(job.kind+':'+job.idempotencyKey));decipher.setAuthTag(Buffer.from(tag,'base64'));
      JSON.parse(Buffer.concat([decipher.update(Buffer.from(content,'base64')),decipher.final()]).toString('utf8'));encryptedJobsChecked++;
      if(job.kind==='EXPORT'&&job.status==='COMPLETE'){
        const result=job.result;
        if(!result||typeof result!=='object'||!/^[-0-9a-f]{36}$/i.test(job.id)||!/^[-0-9a-f]{36}$/i.test(result.artifactKey||''))throw Error('Restored export metadata is invalid');
        const file=exportFiles[job.id+'-'+result.artifactKey+'.csv'];
        if(!file||file.bytes!==result.bytes||file.sha256!==result.sha256)throw Error('Restored completed export checksum mismatch');
        exportArtifactsChecked++;
      }
    }
    if(jobs.length<100)break;cursor=jobs[jobs.length-1].id;
  }
  return{encryptedJobsChecked,exportArtifactsChecked};
}
(async()=>{
  const original=await snapshot(source.toString());fs.writeFileSync(path.join(artifact,'source-fingerprint.json'),JSON.stringify(original,null,2));
  const uploads=path.resolve(root,'backend',process.env.UPLOAD_DIR||'uploads'),originalFiles=fileManifest(uploads);
  run(path.join(pgDirectory,'pg_dump'+suffix),['--format=custom','--file='+path.join(artifact,'database.dump'),'--dbname='+decodeURIComponent(source.pathname.slice(1))]);
  if(fs.existsSync(uploads))fs.cpSync(uploads,path.join(artifact,'uploads'),{recursive:true});
  equal(fileManifest(path.join(artifact,'uploads')),originalFiles,'Backup uploads');
  const freshName='pos_fresh_acceptance_'+stamp+'_test',restoredName='pos_restore_acceptance_'+stamp+'_test';
  for(const name of [freshName,restoredName]){databaseUrl(name);run(path.join(pgDirectory,'createdb'+suffix),[name]);}
  migrate(databaseUrl(freshName));
  run(path.join(pgDirectory,'pg_restore'+suffix),['--exit-on-error','--no-owner','--dbname='+restoredName,path.join(artifact,'database.dump')]);
  migrate(databaseUrl(restoredName));
  equal((await snapshot(databaseUrl(restoredName),original.layout)).tables,original.tables,'Restored source rows');
  const restoredUploads=path.join(artifact,'restored','uploads');if(fs.existsSync(path.join(artifact,'uploads')))fs.cpSync(path.join(artifact,'uploads'),restoredUploads,{recursive:true});
  equal(fileManifest(restoredUploads),originalFiles,'Restored uploads');
  equal((await snapshot(source.toString(),original.layout)).tables,original.tables,'Unchanged operational rows');
  equal(fileManifest(uploads),originalFiles,'Unchanged operational uploads');
  const db=new PrismaClient({datasources:{db:{url:databaseUrl(restoredName)}}});let migrations,jobVerification;
  try{migrations=await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;jobVerification=await verifyRestoredJobs(db,restoredUploads);}finally{await db.$disconnect();}
  const result={verifiedAt:new Date().toISOString(),sourceDatabase:decodeURIComponent(source.pathname.slice(1)),freshDatabase:freshName,restoredDatabase:restoredName,
    freshSchemaDrift:false,restoredSchemaDrift:false,sourceRowsPreserved:true,uploadsPreserved:true,matchingUploadsRestored:true,migrations:migrations.map(row=>row.migration_name),
    sourceRows:Object.values(original.tables).reduce((sum,row)=>sum+row.count,0),uploadFiles:Object.keys(originalFiles).length,...jobVerification,artifact};
  fs.writeFileSync(path.join(artifact,'uploads-manifest.json'),JSON.stringify(originalFiles,null,2));fs.writeFileSync(path.join(artifact,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
})().catch(error=>{console.error('Recovery verification failed: '+error.message+' Artifact: '+artifact);process.exitCode=1;}).finally(()=>fs.closeSync(log));
