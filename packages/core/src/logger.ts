import pino from 'pino';

export interface LogContext {
  module: string;
  runId?: string;
  stepId?: string;
}

const isDev = process.env.NODE_ENV !== 'production';

const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});

// Sanctioned logging entry point for library code — nothing else should call
// console.* directly (see eslint's no-console rule). run_id/step_id are passed
// explicitly rather than stored as ambient state, so callers stay unit-testable.
export function createLogger(context: LogContext): pino.Logger {
  return rootLogger.child(context);
}

export type Logger = pino.Logger;
