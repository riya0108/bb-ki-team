export class NoTrustedSourcesError extends Error {
  constructor() {
    super('No active trusted LinkedIn sources are registered — add sources before running source discovery.');
    this.name = 'NoTrustedSourcesError';
  }
}

export class NoAccessibleSourcesError extends Error {
  constructor() {
    super('None of the registered trusted LinkedIn sources were reachable.');
    this.name = 'NoAccessibleSourcesError';
  }
}

export class InsufficientDistinctTopicsError extends Error {
  constructor(found: number, needed: number) {
    super(
      `Only found ${found} genuinely distinct candidate topic(s) from accessible sources; need at least ` +
        `${needed} for a source-discovery batch (spec 5.4/5.8 — never produce two drafts that are essentially the same).`,
    );
    this.name = 'InsufficientDistinctTopicsError';
  }
}

// Internal invariant guard: a candidate topic's sourceUrl should always resolve back
// to one of the sources we actually fetched (see sourceDiscovery.ts's pre-filter).
// Reaching this means that filter was bypassed, not that the LLM lied about a URL.
export class UnresolvedCandidateSourceError extends Error {
  constructor(sourceUrl: string) {
    super(`Candidate topic referenced sourceUrl ${sourceUrl}, which was not among the fetched sources.`);
    this.name = 'UnresolvedCandidateSourceError';
  }
}

export class InterviewNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`No PostCast interview session with id ${sessionId}`);
    this.name = 'InterviewNotFoundError';
  }
}

export class InterviewAlreadyCompletedError extends Error {
  constructor(sessionId: string) {
    super(`PostCast interview session ${sessionId} is already completed and cannot accept another answer.`);
    this.name = 'InterviewAlreadyCompletedError';
  }
}

export class RepurposeSourceInaccessibleError extends Error {
  constructor(sourceUrl: string, reason: string) {
    super(`Could not fetch the supplied repurpose source ${sourceUrl}: ${reason}`);
    this.name = 'RepurposeSourceInaccessibleError';
  }
}

export class YoutubeTranscriptUnavailableError extends Error {
  constructor(videoUrl: string, reason: string) {
    super(`Could not get a transcript for ${videoUrl}: ${reason}`);
    this.name = 'YoutubeTranscriptUnavailableError';
  }
}

export class InterviewNotCompletedError extends Error {
  constructor(sessionId: string) {
    super(
      `PostCast interview session ${sessionId} is still active — finish the interview before extracting post ideas from it.`,
    );
    this.name = 'InterviewNotCompletedError';
  }
}
