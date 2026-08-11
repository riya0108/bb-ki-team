import type { ApprovalGate } from '@ai-company/shared-types';

/**
 * Declares which (workflowName, taskType) pairs pause a run for human
 * approval, and which gate they belong to. apps/worker checks this before
 * auto-chaining a completed task's next step; a declared pair means "stop
 * and wait for POST /workflows/:runId/approve" instead.
 */
export const WORKFLOW_APPROVAL_GATES: Record<string, Record<string, ApprovalGate>> = {
  blog: {
    run_research: 'topic',
    write_draft: 'draft',
  },
  'content-intelligence': {
    synthesize: 'topic',
    write_draft: 'draft',
  },
};

export function getApprovalGate(workflowName: string, taskType: string): ApprovalGate | undefined {
  return WORKFLOW_APPROVAL_GATES[workflowName]?.[taskType];
}
