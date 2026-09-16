import type { Logger } from '@bb/core';
import type { NextFunction, Request, Response } from 'express';

// Maps known error classes (by name, matching each package's `this.name = 'X'`
// convention — see packages/*/src/errors.ts) to an HTTP status, without every
// package needing to be an explicit dependency of this app. Unlisted errors default
// to 500 rather than leaking implementation details to the client.
const ERROR_STATUS: Record<string, number> = {
  ValidationError: 400,
  NoActiveDnaError: 409,
  InvalidDnaDraftError: 422,
  WeakLearningSignalError: 422,
  NoTrustedSourcesError: 409,
  NoAccessibleSourcesError: 502,
  InsufficientDistinctTopicsError: 422,
  RepurposeSourceInaccessibleError: 502,
  YoutubeTranscriptUnavailableError: 502,
  InterviewNotFoundError: 404,
  InterviewAlreadyCompletedError: 409,
  InterviewNotCompletedError: 409,
  LearningEventNotFoundError: 404,
  ContentItemNotFoundError: 404,
  IllegalTransitionError: 409,
  StaleApprovalVersionError: 409,
  ContentNotApprovedError: 409,
  ContentNotScheduledError: 409,
  AllProvidersFailedError: 502,
  LlmOutputValidationError: 502,
};

function statusForError(error: unknown): number {
  if (error instanceof Error && error.name in ERROR_STATUS) {
    return ERROR_STATUS[error.name] ?? 500;
  }
  return 500;
}

function isMappedError(error: unknown): boolean {
  return error instanceof Error && error.name in ERROR_STATUS;
}

export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = statusForError(err);
    const name = err instanceof Error ? err.name : 'Error';

    if (status >= 500) {
      logger.error({ err, path: req.path, runId: req.header('x-run-id') }, 'Unhandled error in request');
    } else {
      logger.warn({ errName: name, path: req.path }, 'Request failed');
    }

    // Known/mapped errors (ERROR_STATUS above) throw deliberately worded messages
    // meant to reach the client — including the 502s (AllProvidersFailedError,
    // NoAccessibleSourcesError, ...), which are real, safe-to-share operational
    // failures ("every LLM provider is rate-limited", "couldn't fetch that source"),
    // not leaked internals. Only a genuinely UNMAPPED error — one nothing
    // anticipated, whose message might be a raw DB/provider error containing
    // internal details — falls back to the generic "Internal Server Error"; the
    // real message for those is already in the log line above. Checking
    // "unmapped" directly (not just "status >= 500") matters because several
    // mapped errors deliberately use a 5xx status themselves.
    const message = isMappedError(err)
      ? err instanceof Error
        ? err.message
        : 'Unknown error'
      : 'Internal Server Error';

    res.status(status).json({ error: name, message });
  };
}
