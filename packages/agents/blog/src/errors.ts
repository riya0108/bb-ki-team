export class RepurposeSourceInaccessibleError extends Error {
  constructor(sourceUrl: string, reason: string) {
    super(`Could not fetch the supplied source ${sourceUrl}: ${reason}`);
    this.name = 'RepurposeSourceInaccessibleError';
  }
}

export class InvalidArticleHtmlError extends Error {
  constructor(issues: string[]) {
    super(`Generated article HTML failed validation: ${issues.join('; ')}`);
    this.name = 'InvalidArticleHtmlError';
  }
}
