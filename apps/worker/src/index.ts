import { randomUUID } from 'node:crypto';
import { CancelledError, createLogger, runWithCancellation } from '@ai-company/core';
import {
  cancelTask,
  claimNextTask,
  completeTask,
  createTask,
  failTask,
  getWorkflowRun,
  isWorkflowRunCancellationRequested,
  markTaskRunning,
  updateWorkflowRunStatus,
} from '@ai-company/db';
import { getApprovalGate, getNextStep } from '@ai-company/workflows';
import { configureAgentEnv } from './agentEnv.js';
import { dispatch } from './dispatch.js';

configureAgentEnv();

const WORKER_ID = `worker_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 1000;
const CANCELLATION_POLL_INTERVAL_MS = 1000;
const logger = createLogger({ runId: 'worker' });

async function processTask(): Promise<boolean> {
  const task = await claimNextTask(WORKER_ID);
  if (!task) return false;

  const taskLogger = logger.child({ runId: task.workflowRunId, stepId: task.id });
  taskLogger.info('task claimed', { agent: task.agent, taskType: task.taskType });

  const run = await getWorkflowRun(task.workflowRunId);

  // A run stopped before this task ever started — either it was already
  // marked 'cancelled' (stopped while queued/awaiting_approval), or it was
  // flagged mid-flight but its previous task finished and chained to this
  // one before the worker noticed. Either way, this task never dispatches:
  // that's what actually stops a chained pipeline from burning another
  // round of LLM/search calls after "stop" is clicked.
  if (run?.status === 'cancelled') {
    await cancelTask(task.id);
    taskLogger.warn('task cancelled before dispatch (run already cancelled)');
    return true;
  }
  if (run && (await isWorkflowRunCancellationRequested(run.id))) {
    await cancelTask(task.id);
    await updateWorkflowRunStatus(run.id, { status: 'cancelled', markFinished: true });
    taskLogger.warn('task cancelled before dispatch (cancellation was pending)');
    return true;
  }

  if (run?.status === 'queued') {
    await updateWorkflowRunStatus(run.id, { status: 'running', markStarted: true });
  }

  await markTaskRunning(task.id);

  // Polls the DB for a cancellation request raised by apps/api while this
  // task's agent pipeline is running, and aborts `controller` the moment one
  // shows up — runWithCancellation makes that signal visible to every LLM
  // call the pipeline makes (see packages/core/src/llm.ts), regardless of
  // how deep in the agent's call stack it currently is.
  const controller = new AbortController();
  const cancellationPoll = setInterval(() => {
    isWorkflowRunCancellationRequested(task.workflowRunId)
      .then((cancelled) => {
        if (cancelled) controller.abort();
      })
      .catch((error: unknown) => {
        taskLogger.error('cancellation poll failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, CANCELLATION_POLL_INTERVAL_MS);

  try {
    const result = await runWithCancellation(controller.signal, () => dispatch(task));
    await completeTask(task.id, result);
    taskLogger.info('task succeeded');

    const gate = run ? getApprovalGate(run.workflowName, task.taskType) : undefined;
    if (gate) {
      await updateWorkflowRunStatus(task.workflowRunId, {
        status: 'awaiting_approval',
        output: result,
      });
      taskLogger.info('awaiting human approval', { gate });
    } else {
      const nextStep = run
        ? getNextStep(run.workflowName, task.taskType, result, task.payload)
        : undefined;
      if (nextStep) {
        await createTask({
          id: `step_${nextStep.taskType}_${randomUUID().slice(0, 8)}`,
          workflowRunId: task.workflowRunId,
          agent: nextStep.agent,
          taskType: nextStep.taskType,
          payload: nextStep.payload,
        });
        taskLogger.info('follow-up task enqueued', { nextTaskType: nextStep.taskType });
      } else {
        await updateWorkflowRunStatus(task.workflowRunId, {
          status: 'succeeded',
          output: result,
          markFinished: true,
        });
        taskLogger.info('workflow run succeeded');
      }
    }
  } catch (error) {
    if (error instanceof CancelledError || controller.signal.aborted) {
      await cancelTask(task.id);
      await updateWorkflowRunStatus(task.workflowRunId, {
        status: 'cancelled',
        markFinished: true,
      });
      taskLogger.warn('task cancelled mid-run');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      taskLogger.error('task failed', { error: message });
      const updated = await failTask(task.id, message);
      if (updated.status === 'failed') {
        await updateWorkflowRunStatus(task.workflowRunId, {
          status: 'failed',
          error: message,
          markFinished: true,
        });
        taskLogger.error('workflow run failed', { attempts: updated.attempts });
      } else {
        taskLogger.warn('task will retry', {
          attempts: updated.attempts,
          maxAttempts: updated.maxAttempts,
        });
      }
    }
  } finally {
    clearInterval(cancellationPoll);
  }

  return true;
}

async function main(): Promise<void> {
  logger.info('worker started', { workerId: WORKER_ID });
  for (;;) {
    const didWork = await processTask();
    if (!didWork) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

await main();
