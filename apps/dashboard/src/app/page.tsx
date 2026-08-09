import { departments } from '@/lib/departments';
import { listResearchRuns } from '@/lib/runStore';
import { computeResearchStats } from '@/lib/researchStats';
import { DepartmentCard } from '@/components/DepartmentCard';

export default async function OverviewPage() {
  const researchRuns = await listResearchRuns();
  const researchStats = computeResearchStats(researchRuns);
  const activeCount = departments.filter((department) => department.status === 'active').length;

  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">Departments</h1>
        <p className="mt-1 text-neutral-400">
          {activeCount} active · {departments.length} total
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {departments.map((department) => (
          <DepartmentCard
            key={department.id}
            department={department}
            stats={department.id === 'research' ? researchStats : undefined}
          />
        ))}
      </div>
    </div>
  );
}
