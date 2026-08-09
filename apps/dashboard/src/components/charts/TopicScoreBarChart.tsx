'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyChartState } from '@/components/charts/EmptyChartState';

export interface TopicScoreDatum {
  topic: string;
  score: number;
}

export function TopicScoreBarChart({ data }: { data: TopicScoreDatum[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="No topics yet" />;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fill: '#a1a1aa', fontSize: 12 }} stroke="#3f3f46" />
        <YAxis
          type="category"
          dataKey="topic"
          width={170}
          tick={{ fill: '#e4e4e7', fontSize: 12 }}
          stroke="#3f3f46"
        />
        <Tooltip
          contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#e4e4e7' }}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Bar dataKey="score" radius={[0, 6, 6, 0]} fill="#8b5cf6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
