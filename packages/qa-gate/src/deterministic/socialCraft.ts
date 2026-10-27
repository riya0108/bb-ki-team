import { FORBIDDEN_PHRASES } from '@bb/core';

import { splitSentences } from '../editorial/text.js';

// Deterministic craft lint for short-form social copy (X, LinkedIn): the mechanical
// tells that make a post read as engagement bait, corporate filler or AI output,
// which a model tends to miss in its own drafts. 'fix' findings are worth one
// rewrite on their own; 'note' findings ride along only when a rewrite happens anyway,
// so a merely long opening line never doubles the LLM cost of a draft.
// See @bb/core's writingCraft.ts for the positive playbook these enforce.

export type SocialCraftPlatform = 'x' | 'linkedin';

export interface SocialCraftFinding {
  code: string;
  severity: 'fix' | 'note';
  message: string;
  evidence: string[];
}

const SHARED_BAIT: readonly string[] = [
  'let that sink in',
  'read that again',
  'this is huge',
  "you won't believe",
  'mind-blowing',
  'mind blowing',
  'game changer',
  'game-changer',
  'buckle up',
  "let's dive in",
  'follow for more',
  'follow me for more',
  "here's what you need to know",
  'in a recent development',
  "in today's fast-paced",
  "in today's rapidly",
  'as we navigate',
];

const PLATFORM_BAIT: Record<SocialCraftPlatform, readonly string[]> = {
  x: ['a thread', 'thread:', 'rt if', 'bookmark this', 'insane', 'unreal', 'shocked everyone', 'has everyone talking', 'something scary'],
  linkedin: ["i'm thrilled", 'i am thrilled', "i'm humbled", 'i am humbled', 'excited to announce', 'excited to share', 'this is a reminder that', 'businesses must adapt'],
};

const THROAT_CLEARING = /^(so|well|basically|interestingly|honestly|did you know|have you ever wondered|let me tell you|in a recent|in today['’]s)\b/i;
const BAIT_ENDING = /^(thoughts|agree|agreed|what do you think|let me know( in the comments)?|comment below)\s*[?!.]*$/i;
const FILLER = /\b(really|very|basically|actually|literally)\b/gi;
const NOT_X_BUT_Y = /\b(it['’]s not|this isn['’]t|it isn['’]t|not just)\b[^.?!\n]{1,80}[.,;]?\s*(it['’]s|but|this is)\b/gi;
const EMOJI = /\p{Extended_Pictographic}/gu;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

const LIMITS: Record<SocialCraftPlatform, { openingWordsNote: number; openingWordsFix: number; paragraphSentences: number; hashtags: number }> = {
  // X allows the compact-insight shape: one 2-4 sentence paragraph.
  x: { openingWordsNote: 20, openingWordsFix: 30, paragraphSentences: 4, hashtags: 0 },
  linkedin: { openingWordsNote: 25, openingWordsFix: 35, paragraphSentences: 3, hashtags: 3 },
};

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseHits(text: string, phrases: readonly string[]): string[] {
  const lower = normalise(text);
  return phrases.filter((p) => {
    const startsWord = /^\w/.test(p) ? '\\b' : '';
    const endsWord = /\w$/.test(p) ? '\\b' : '';
    return new RegExp(`${startsWord}${escapeRegExp(p)}${endsWord}`).test(lower);
  });
}

export function lintSocialCraft(text: string, platform: SocialCraftPlatform): SocialCraftFinding[] {
  const findings: SocialCraftFinding[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  // The first sentence, not the first line: a compact single-paragraph post is one line.
  const opening = splitSentences(lines[0] ?? '')[0] ?? '';
  const closing = lines[lines.length - 1] ?? '';
  const limits = LIMITS[platform];

  const bait = phraseHits(text, [...SHARED_BAIT, ...PLATFORM_BAIT[platform], ...FORBIDDEN_PHRASES]);
  if (bait.length > 0) {
    findings.push({
      code: 'cliche_or_bait',
      severity: 'fix',
      message: 'Remove engagement-bait, hype or corporate filler phrases; say the specific thing instead.',
      evidence: bait,
    });
  }

  if (THROAT_CLEARING.test(opening)) {
    findings.push({
      code: 'throat_clearing_opening',
      severity: 'fix',
      message: 'The opening clears its throat. Start on the most specific fact, number, name or tension.',
      evidence: [opening],
    });
  }

  const openingWords = opening.split(/\s+/).filter((w) => w.length > 0).length;
  if (openingWords > limits.openingWordsNote) {
    findings.push({
      code: 'long_opening',
      severity: openingWords > limits.openingWordsFix ? 'fix' : 'note',
      message: `The opening sentence runs ${openingWords} words. Cut it to the single sharpest claim (ideally under 15 words) and move the rest after it.`,
      evidence: [opening],
    });
  }

  if (lines.length > 1 && BAIT_ENDING.test(closing)) {
    findings.push({
      code: 'bait_ending',
      severity: 'fix',
      message: 'The ending is a generic engagement ask. End on the strongest line, or a specific question tied to this post.',
      evidence: [closing],
    });
  }

  const emoji = text.match(EMOJI) ?? [];
  if (emoji.length > 1) {
    findings.push({
      code: 'emoji',
      severity: 'fix',
      message: 'At most one emoji, and only in the hook if it earns its place.',
      evidence: emoji,
    });
  }

  const hashtags = (text.match(HASHTAG) ?? []).map((h) => h.trim());
  if (hashtags.length > limits.hashtags) {
    findings.push({
      code: 'hashtags_in_copy',
      severity: 'fix',
      message:
        platform === 'x'
          ? 'Keep hashtags out of the post text; they are chosen separately in the hashtags field.'
          : `Use at most ${limits.hashtags} hashtags, at the very end.`,
      evidence: hashtags,
    });
  }

  if (/—|--/.test(text)) {
    findings.push({ code: 'em_dash', severity: 'fix', message: 'Replace every em dash with a comma, colon, full stop or line break.', evidence: ['—'] });
  }

  const filler = text.match(FILLER) ?? [];
  if (filler.length > 2) {
    findings.push({
      code: 'filler_words',
      severity: 'note',
      message: 'Cut filler adverbs; use a stronger verb or a number instead.',
      evidence: [...new Set(filler.map((f) => f.toLowerCase()))],
    });
  }

  const contrasts = text.match(NOT_X_BUT_Y) ?? [];
  if (contrasts.length > 1) {
    findings.push({
      code: 'repeated_not_x_but_y',
      severity: 'note',
      message: 'The "it\'s not X, it\'s Y" construction appears more than once and reads as formulaic. Keep at most one.',
      evidence: contrasts,
    });
  }

  const walls = text
    .split(/\n\s*\n/)
    .filter((p) => splitSentences(p.replace(/\n/g, ' ')).length > limits.paragraphSentences);
  if (walls.length > 0) {
    findings.push({
      code: 'wall_of_text',
      severity: 'note',
      message: `Break long paragraphs up: at most ${limits.paragraphSentences} sentences per paragraph, one thought per line.`,
      evidence: walls.map((w) => `${w.slice(0, 80)}...`),
    });
  }

  return findings;
}

// Revision notes for the writer's single craft rewrite, or [] when nothing warrants one.
export function socialCraftRevisionNotes(findings: readonly SocialCraftFinding[]): string[] {
  if (!findings.some((f) => f.severity === 'fix')) return [];
  return findings.map((f) => `${f.message}${f.evidence.length > 0 ? ` (found: ${f.evidence.slice(0, 4).map((e) => `"${e}"`).join(', ')})` : ''}`);
}
