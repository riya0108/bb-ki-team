import { notFound } from 'next/navigation';
import { getDepartment } from '@/lib/departments';
import { listResearchRuns, listTrendResearchRuns } from '@/lib/workflowRuns';
import { listPipelineRuns } from '@/lib/pipelineRuns';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ResearchDepartmentView } from '@/components/research/ResearchDepartmentView';
import { TrendResearchDepartmentView } from '@/components/trend/TrendResearchDepartmentView';
import { BlogDepartmentView } from '@/components/blog/BlogDepartmentView';
import { BlogTopicRunsList } from '@/components/blog/BlogTopicRunsList';
import { ContentIntelligenceDepartmentView } from '@/components/contentIntelligence/ContentIntelligenceDepartmentView';
import { ContentIntelligenceRunsList } from '@/components/contentIntelligence/ContentIntelligenceRunsList';
import { ResearchAgentDepartmentView } from '@/components/researchAgent/ResearchAgentDepartmentView';
import { ContentDepartmentView } from '@/components/content/ContentDepartmentView';
import { BlogAgentDepartmentView } from '@/components/blogAgent/BlogAgentDepartmentView';

const PIPELINE_DEPARTMENT_IDS = new Set(['blog', 'content-intelligence', 'research-agent', 'content', 'blog-agent']);

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const department = getDepartment(id);
  if (!department) {
    notFound();
  }

  const researchRuns = department.id === 'research' ? await listResearchRuns() : [];
  const trendRuns = department.id === 'trend-research' ? await listTrendResearchRuns() : [];
  const pipelineRuns = PIPELINE_DEPARTMENT_IDS.has(department.id)
    ? await listPipelineRuns(['blog', 'content-intelligence'])
    : [];

  return (
    <div className="max-w-6xl space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">Department</p>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white sm:text-2xl">{department.name}</h1>
          <p className="mt-1 max-w-xl text-neutral-500 dark:text-neutral-400">{department.description}</p>
        </div>
        <StatusBadge status={department.status} />
      </header>

      {department.id === 'research' ? (
        <ResearchDepartmentView initialRuns={researchRuns} />
      ) : department.id === 'trend-research' ? (
        <TrendResearchDepartmentView initialRuns={trendRuns} />
      ) : department.id === 'blog' ? (
        <div className="space-y-8">
          <BlogDepartmentView />
          <BlogTopicRunsList initialRuns={pipelineRuns.filter((run) => run.workflowName === 'blog')} />
        </div>
      ) : department.id === 'content-intelligence' ? (
        <div className="space-y-8">
          <ContentIntelligenceDepartmentView />
          <ContentIntelligenceRunsList
            initialRuns={pipelineRuns.filter((run) => run.workflowName === 'content-intelligence')}
          />
        </div>
      ) : department.id === 'research-agent' ? (
        <ResearchAgentDepartmentView initialRuns={pipelineRuns} />
      ) : department.id === 'content' ? (
        <ContentDepartmentView initialRuns={pipelineRuns} />
      ) : department.id === 'blog-agent' ? (
        <BlogAgentDepartmentView initialRuns={pipelineRuns} />
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-800">
          <p className="font-medium text-neutral-700 dark:text-neutral-300">
            No agents configured for {department.name} yet
          </p>
          <p className="mt-1 text-sm">This department comes online in a later phase of the roadmap.</p>
        </div>
      )}
    </div>
  );
}
