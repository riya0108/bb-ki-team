'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyChartState } from '@/components/charts/EmptyChartState';
import { useTheme } from '@/components/theme/ThemeProvider';

export interface TopicScoreDatum {
  topic: string;
  score: number;
}

export function TopicScoreBarChart({ data }: { data: TopicScoreDatum[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (data.length === 0) {
    return <EmptyChartState label="No topics yet" />;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#27272a' : '#e4e4e7'} horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fill: isDark ? '#a1a1aa' : '#71717a', fontSize: 12 }}
          stroke={isDark ? '#3f3f46' : '#d4d4d8'}
        />
        <YAxis
          type="category"
          dataKey="topic"
          width={170}
          tick={{ fill: isDark ? '#e4e4e7' : '#27272a', fontSize: 12 }}
          stroke={isDark ? '#3f3f46' : '#d4d4d8'}
        />
        <Tooltip
          contentStyle={{
            background: isDark ? '#18181b' : '#ffffff',
            border: `1px solid ${isDark ? '#27272a' : '#e4e4e7'}`,
            borderRadius: 8,
            color: isDark ? '#e4e4e7' : '#27272a',
          }}
          cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
        />
        <Bar dataKey="score" radius={[0, 6, 6, 0]} fill="#8b5cf6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
