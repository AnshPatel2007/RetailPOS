import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';

interface DataItem {
  name: string;
  value: number;
  count?: number;
  color?: string;
}

interface DataVisualizationCardProps {
  title: string;
  data: DataItem[];
  valueFormatter?: (value: number) => string;
  showTable?: boolean;
  colors?: string[];
}

const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export const DataVisualizationCard: React.FC<DataVisualizationCardProps> = ({
  title,
  data,
  valueFormatter = (value) => formatCurrency(value),
  showTable = true,
  colors = DEFAULT_COLORS,
}) => {
  const chartData = data.map((item, index) => ({
    ...item,
    color: item.color || colors[index % colors.length],
  }));

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const signed = data.some(item => item.value < 0) || total <= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No data available
          </div>
        ) : (
          <>
            {/* Pie Chart */}
            <ResponsiveContainer width="100%" height={300}>
              {signed ? <BarChart data={chartData}><XAxis dataKey="name" /><YAxis /><ReferenceLine y={0} stroke="currentColor" /><Tooltip formatter={(value: number) => valueFormatter(value)} /><Bar dataKey="value" fill="#3b82f6" /></BarChart> :
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name}: ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => valueFormatter(value)}
                />
                <Legend />
              </PieChart>}
            </ResponsiveContainer>

            {/* Breakdown Table */}
            {showTable && (
              <div className="mt-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left pb-2">Category</th>
                      {data[0]?.count !== undefined && (
                        <th className="text-right pb-2">Count</th>
                      )}
                      <th className="text-right pb-2">Amount</th>
                      <th className="text-right pb-2">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((item, index) => {
                      const percentage = signed ? '—' : ((item.value / total) * 100).toFixed(1) + '%';
                      return (
                        <tr key={index} className="border-b last:border-0">
                          <td className="py-2 flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: item.color }}
                            />
                            {item.name}
                          </td>
                          {item.count !== undefined && (
                            <td className="text-right py-2">{item.count}</td>
                          )}
                          <td className="text-right py-2 font-mono">
                            {valueFormatter(item.value)}
                          </td>
                          <td className="text-right py-2 text-muted-foreground">
                            {percentage}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="font-semibold">
                      <td className="pt-2">Total</td>
                      {data[0]?.count !== undefined && (
                        <td className="text-right pt-2">
                          {data.reduce((sum, item) => sum + (item.count || 0), 0)}
                        </td>
                      )}
                      <td className="text-right pt-2 font-mono">
                        {valueFormatter(total)}
                      </td>
                      <td className="text-right pt-2">{signed ? '—' : '100%'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
