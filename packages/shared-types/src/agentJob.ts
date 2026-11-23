import { z } from 'zod';

// Mirrors the agent_jobs table (packages/db/migrations/0021_agent_jobs.sql): the
// queue between the deployed API and a worker elsewhere (the Blog agent's worker on
// the operator's Mac, where Claude Code runs).
export const AgentJobStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);
export type AgentJobStatus = z.infer<typeof AgentJobStatusSchema>;

// Payload of a 'chat' job: one head-agent chat message, exactly what the synchronous
// POST /:platform/chat route takes.
export const ChatJobPayloadSchema = z.object({
  message: z.string().min(1),
  openContentId: z.string().uuid().nullable(),
});
export type ChatJobPayload = z.infer<typeof ChatJobPayloadSchema>;

// Result of a finished 'chat' job: exactly what the synchronous route returns.
export const ChatJobResultSchema = z.object({
  reply: z.string(),
  action: z.string(),
  result: z.unknown(),
});
export type ChatJobResult = z.infer<typeof ChatJobResultSchema>;

export const AgentJobSchema = z.object({
  id: z.string().uuid(),
  platform: z.string(),
  kind: z.string(),
  sessionId: z.string().uuid().nullable(),
  runId: z.string().uuid(),
  payload: z.unknown(),
  status: AgentJobStatusSchema,
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  workerId: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  heartbeatAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type AgentJob = z.infer<typeof AgentJobSchema>;
