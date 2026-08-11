import { departments } from '@/lib/departments';
import { listResearchRuns, listTrendResearchRuns } from '@/lib/workflowRuns';
import { computeResearchStats } from '@/lib/researchStats';
import { computeTrendStats } from '@/lib/trendStats';
import { DepartmentCard, type DepartmentQuickStats } from '@/components/DepartmentCard';

export default async function OverviewPage() {
  const [researchRuns, trendRuns] = await Promise.all([listResearchRuns(), listTrendResearchRuns()]);
  const researchStats = computeResearchStats(researchRuns);
  const trendStats = computeTrendStats(trendRuns);
  const activeCount = departments.filter((department) => department.status === 'active').length;

  const statsByDepartment: Partial<Record<string, DepartmentQuickStats>> = {
    research: {
      totalRuns: researchStats.totalRuns,
      totalItems: researchStats.totalTopics,
      itemsLabel: 'Topics',
      avgScore: researchStats.avgScore,
      scoreLabel: 'Avg score',
    },
    'trend-research': {
      totalRuns: trendStats.totalRuns,
      totalItems: trendStats.totalSignals,
      itemsLabel: 'Signals',
      avgScore: trendStats.avgVelocity,
      scoreLabel: 'Avg velocity',
    },
  };

  return (
    <div className="space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white sm:text-2xl">Departments</h1>
        <p className="mt-1 text-neutral-500 dark:text-neutral-400">
          {activeCount} active · {departments.length} total
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {departments.map((department) => (
          <DepartmentCard key={department.id} department={department} stats={statsByDepartment[department.id]} />
        ))}
      </div>
    </div>
  );
}
