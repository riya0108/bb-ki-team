import type { NextStepResolver } from '../steps.js';
import { BLOG_RESOLVERS } from './blog.js';

/**
 * 'content-intelligence' now starts directly at content-strategy's
 * `synthesize` (see definitions.ts) — the blog-topic-finder /
 * youtube-viral-finder / instagram-viral-finder steps are their own
 * standalone workflows the user runs independently, not auto-chained ahead
 * of this one. `synthesize` itself has no resolver here because it's the
 * 'topic' approval gate (see gates.ts) — everything after that gate
 * (build_pack -> write_draft -> gate 'draft' -> publish_post) is identical
 * to blog's own chain, so BLOG_RESOLVERS is spread in rather than
 * duplicated (CLAUDE.md: no duplicate responsibilities).
 */
export const CONTENT_INTELLIGENCE_RESOLVERS: Record<string, NextStepResolver> = {
  ...BLOG_RESOLVERS,
};
