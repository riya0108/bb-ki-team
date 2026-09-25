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

// Thrown by approveVisualAsset/rejectVisualAsset when there is no visual asset
// waiting on a human decision for this content item — either the id doesn't match
// the latest row (a newer visual has since been prepared/generated for this
// content), or its status isn't one a human review action makes sense from (e.g.
// it's still GENERATION_PENDING with no pixels yet, or already APPROVED/REJECTED).
export class VisualNotReviewableError extends Error {
  constructor(contentId: string, visualId: string, actualStatus: string) {
    super(
      `Visual ${visualId} for content ${contentId} is not awaiting review (status is ` +
        `"${actualStatus}"). Only NEEDS_REVIEW or QA_PASS visuals with a stored asset can be ` +
        'approved or rejected.',
    );
    this.name = 'VisualNotReviewableError';
  }
}
