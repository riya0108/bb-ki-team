import { randomUUID } from 'node:crypto';

export function newRunId(): string {
  return `run_${randomUUID()}`;
}

export function newStepId(step: string): string {
  return `step_${step}_${randomUUID().slice(0, 8)}`;
}
