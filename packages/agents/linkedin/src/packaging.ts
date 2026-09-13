import type { ContentItem, LinkedinPackage, QaResult } from '@bb/shared-types';
import { LinkedinPackageSchema } from '@bb/shared-types';

import type { DraftLinkedinPostOutput } from './draftPost.js';

// Assembles the LINKEDIN_PACKAGE output contract (spec 5.7) from the persisted content
// item, the LLM's drafting output, and the QA gate result. Phase 1 never publishes or
// schedules, so approvalRequired/publishAction/scheduleDetails are always the fixed
// "nothing has been sent anywhere" values.
export function buildLinkedinPackage(
  item: ContentItem,
  draft: DraftLinkedinPostOutput,
  qa: QaResult,
): LinkedinPackage {
  return LinkedinPackageSchema.parse({
    contentId: item.id,
    status: item.status,
    mode: item.mode,
    topic: item.topic,
    sourceReferences: item.sourceUrls,
    angle: item.angle,
    hookOptions: draft.hookOptions,
    finalPost: item.currentText,
    characterCount: item.currentText.length,
    contentDnaVersion: item.contentDnaVersion,
    factCheckStatus: draft.factCheckStatus,
    originalityStatus: draft.originalityStatus,
    riskFlags: qa.riskFlags,
    visualSuggestion: draft.visualSuggestion,
    firstCommentOptional: draft.firstCommentOptional,
    approvalRequired: true,
    publishAction: 'none',
    scheduleDetails: null,
  });
}
