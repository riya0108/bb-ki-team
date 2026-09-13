export class RepurposeSourceInaccessibleError extends Error {
  constructor(sourceUrl: string, reason: string) {
    super(`Could not fetch the supplied source ${sourceUrl}: ${reason}`);
    this.name = 'RepurposeSourceInaccessibleError';
  }
}

export class YoutubeTranscriptUnavailableError extends Error {
  constructor(videoUrl: string, reason: string) {
    super(`Could not get a transcript for ${videoUrl}: ${reason}`);
    this.name = 'YoutubeTranscriptUnavailableError';
  }
}
