import { Checkbox } from '@/components/ui/Checkbox';
import { DataPanel, ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { Select } from '@/components/ui/Select';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { useAuthStore } from '@/store/authStore';
import { OperationRecovery } from '@/components/common/OperationRecovery';
import { Pagination } from '@/components/common/Pagination';
import { PageHeader } from '@/components/common/PageHeader';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatEnumLabel, formatDateTime } from '@/lib/utils';

export function BackgroundJobs() {
  const [page, setPage] = useUrlPage(), [jobId, setJobId] = useUrlFilter('job');
  const role = useAuthStore(state => state.user?.role);
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [downloadError, setDownloadError] = useState('');
  const [type, setType] = useState('SALES_ACTIVITY'), [startDate, setStartDate] = useState(''), [endDate, setEndDate] = useState('');
  const listing = useScopedQuery<any>(['jobs',page], signal => api.get('/jobs',{params:{page},signal}).then(response=>response.data.data), true, 30000, {refreshInterval:10000});
  const detail = useScopedQuery<any>(['job',jobId], signal => api.get('/jobs/'+jobId,{signal}).then(response=>response.data.data),!!jobId, 30000, {refreshInterval:10000,paused:!!reason || confirmed});
  const operation = useSavedOperation('jobs','/jobs/',response=>{setReason('');setConfirmed(false);if(response.data?.id)setJobId(response.data.id);});

  const download = async(id:string,filename:string)=>{
    setDownloadError('');
    // The link must be on the page while it is clicked, and the file URL kept until the download starts.
    try{const response=await api.get('/jobs/'+id+'/download',{responseType:'blob'});const url=URL.createObjectURL(response.data);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);}
    catch{setDownloadError('Download unavailable. Retry when the export is available.');}
  };
  return <ManagementPage className=" space-y-5">
    <PageHeader title="Email & Export Jobs" subtitle={role==='SUPER_ADMIN'?'Platform webhook delivery history':'Store email deliveries and saved exports'} actions={<Link className="page-action" to={role==='SUPER_ADMIN'?'/admin':'/settings'}>{role==='SUPER_ADMIN'?'Back to Admin':'Back to Settings'}</Link>}/>
    <p className="text-sm text-muted-foreground">Accepted confirms provider receipt, not inbox delivery. Check provider history before retrying uncertain emails.</p>
    <OperationRecovery operation={operation}/>
    {listing.data?.workerDisabled && <p role="status" className="rounded border p-3 text-sm">Delivery processing is paused. Requests remain queued.</p>}
    {role==='ADMIN' && <Card className="p-4 space-y-3"><h2 className="font-semibold">Saved exports</h2><p className="text-sm text-muted-foreground">Choose up to 366 store dates. Sales include tax and dated returns/voids. Expense exports include payroll; inventory reflects the time the export runs.</p><fieldset disabled={operation.blocked} className="flex flex-wrap items-end gap-3"><label>Export<Select aria-label="Export type" value={type} onChange={event=>setType(event.target.value)} className="block rounded border bg-background p-2"><option value="SALES_ACTIVITY">Sales, returns and voids</option><option value="INVENTORY">Current inventory</option><option value="EXPENSES">Expense records</option></Select></label><DateRangePicker label="Export dates" startDate={startDate} endDate={endDate} allowOpenRange={false} maxDays={366} disabled={operation.blocked} emptyLabel="Choose dates" onChange={range=>{setStartDate(range.startDate);setEndDate(range.endDate);}}/><Button disabled={!startDate||!endDate} onClick={()=>void operation.submit({label:formatEnumLabel(type)+' CSV',path:'/jobs/exports',payload:{type,startDate,endDate}})}>Queue export</Button></fieldset></Card>}
    {listing.loading&&<p role="status">Loading jobs...</p>}{listing.error&&<div role="alert" className="flex flex-wrap gap-3 items-center"><p>{listing.error}</p><Button variant="outline" onClick={listing.refresh}>Retry jobs</Button></div>}{downloadError&&<p role="alert">{downloadError}</p>}
    {listing.data&&<><SummaryStrip items={[
      { label: 'Jobs', value: listing.data.pagination.total },
      { label: 'Needs review', value: listing.data.counts.REVIEW || 0, tone: listing.data.counts.REVIEW ? 'warning' : 'default' },
      { label: 'Failed', value: listing.data.counts.FAILED || 0, tone: listing.data.counts.FAILED ? 'danger' : 'default' },
    ]} />{listing.data.oldestWaitingAt && <p className="text-xs text-muted-foreground">Oldest waiting: {formatDateTime(listing.data.oldestWaitingAt)}</p>}<DataPanel>{!listing.data.jobs.length&&<p>No jobs recorded.</p>}{listing.data.jobs.map((job:any)=><div key={job.id} className="p-4 border-b last:border-b-0 flex flex-wrap justify-between items-center gap-3"><div><p className="font-medium">{job.label} · {formatEnumLabel(job.status)}</p><p className="text-xs text-muted-foreground">{formatDateTime(job.createdAt)} · {job.attempts}/{job.maxAttempts} attempts</p>{job.lastError&&<p className="text-sm">{job.lastError.replace(/_/g,' ')}</p>}</div><div className="flex gap-2"><Button variant="outline" onClick={()=>{setReason('');setConfirmed(false);setJobId(job.id);}}>View job</Button>{job.kind==='EXPORT'&&job.status==='COMPLETE'&&<Button onClick={()=>void download(job.id,job.result?.filename||'export.csv')}>Download CSV</Button>}</div></div>)}</DataPanel><Pagination page={page} totalPages={listing.data.pagination.totalPages} onPageChange={setPage}/></>}
    <div data-auto-refresh={!reason && !confirmed ? 'allow' : undefined}><Modal isOpen={!!jobId} onClose={()=>{if(!operation.busy)setJobId('');}} title="Job Details" size="lg">
      {detail.loading&&<p role="status">Loading job...</p>}{detail.error&&<p role="alert">{detail.error}<Button onClick={detail.refresh}>Retry details</Button></p>}
      {detail.data&&<div className="space-y-3"><p className="font-semibold">{detail.data.label} · {formatEnumLabel(detail.data.status)}</p><details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">Technical details</summary><div className="mt-2 space-y-2 text-xs text-muted-foreground"><p className="break-all">Job: {detail.data.id}</p>{detail.data.result?.sha256 && <p className="break-all">SHA-256: {detail.data.result.sha256}</p>}</div></details>{detail.data.destination&&<p className="break-all text-sm">Destination: {detail.data.destination}</p>}{detail.data.kind==='EMAIL'&&<p className="break-all text-sm">Provider search reference: {detail.data.providerCorrelationId}</p>}{detail.data.result&&detail.data.kind==='EXPORT'&&<div className="text-sm space-y-1"><p>{detail.data.result.recordCount??'—'} records · generated {detail.data.result.snapshotAt?formatDateTime(detail.data.result.snapshotAt):'—'}</p>{typeof detail.data.result.netCollected==='number'&&<p>Net collected: {formatCurrency(detail.data.result.netCollected)}</p>}</div>}<h3 className="font-semibold">Delivery attempts</h3>{!detail.data.history.length&&<p>No delivery attempts yet.</p>}{detail.data.history.map((attempt:any)=><p key={attempt.number} className="text-sm">Attempt {attempt.number}: {formatEnumLabel(attempt.outcome)} · {formatDateTime(attempt.finishedAt)} {attempt.code?.replace(/_/g,' ')}</p>)}
      {['FAILED','REVIEW'].includes(detail.data.status)&&detail.data.attempts<detail.data.maxAttempts&&<fieldset disabled={operation.blocked || detail.loading || detail.refreshing || !!detail.error} className="space-y-3 border-t pt-3"><Input label="Retry reason" value={reason} maxLength={500} onChange={event=>setReason(event.target.value)}/>{detail.data.kind==='EMAIL'&&detail.data.status==='REVIEW'&&<Checkbox label="I checked provider history and confirmed this email was not delivered." checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} />}<Button disabled={!reason.trim()||(detail.data.kind==='EMAIL'&&detail.data.status==='REVIEW'&&!confirmed)} onClick={()=>void operation.submit({label:'Retry '+detail.data.label,path:'/jobs/'+detail.data.id+'/retry',payload:{expectedAttempts:detail.data.attempts,reason:reason.trim(),confirmedNotDelivered:confirmed}})}>Queue reviewed retry</Button></fieldset>}
      <OperationRecovery operation={operation}/></div>}
    </Modal></div>
  </ManagementPage>;
}
