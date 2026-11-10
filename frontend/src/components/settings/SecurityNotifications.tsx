import { formatDateTime, formatEnumLabel } from '@/lib/utils';
import {useState} from 'react';
import {api} from '@/services/api';
import {useScopedQuery} from '@/hooks/useScopedQuery';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/Card';
import {Button} from '@/components/ui/Button';
import {Pagination} from '@/components/common/Pagination';
export function SecurityNotifications(){
  const[page,setPage]=useState(1),[open,setOpen]=useState(false);
  const query=useScopedQuery<any>(['security-notifications',page],signal=>api.get('/auth/security-notifications',{params:{page},signal}).then(response=>response.data.data),open,30000,{refreshInterval:10000});
  return <Card><CardHeader><CardTitle>Security email history</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Your password and security notifications. Accepted confirms provider receipt, not inbox delivery.</p><Button variant="outline" onClick={()=>setOpen(value=>!value)}>{open?'Hide':'Show'} security notifications</Button>{open&&<>{query.loading&&<p role="status">Loading notification status...</p>}{query.error&&<div role="alert"><p>{query.error}</p><Button variant="outline" onClick={query.refresh}>Retry</Button></div>}{query.data&&!query.data.records.length&&<p>No security emails recorded.</p>}{query.data?.records.map((record:any)=><div key={record.id} className="rounded border p-2 text-sm"><p>{formatDateTime(record.createdAt)} · {record.status} · {record.attempts} attempts</p>{record.lastError&&<p>{formatEnumLabel(record.lastError)}</p>}<p className="break-all">Reference: {record.id}</p></div>)}{query.data&&<Pagination page={page} totalPages={query.data.pagination.totalPages} onPageChange={setPage}/>}</>}</CardContent></Card>;
}
