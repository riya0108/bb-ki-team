import { notFound } from 'next/navigation';
import { getDepartment } from '@/lib/departments';
import { listResearchRuns } from '@/lib/runStore';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ResearchDepartmentView } from '@/components/research/ResearchDepartmentView';

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const department = getDepartment(id);
  if (!department) {
    notFound();
  }

  const runs = department.id === 'research' ? await listResearchRuns() : [];

  return (
    <div className="max-w-6xl space-y-8 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">Department</p>
          <h1 className="text-2xl font-semibold text-white">{department.name}</h1>
          <p className="mt-1 max-w-xl text-neutral-400">{department.description}</p>
        </div>
        <StatusBadge status={department.status} />
      </header>

      {department.id === 'research' ? (
        <ResearchDepartmentView initialRuns={runs} />
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
          <p className="font-medium text-neutral-300">No agents configured for {department.name} yet</p>
          <p className="mt-1 text-sm">This department comes online in a later phase of the roadmap.</p>
        </div>
      )}
    </div>
  );
}
