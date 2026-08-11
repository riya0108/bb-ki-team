import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { createLogger, loadEnv, newRunId, newStepId } from '@ai-company/core';
import {
  createApproval,
  createTask,
  createWorkflowRun,
  getWorkflowRun,
  listRecentWorkflowRuns,
  listTasksForRun,
  updateWorkflowRunStatus,
} from '@ai-company/db';
import { ApprovalRequestSchema } from '@ai-company/shared-types';
import { WORKFLOW_DEFINITIONS, getApprovalGate, getApprovalResolver } from '@ai-company/workflows';

const env = loadEnv(z.object({ API_PORT: z.coerce.number().int().positive().default(4000) }));
const logger = createLogger({ runId: 'api' });

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

async function handleRunWorkflow(
  req: IncomingMessage,
  res: ServerResponse,
  workflowName: string,
): Promise<void> {
  const definition = WORKFLOW_DEFINITIONS[workflowName];
  if (!definition) {
    sendJson(res, 404, { error: `unknown workflow "${workflowName}"` });
    return;
  }

  let input: unknown;
  try {
    input = definition.inputSchema.parse(await readJsonBody(req));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid request body' });
    return;
  }

  const runId = newRunId();
  await createWorkflowRun({ id: runId, workflowName, input });
  await createTask({
    id: newStepId(definition.firstTask.taskType),
    workflowRunId: runId,
    agent: definition.firstTask.agent,
    taskType: definition.firstTask.taskType,
    payload: definition.toFirstTaskPayload ? definition.toFirstTaskPayload(input) : input,
  });

  logger.info('workflow run created', { runId, workflowName });
  sendJson(res, 201, { runId });
}

async function handleGetWorkflowRun(res: ServerResponse, runId: string): Promise<void> {
  const run = await getWorkflowRun(runId);
  if (!run) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const tasks = await listTasksForRun(runId);
  sendJson(res, 200, { run, tasks });
}

async function handleListWorkflowRuns(res: ServerResponse): Promise<void> {
  const runs = await listRecentWorkflowRuns();
  sendJson(res, 200, { runs });
}

/**
 * Resolves a human decision at a workflow's current approval gate into the
 * next task, per CLAUDE.md's "no agent may call a publish-type tool except
 * after an approval gate has recorded an approved decision" — this endpoint
 * is the only place a post-gate task is ever created.
 */
async function handleApprove(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  const run = await getWorkflowRun(runId);
  if (!run) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  if (run.status !== 'awaiting_approval') {
    sendJson(res, 409, { error: `run "${runId}" is not awaiting approval (status: ${run.status})` });
    return;
  }

  let body: z.infer<typeof ApprovalRequestSchema>;
  try {
    body = ApprovalRequestSchema.parse(await readJsonBody(req));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid request body' });
    return;
  }

  const tasks = await listTasksForRun(runId);
  const gatedTask = tasks
    .filter((t) => t.status === 'succeeded')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const gate = gatedTask ? getApprovalGate(run.workflowName, gatedTask.taskType) : undefined;
  if (!gatedTask || !gate) {
    sendJson(res, 500, { error: 'no pending approval gate found for this run' });
    return;
  }

  const resolver = getApprovalResolver(run.workflowName, gate);
  if (!resolver) {
    sendJson(res, 500, { error: `no approval resolver registered for "${run.workflowName}"/"${gate}"` });
    return;
  }

  let nextStep;
  try {
    nextStep = resolver({
      decision: body.decision,
      ...(body.selection !== undefined ? { selection: body.selection } : {}),
      ...(body.feedback !== undefined ? { feedback: body.feedback } : {}),
      gatedResult: gatedTask.result,
      gatedPayload: gatedTask.payload,
      workflowName: run.workflowName,
      runInput: run.input,
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid approval decision' });
    return;
  }

  await createApproval({
    id: newStepId('approval'),
    workflowRunId: runId,
    gate,
    decision: body.decision,
    ...(body.selection !== undefined ? { selection: body.selection } : {}),
    ...(body.feedback !== undefined ? { feedback: body.feedback } : {}),
  });
  await createTask({
    id: newStepId(nextStep.taskType),
    workflowRunId: runId,
    agent: nextStep.agent,
    taskType: nextStep.taskType,
    payload: nextStep.payload,
  });
  await updateWorkflowRunStatus(runId, { status: 'running' });

  logger.info('approval recorded', { runId, gate, decision: body.decision });
  sendJson(res, 200, { runId, gate, nextTaskType: nextStep.taskType });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const runMatch = /^\/workflows\/([^/]+)\/run$/.exec(url.pathname);
  const approveMatch = /^\/workflows\/([^/]+)\/approve$/.exec(url.pathname);
  const statusMatch = /^\/workflows\/([^/]+)$/.exec(url.pathname);

  if (req.method === 'POST' && runMatch?.[1]) {
    await handleRunWorkflow(req, res, runMatch[1]);
    return;
  }

  if (req.method === 'POST' && approveMatch?.[1]) {
    await handleApprove(req, res, approveMatch[1]);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/workflows') {
    await handleListWorkflowRuns(res);
    return;
  }

  if (req.method === 'GET' && statusMatch?.[1]) {
    await handleGetWorkflowRun(res, statusMatch[1]);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => {
    logger.error('request failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, 500, { error: 'internal error' });
  });
});

server.listen(env.API_PORT, () => {
  logger.info('api listening', { port: env.API_PORT });
});
