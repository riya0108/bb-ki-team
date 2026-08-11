import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { AppShell } from '@/components/AppShell';
import { ThemeProvider, THEME_INIT_SCRIPT } from '@/components/theme/ThemeProvider';
import { listResearchRuns, listTrendResearchRuns } from '@/lib/workflowRuns';
import { computeResearchStats } from '@/lib/researchStats';
import { computeTrendStats } from '@/lib/trendStats';
import { getTeamStatuses } from '@/lib/teamStatus';
import { listPipelineRuns } from '@/lib/pipelineRuns';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Company OS — Dashboard',
  description: 'Operate every department of the AI Company OS from one dashboard.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [researchRuns, trendRuns, pipelineRuns] = await Promise.all([
    listResearchRuns(),
    listTrendResearchRuns(),
    listPipelineRuns(['blog', 'content-intelligence']),
  ]);
  const teams = getTeamStatuses(computeResearchStats(researchRuns), computeTrendStats(trendRuns), pipelineRuns);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <AppShell teams={teams}>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
