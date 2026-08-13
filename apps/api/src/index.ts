import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { createLogger, loadEnv, newRunId, newStepId } from '@ai-company/core';
import {
  cancelActiveTasksForRun,
  cancelWorkflowRunNow,
  createApproval,
  createTask,
  createWorkflowRun,
  forceCancelWorkflowRun,
  getWorkflowRun,
  listRecentWorkflowRuns,
  listTasksForRun,
  requestWorkflowRunCancellation,
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

const CANCEL_GRACE_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stops an in-progress run so it stops consuming LLM/search calls. A run
 * with no task actively executing ('queued', nothing claimed yet, or
 * 'awaiting_approval', paused for a human) is finalized to 'cancelled'
 * immediately. A 'running' run is flagged instead — apps/worker polls that
 * flag every ~1s while the task is in flight and aborts it cooperatively
 * (see apps/worker/src/index.ts).
 *
 * That cooperative flag only works if a worker is actually still polling it.
 * If the worker process that claimed the task died or was restarted (a real
 * failure mode we've hit locally — a task got stuck reporting 'running'
 * indefinitely with no worker left to ever notice the flag), the flag alone
 * would leave the run "Working" forever with no way to stop it. So after
 * flagging, this waits a short grace period — generous relative to the
 * worker's 1s poll interval — and if the run is *still* 'running', treats it
 * as orphaned and force-finalizes it directly instead.
 */
async function handleCancel(res: ServerResponse, runId: string): Promise<void> {
  const run = await getWorkflowRun(runId);
  if (!run) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
    sendJson(res, 409, { error: `run "${runId}" already finished (status: ${run.status})` });
    return;
  }

  if (run.status === 'running') {
    await requestWorkflowRunCancellation(runId);
    await sleep(CANCEL_GRACE_MS);
    const latest = await getWorkflowRun(runId);
    if (latest?.status === 'running') {
      await cancelActiveTasksForRun(runId);
      await forceCancelWorkflowRun(runId);
      logger.warn('force-cancelled orphaned running run', { runId });
    }
  } else {
    await cancelWorkflowRunNow(runId);
  }

  logger.info('cancellation requested', { runId, previousStatus: run.status });
  sendJson(res, 200, { runId });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const runMatch = /^\/workflows\/([^/]+)\/run$/.exec(url.pathname);
  const approveMatch = /^\/workflows\/([^/]+)\/approve$/.exec(url.pathname);
  const cancelMatch = /^\/workflows\/([^/]+)\/cancel$/.exec(url.pathname);
  const statusMatch = /^\/workflows\/([^/]+)$/.exec(url.pathname);

  if (req.method === 'POST' && runMatch?.[1]) {
    await handleRunWorkflow(req, res, runMatch[1]);
    return;
  }

  if (req.method === 'POST' && approveMatch?.[1]) {
    await handleApprove(req, res, approveMatch[1]);
    return;
  }

  if (req.method === 'POST' && cancelMatch?.[1]) {
    await handleCancel(res, cancelMatch[1]);
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
