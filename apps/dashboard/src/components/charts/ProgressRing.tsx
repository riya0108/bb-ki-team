'use client';

import { RadialBar, RadialBarChart, PolarAngleAxis } from 'recharts';
import { useTheme } from '@/components/theme/ThemeProvider';

export function ProgressRing({
  value,
  label,
  color = '#8b5cf6',
}: {
  value: number;
  label: string;
  color?: string;
}) {
  const { resolvedTheme } = useTheme();
  const clamped = Math.max(0, Math.min(100, value));
  const data = [{ value: clamped }];
  const trackColor = resolvedTheme === 'dark' ? '#27272a' : '#e4e4e7';

  return (
    <div className="relative flex items-center justify-center">
      <RadialBarChart
        width={140}
        height={140}
        cx="50%"
        cy="50%"
        innerRadius={50}
        outerRadius={65}
        barSize={12}
        data={data}
        startAngle={90}
        endAngle={90 - (360 * clamped) / 100}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar dataKey="value" cornerRadius={8} fill={color} background={{ fill: trackColor }} />
      </RadialBarChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-neutral-900 dark:text-white">{Math.round(clamped)}</span>
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</span>
      </div>
    </div>
  );
}
