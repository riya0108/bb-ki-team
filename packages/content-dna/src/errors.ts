export class NoActiveDnaError extends Error {
  constructor() {
    super('No active Content DNA version exists yet — run onboarding and confirm a draft first.');
    this.name = 'NoActiveDnaError';
  }
}

export class InvalidDnaDraftError extends Error {
  constructor(missingFields: string[]) {
    super(`Content DNA draft is missing required fields: ${missingFields.join(', ')}`);
    this.name = 'InvalidDnaDraftError';
  }
}

export class LearningEventNotFoundError extends Error {
  constructor(eventId: string) {
    super(`No learning event with id ${eventId}`);
    this.name = 'LearningEventNotFoundError';
  }
}

export class WeakLearningSignalError extends Error {
  constructor(strength: string) {
    super(
      `Learning event has strength "${strength}", which is too weak to apply to Content DNA (only "strong" and "very_strong" signals may change the DNA — spec section 3.4).`,
    );
    this.name = 'WeakLearningSignalError';
  }
}
