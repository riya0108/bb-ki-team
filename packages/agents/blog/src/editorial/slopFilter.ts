import { FORBIDDEN_PHRASES } from '@bb/core';
import { splitSentences } from '@bb/qa-gate';

// Spec 14/16/33: deterministic anti-AI-writing checks. These catch the mechanical
// tells (stock phrases, generic openings/endings, repetitive constructions) that a
// model critic tends to miss in its own family's output. The critic's aiSlopRiskScore
// can never be lower than the score computed here.

export interface SlopFinding {
  code: string;
  severity: 'warn' | 'block';
  message: string;
  evidence: string[];
}

export interface SlopReport {
  riskScore: number;
  findings: SlopFinding[];
}

// Stock AI phrasing. Matched case-insensitively on word boundaries. Brand-wide
// FORBIDDEN_PHRASES (spec 2.3) are folded in so this list stays a superset.
export const AI_SLOP_PHRASES: readonly string[] = [
  "in today's fast-paced world",
  'in today’s fast-paced world',
  "let's dive in",
  'let’s dive in',
  "it's important to note",
  'it’s important to note',
  'it is important to note',
  'at the end of the day',
  'in conclusion',
  'to sum up',
  'this highlights the importance of',
  'plays a crucial role',
  'plays a pivotal role',
  'a game changer',
  'game-changer',
  'game changer',
  'seamlessly',
  'leveraging',
  'unlocking',
  'unlock the',
  'delve into',
  'delves into',
  'multifaceted',
  'robust',
  'ever-evolving',
  'ever evolving',
  'landscape',
  'paradigm',
  'key takeaway',
  'navigate the complexities',
  'in the realm of',
  'a testament to',
  'stands as a testament',
  'tapestry',
  'embark on',
  'the future looks promising',
  'stay tuned',
  'follow bull or bear',
  'only time will tell',
  ...FORBIDDEN_PHRASES,
];

const SOFT_PHRASES: readonly string[] = [
  'the bottom line is',
  "here's the thing",
  'here’s the thing',
  'the reason is simple',
  'this is where',
  'dive into',
  'deep dive',
  'needless to say',
  'when it comes to',
];

