'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ScoreBucket } from '@/lib/researchStats';
import { EmptyChartState } from '@/components/charts/EmptyChartState';

const COLORS: Record<ScoreBucket['name'], string> = {
  High: '#34d399',
  Medium: '#fbbf24',
  Low: '#f87171',
};

export function ScoreDistributionDonut({ data }: { data: ScoreBucket[] }) {
  const hasData = data.some((bucket) => bucket.value > 0);
  if (!hasData) {
    return <EmptyChartState label="No topics yet" />;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={3}>
          {data.map((bucket) => (
            <Cell key={bucket.name} fill={COLORS[bucket.name]} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#e4e4e7' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#a1a1aa' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
