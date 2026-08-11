import { randomUUID } from 'node:crypto';
import { createLogger } from '@ai-company/core';
import {
  claimNextTask,
  completeTask,
  createTask,
  failTask,
  getWorkflowRun,
  markTaskRunning,
  updateWorkflowRunStatus,
} from '@ai-company/db';
import { getApprovalGate, getNextStep } from '@ai-company/workflows';
import { configureAgentEnv } from './agentEnv.js';
import { dispatch } from './dispatch.js';

configureAgentEnv();

const WORKER_ID = `worker_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 1000;
const logger = createLogger({ runId: 'worker' });

async function processTask(): Promise<boolean> {
  const task = await claimNextTask(WORKER_ID);
  if (!task) return false;

  const taskLogger = logger.child({ runId: task.workflowRunId, stepId: task.id });
  taskLogger.info('task claimed', { agent: task.agent, taskType: task.taskType });

  const run = await getWorkflowRun(task.workflowRunId);
  if (run?.status === 'queued') {
    await updateWorkflowRunStatus(run.id, { status: 'running', markStarted: true });
  }

  await markTaskRunning(task.id);

  try {
    const result = await dispatch(task);
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
