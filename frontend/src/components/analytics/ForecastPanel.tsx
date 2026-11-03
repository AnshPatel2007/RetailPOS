import { Select } from '@/components/ui/Select';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { formatCurrency } from '@/lib/utils';

export interface ForecastData {
  status: 'UNAVAILABLE' | 'ESTIMATE'; unavailableReason: string | null; basis: string; timezone: string;
  summary: { totalForecastRevenue: number | null; avgDailyForecast: number | null; historicalAvgDaily: number | null; expectedGrowth: number | null };
  historicalPeriod: { days: number; dataPoints: number; start: string | null; end: string };
  forecast: { date: string; dayOfWeek: string; revenue: number; transactions: number; confidenceLow: number; confidenceHigh: number }[];
}

export function ForecastPanel({ data, days, refreshing, onDaysChange }: { data: ForecastData | null; days: string; refreshing: boolean; onDaysChange: (days: string) => void }) {
  const money = (value: number | null) => value === null ? 'Unavailable' : formatCurrency(value);
  return <div className="space-y-6">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <div><h3 className="text-lg font-semibold">Sales Forecast</h3><p className="text-sm text-muted-foreground">{data ? `Estimated net collections in ${data.timezone}` : 'Estimates use complete store dates.'}</p></div>
      <label className="text-sm">Forecast period
        <Select value={days} onChange={event => onDaysChange(event.target.value)} className="ml-2 min-h-11 px-3 py-2 border border-input rounded-md bg-background text-foreground">
          {[7, 14, 30, 60].map(value => <option key={value} value={value}>Next {value} days</option>)}
        </Select>
      </label>
    </div>
    {refreshing && <p role="status" className="text-sm text-muted-foreground">{data ? 'Updating forecast; previous results are shown.' : 'Loading forecast for the selected period.'}</p>}
    {data && <>
    <p className="text-sm text-muted-foreground">{data.basis}</p>
    <p className="text-sm text-muted-foreground">History: {data.historicalPeriod.days} complete dates, {data.historicalPeriod.dataPoints} dates with sales{data.historicalPeriod.start ? ` (${data.historicalPeriod.start} to ${data.historicalPeriod.end})` : ''}.</p>
    {data.status === 'UNAVAILABLE' ? <Card className="p-6"><h4 role="status" className="font-medium">Forecast unavailable</h4><p className="mt-2 text-sm text-muted-foreground">{data.unavailableReason}</p></Card> : <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['Estimated total', money(data.summary.totalForecastRevenue)], ['Estimated daily average', money(data.summary.avgDailyForecast)],
          ['Historical daily average', money(data.summary.historicalAvgDaily)], ['Change from historical average', data.summary.expectedGrowth === null ? 'Unavailable' : `${data.summary.expectedGrowth.toFixed(1)}%`],
        ].map(([label, value]) => <Card key={label} className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{value}</p></Card>)}
      </div>
      <Card className="p-6"><h4 className="font-medium mb-4">Estimated net collections</h4><div className="h-80">
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.forecast}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip formatter={value => formatCurrency(Number(value))} />
          <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} name="Estimate" />
        </AreaChart></ResponsiveContainer>
      </div></Card>
      <Card><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Day</TableHead><TableHead>Estimated net collections</TableHead><TableHead>Estimated transactions</TableHead><TableHead>Observed weekday range</TableHead></TableRow></TableHeader>
        <TableBody>{data.forecast.map(day => <TableRow key={day.date}><TableCell>{day.date}</TableCell><TableCell>{day.dayOfWeek}</TableCell><TableCell className="tabular-nums">{money(day.revenue)}</TableCell><TableCell>{day.transactions}</TableCell><TableCell className="tabular-nums">{money(day.confidenceLow)} to {money(day.confidenceHigh)}</TableCell></TableRow>)}</TableBody>
      </Table></Card>
    </>}
    </>}
  </div>;
}