const GENERIC_OPENINGS: readonly RegExp[] = [
  /^in today['’]s\b/i,
  /^in recent (years|times|months)\b/i,
  /^(technology|the internet|social media|ai|artificial intelligence) (has|have) (transformed|changed|revolutioni[sz]ed)/i,
  /^the (financial|business|tech|technology|investment|economic) (landscape|world) is (evolving|changing)/i,
  /^the world of [a-z]+ is (constantly )?(evolving|changing)/i,
  /^as we all know\b/i,
  /^[^.]{0,80}\bis an important (topic|issue|subject)\b/i,
  /^(have you ever wondered|imagine a world)\b/i,
];

const GENERIC_ENDINGS: readonly RegExp[] = [
  // The builder already renders a "Bottom line" heading over the conclusion.
  /^(the )?bottom line( is)?:/i,
  /^(in conclusion|to sum up|to summari[sz]e|in summary|all in all|overall),/i,
  /\bthe future (looks|is) (promising|bright)\b/i,
  /\bstay tuned\b/i,
  /\bfollow bull or bear\b/i,
  /\bonly time will tell\b/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseHits(text: string, phrases: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const phrase of phrases) {
    if (new RegExp(`(^|[^a-z])${escapeRegExp(phrase.toLowerCase())}($|[^a-z])`, 'i').test(text)) hits.add(phrase);
  }
  return [...hits];
}

export interface SlopInput {
  opening: string;
  body: string;
  ending: string;
  headings: readonly string[];
}

// The pipeline's own vocabulary leaking into prose ("verified medal tallies",
// "unverified premises", "according to the brief") reads as a machine describing its
// process, not a writer explaining the world.
const PROCESS_LANGUAGE = /\b(un)?verified (data|claims?|figures?|numbers?|facts?|tallies|evidence|sources?|premises?|information|medal tallies)\b|\b(the|our|this) (editorial )?brief\b|\bclaim ledger\b|\bclaim_\d+\b|\bsource_\d+\b|\b(external|demographic) assumptions\b/gi;

const GENERIC_HEADINGS = /^(introduction|conclusion|overview|background|summary|final thoughts|key takeaways?|the bottom line)$/i;

export function checkAiSlop(input: SlopInput): SlopReport {
  const findings: SlopFinding[] = [];
  const all = [input.opening, input.body, input.ending].join('\n\n');
  const sentences = splitSentences(all);
  const sentenceCount = Math.max(sentences.length, 1);

  const hard = phraseHits(all, AI_SLOP_PHRASES);
  if (hard.length > 0) {
    findings.push({ code: 'ai_phrases', severity: 'block', message: `Generic AI phrasing: ${hard.join(', ')}.`, evidence: hard });
  }
  const soft = phraseHits(all, SOFT_PHRASES);
  if (soft.length > 0) {
    findings.push({ code: 'stock_transitions', severity: 'warn', message: `Stock transitions: ${soft.join(', ')}.`, evidence: soft });
  }

  const processHits = [...new Set((all.match(PROCESS_LANGUAGE) ?? []).map((h) => h.toLowerCase()))];
  if (processHits.length > 0) {
    findings.push({
      code: 'process_language',
      severity: 'block',
      message: 'The prose describes the research process ("verified", "the brief", claim IDs) instead of the world — write it as a journalist would.',
      evidence: processHits,
    });
  }

  // The same sentence (8+ words) appearing twice: padding, or claims pasted in verbatim.
  const seenSentences = new Map<string, number>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    if (key.split(' ').length >= 8) seenSentences.set(key, (seenSentences.get(key) ?? 0) + 1);
  }
  const repeatedSentences = [...seenSentences.entries()].filter(([, n]) => n > 1).map(([k]) => k.slice(0, 90));
  if (repeatedSentences.length > 0) {
    findings.push({ code: 'repeated_sentences', severity: 'block', message: 'Sentences are repeated word for word — say each thing once.', evidence: repeatedSentences });
  }

  const openingTrimmed = input.opening.trim();
  const genericOpening = GENERIC_OPENINGS.find((p) => p.test(openingTrimmed));
  if (genericOpening) {
    findings.push({
      code: 'generic_opening',
      severity: 'block',
      message: 'The article opens with generic background instead of tension, a specific event or a surprising fact.',
      evidence: [openingTrimmed.slice(0, 160)],
    });
  }
  const endingTrimmed = input.ending.trim();
  const genericEnding = GENERIC_ENDINGS.find((p) => p.test(endingTrimmed));
  if (genericEnding) {
    findings.push({
      code: 'generic_ending',
      severity: 'block',
      message: 'The ending is a stock wrap-up rather than a synthesis, implication or changed assumption.',
      evidence: [endingTrimmed.slice(0, 160)],
    });
  }

  // Repetitive sentence openers ("But ...", "This is where ...", same first two words).
  const openers = new Map<string, number>();
  for (const s of sentences) {
    const key = s.toLowerCase().replace(/[^a-z\s']/g, '').split(/\s+/).slice(0, 2).join(' ');
    if (key.length > 0) openers.set(key, (openers.get(key) ?? 0) + 1);
  }
  const repeated = [...openers.entries()].filter(([, n]) => n >= 4).map(([k, n]) => `"${k}…" ×${n}`);
  if (repeated.length > 0) {
    findings.push({ code: 'repetitive_openers', severity: 'warn', message: 'Several sentences start the same way.', evidence: repeated });
  }
  const butStarts = sentences.filter((s) => /^but\b/i.test(s)).length;
  if (butStarts >= 4 && butStarts / sentenceCount > 0.1) {
    findings.push({ code: 'excessive_but', severity: 'warn', message: `${butStarts} sentences start with "But".`, evidence: [] });
  }

  // Symmetrical "not X, but Y" / "isn't X. It's Y" constructions.
  const notButCount = (all.match(/\b(is|was|are|were)n['’]t (just |only |about )?[^.?!]{1,60}[.,;:]\s*(it['’]s|they['’]re|this is|that['’]s|but)\b|\bnot (just |only )?[^.?!,]{1,40}, but\b/gi) ?? []).length;
  if (notButCount >= 3) {
    findings.push({ code: 'not_x_but_y', severity: 'warn', message: `${notButCount} "not X, but Y" constructions — reads formulaic.`, evidence: [] });
  }

  const colons = (all.match(/:\s/g) ?? []).length;
  if (colons >= 6 && colons / sentenceCount > 0.15) {
    findings.push({ code: 'colon_heavy', severity: 'warn', message: 'Colon-heavy prose.', evidence: [] });
  }

  const lines = all.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const bulletLines = lines.filter((l) => /^([-*•]|\d+[.)])\s/.test(l)).length;
  if (bulletLines >= 6 && bulletLines / Math.max(lines.length, 1) > 0.3) {
    findings.push({ code: 'bullet_heavy', severity: 'warn', message: 'Too much of the article is bullet points.', evidence: [] });
  }

  const questions = sentences.filter((s) => s.endsWith('?')).length;
  if (questions >= 6 && questions / sentenceCount > 0.15) {
    findings.push({ code: 'rhetorical_questions', severity: 'warn', message: `${questions} rhetorical questions — let the facts carry the curiosity.`, evidence: [] });
  }

  const genericHeadings = input.headings.filter((h) => GENERIC_HEADINGS.test(h.trim()));
  if (genericHeadings.length > 0) {
    findings.push({ code: 'generic_headings', severity: 'warn', message: 'Generic section headings.', evidence: genericHeadings });
  }

  const blocks = findings.filter((f) => f.severity === 'block').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  const riskScore = Math.min(10, hard.length * 2 + processHits.length * 2 + (genericOpening ? 3 : 0) + (genericEnding ? 3 : 0) + warns * 1 + (blocks > 0 && hard.length === 0 ? 1 : 0));
  return { riskScore, findings };
}
