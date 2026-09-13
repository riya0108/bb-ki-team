export class NoTrustedSourcesError extends Error {
  constructor() {
    super('No active trusted X sources are registered — add sources before running discovery.');
    this.name = 'NoTrustedSourcesError';
  }
}

export class NoAccessibleSourcesError extends Error {
  constructor() {
    super('None of the registered trusted X sources were reachable.');
    this.name = 'NoAccessibleSourcesError';
  }
}

export class InsufficientDistinctTopicsError extends Error {
  constructor(found: number, needed: number) {
    super(
      `Only found ${found} genuinely distinct candidate topic(s) from accessible sources; need at least ` +
        `${needed} for this batch (spec 5.8's "never produce two drafts that are essentially the same" applies across platforms).`,
    );
    this.name = 'InsufficientDistinctTopicsError';
  }
}

export class RepurposeSourceInaccessibleError extends Error {
  constructor(sourceUrl: string, reason: string) {
    super(`Could not fetch the supplied repurpose source ${sourceUrl}: ${reason}`);
    this.name = 'RepurposeSourceInaccessibleError';
  }
}
