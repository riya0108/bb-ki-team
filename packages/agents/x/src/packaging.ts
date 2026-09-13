import type { ContentItem, XMode, XPackage } from '@bb/shared-types';
import { XPackageSchema } from '@bb/shared-types';

import type { DraftXOutput } from './draftPost.js';

// Assembles the X_PACKAGE output contract (spec 6.4). Unlike LinkedIn's contract, X's
// has no risk_flags field, so the QA result isn't consumed here — recordQaResult still
// persists it separately. Phase 2 never publishes or schedules, so
// approvalRequired/publishAction are always the fixed "nothing has been sent
// anywhere" values, same as LinkedIn.
//
// `mode` defaults to whatever draftXPost decided (single/thread) but callers in quote
// mode override it to 'quote' — spec 6.4 lists mode as single | thread | quote, a
// mix of output *shape* and *purpose*; a quote-commentary post is always single-shaped
// under the hood (see quote.ts) but labeled 'quote' at the package level.
export function buildXPackage(item: ContentItem, draft: DraftXOutput, mode: XMode = draft.mode): XPackage {
  return XPackageSchema.parse({
    contentId: item.id,
    status: item.status,
    mode,
    topic: item.topic,
    angle: item.angle,
    hookOptions: draft.hookOptions,
    finalCopy: item.currentText,
    threadPosts: draft.threadPosts,
    sourceReferences: item.sourceUrls,
    factCheckStatus: draft.factCheckStatus,
    contentDnaVersion: item.contentDnaVersion,
    approvalRequired: true,
    publishAction: 'none',
  });
}
