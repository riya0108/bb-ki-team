import type { ContentItem, EditorialSummary, XMode, XPackage } from '@bb/shared-types';
import { XPackageSchema } from '@bb/shared-types';

import type { DraftXOutput } from './draftPost.js';
import { MAX_X_HASHTAGS } from './draftPost.js';
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

function normalizeHashtag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, '');
  if (!tag || /\s/.test(tag)) return null;
  return `#${tag}`;
}

// Attaches the up-to-3 reach-boosting hashtags draftXPost chose to the first post
// only — finalCopy, and threadPosts[0] when the draft is a thread — never to
// continuation posts, per the reach-boost ask: the hashtags sell the thread, they
// don't need repeating once someone's already reading it. Must run after
// enforceXLengthLimit so the 280-char budget checked here is the real remaining
// budget; a hashtag block that doesn't fit is trimmed hashtag-by-hashtag (never by
// cutting the post's own text) and output.hashtags is rewritten to match whatever
// was actually attached, so the persisted package stays truthful about what's live.
export function appendHashtags(output: DraftXOutput): DraftXOutput {
  const hashtags = [...new Set((output.hashtags ?? []).map(normalizeHashtag).filter((t): t is string => t !== null))].slice(
    0,
    MAX_X_HASHTAGS,
  );
  if (hashtags.length === 0) return output;

  let applied: string[] = [];
  const attach = (post: string): string => {
    for (let count = hashtags.length; count > 0; count--) {
      const candidateTags = hashtags.slice(0, count);
      const candidate = `${post}\n\n${candidateTags.join(' ')}`;
      if (candidate.length <= X_MAX_POST_LENGTH) {
        applied = candidateTags;
        return candidate;
      }
    }
    applied = [];
    return post;
  };

  const threadPosts = output.mode === 'thread' ? output.threadPosts : null;
  if (threadPosts === null || threadPosts.length === 0) {
    const finalCopy = attach(output.finalCopy);
    return { ...output, finalCopy, hashtags: applied };
  }

  // Thread mode keeps finalCopy === threadPosts[0] (same invariant enforceXLengthLimit
  // maintains) — so both fields are updated from the one attach call, never drifting.
  const [firstPost, ...restPosts] = threadPosts;
  const updatedFirst = attach(firstPost ?? output.finalCopy);
  return { ...output, finalCopy: updatedFirst, threadPosts: [updatedFirst, ...restPosts], hashtags: applied };
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
export function buildXPackage(
  item: ContentItem,
  draft: DraftXOutput,
  mode: XMode = draft.mode,
  editorialSummary: EditorialSummary | null = null,
): XPackage {
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
    hashtags: draft.hashtags,
    contentDnaVersion: item.contentDnaVersion,
    approvalRequired: true,
    publishAction: 'none',
    editorialSummary,
  });
}
