// Skill's own sentinel (SKILL.md: "If the required truth layer is missing, return
// VISUAL_BLOCKED_MISSING_TRUTH_LAYER") — thrown rather than silently producing a
// NOT_REQUIRED asset, since a missing truth layer is a caller error (visual stage
// invoked before the content item has a core claim and QA has run), not a
// legitimate "no visual needed" decision.
export class VisualBlockedMissingTruthLayerError extends Error {
  constructor(contentId: string) {
    super(
      `VISUAL_BLOCKED_MISSING_TRUTH_LAYER: content item ${contentId} has no core claim or QA result yet`,
    );
    this.name = 'VisualBlockedMissingTruthLayerError';
  }
}

export class VisualContentNotFoundError extends Error {
  constructor(contentId: string) {
    super(`Content item ${contentId} not found`);
    this.name = 'VisualContentNotFoundError';
  }
}
