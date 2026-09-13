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
  AllProvidersFailedError: 502,
  LlmOutputValidationError: 502,
};

function statusForError(error: unknown): number {
  if (error instanceof Error && error.name in ERROR_STATUS) {
    return ERROR_STATUS[error.name] ?? 500;
  }
  return 500;
}

export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = statusForError(err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (status >= 500) {
      logger.error({ err, path: req.path, runId: req.header('x-run-id') }, 'Unhandled error in request');
    } else {
      logger.warn({ errName: name, path: req.path }, 'Request failed');
    }

    res.status(status).json({ error: name, message });
  };
}
