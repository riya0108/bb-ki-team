export type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  runId: string;
  stepId?: string;
  [key: string]: unknown;
}

export interface Logger {
  child(context: Partial<LogContext>): Logger;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

interface WritableSink {
  write(chunk: string): unknown;
}

function emit(
  sink: WritableSink,
  level: LogLevel,
  context: LogContext,
  message: string,
  fields?: Record<string, unknown>,
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
    ...fields,
  };
  sink.write(`${JSON.stringify(entry)}\n`);
}

/**
 * Structured logger tagged with run_id/step_id per CLAUDE.md's audit-trail
 * requirement. Writes newline-delimited JSON to `sink` (defaults to stdout);
 * MCP stdio servers must pass process.stderr since stdout is the RPC channel.
 */
export function createLogger(context: LogContext, sink: WritableSink = process.stdout): Logger {
  return {
    child(extra) {
      return createLogger({ ...context, ...extra }, sink);
    },
    info(message, fields) {
      emit(sink, 'info', context, message, fields);
    },
    warn(message, fields) {
      emit(sink, 'warn', context, message, fields);
    },
    error(message, fields) {
      emit(sink, 'error', context, message, fields);
    },
  };
}
