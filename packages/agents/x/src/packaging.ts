import type { ContentItem, XMode, XPackage } from '@bb/shared-types';
import { XPackageSchema } from '@bb/shared-types';

import type { DraftXOutput } from './draftPost.js';
import { splitPostIntoThread, X_MAX_POST_LENGTH } from './threadSplit.js';

// Spec 6.2's 280-char limit, enforced at draft time rather than only at publish time
// (xClient.ts's mirror of this same check) — a drafted or revised post that comes
// back too long for its declared shape is auto-threaded before it's ever persisted,
// so it can reach 'in_review'/'approved' but never fails only once someone tries to
// actually publish it. Every flow that persists draft.finalCopy/mode/threadPosts
// directly (topicMode.ts, repurpose.ts, sourceDiscovery.ts, editPost.ts) wraps
// draftXPost's/the revise call's result in this before using it. quote.ts is
// deliberately excluded — a quote-commentary post is always single-shaped by design
// (see buildXPackage below), never threaded.
export function enforceXLengthLimit(output: DraftXOutput): DraftXOutput {
  const posts = output.mode === 'thread' ? (output.threadPosts ?? [output.finalCopy]) : [output.finalCopy];
  if (posts.every((post) => post.length <= X_MAX_POST_LENGTH)) return output;

  const rebuilt = posts.flatMap((post) => (post.length > X_MAX_POST_LENGTH ? splitPostIntoThread(post) : [post]));
  return { ...output, mode: 'thread', finalCopy: rebuilt[0] ?? output.finalCopy, threadPosts: rebuilt };
}

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
