export class RepurposeSourceInaccessibleError extends Error {
  constructor(sourceUrl: string, reason: string) {
    super(`Could not fetch the supplied source ${sourceUrl}: ${reason}`);
    this.name = 'RepurposeSourceInaccessibleError';
  }
}
