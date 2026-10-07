import type { Claim } from '@bb/shared-types';
import { isUsableClaim } from '@bb/shared-types';

import { extractQuantities, quantitiesMatch } from './quantities.js';
import { contentStems, isAnchored, normalizeForMatch, sharedStemCount, splitSentences, stem, tokenize } from './text.js';

// Deterministic meaning-preservation rules (spec 28/40/41): high-precision patterns
// for the drift that matters most — temporal ("first since 2023" -> "again"), modal
// ("could" -> "will", "expected to launch" -> "launched"), status ("proposed" ->
// "imposed"), causal ("after" -> "because"), evidential ("association" -> "proved"),
// attribution ("according to Reuters" -> unattributed) and period ("YoY" -> "MoM").
// Each issue names the claim it contradicts. These run on hooks (hook critic) and on
// final drafts (editorial QA); an LLM semantic check runs alongside for the long tail.

export type DriftCategory = 'meaning' | 'temporal' | 'causality' | 'attribution' | 'number';

export interface DriftIssue {
  category: DriftCategory;
  rule: string;
  claimId: string;
  sentence: string;
  explanation: string;
}

const REPETITION = /\b(again|once more|once again|another(?!\s+(?:reason|way|thing|angle|point|question|look|example|layer|side|detail))|yet again|continu(?:e|es|ed|ing)|resum(?:e|es|ed|ing)|latest in a (?:string|series|run)|repeated(?:ly)?|back-to-back|streak)\b/i;
const FIRST_EVER = /\b(first[- ]ever|never before|for the first time in (?:history|its history)|unprecedented|all[- ]time first)\b/i;
const FIRST_MARKER = /\b(first time|first since|first in|for the first time|first [a-z]+ (?:hike|cut|loss|profit|increase|decrease|rise|fall))\b/i;
const NOVELTY_IN_CLAIM = /\b(first\b[^.]{0,40}\b(?:since|in)\b|first[- ]ever|for the first time|never before)/i;

const HEDGE = /\b(may|might|could|would|expected to|expects to|likely to|set to|plans? to|planning to|aims? to|proposed|proposes|proposal|considering|mulls?|weighs?|potentially|possibly|reportedly|poised to|tipped to|on track to|forecast(?:s|ed)? to|projected to|estimated to|if)\b/i;
const HEDGE_WORDS = new Set(['may', 'might', 'could', 'would', 'expected', 'expects', 'likely', 'set', 'plan', 'plans', 'planning', 'aim', 'aims', 'proposed', 'proposes', 'considering', 'potentially', 'possibly', 'reportedly', 'poised', 'tipped', 'projected', 'forecast', 'estimated']);
const CERTAIN_FUTURE_WORDS = new Set(['will', 'shall', 'definitely', 'certainly', 'guaranteed', 'surely']);
const FUTURE_OR_POSSIBLE_WORDS = new Set(['may', 'might', 'could', 'will', 'would', 'shall', 'expected', 'likely', 'set', 'poised', 'plans', 'planning']);
const IRREGULAR_PAST = new Set(['cut', 'set', 'rose', 'fell', 'grew', 'made', 'took', 'won', 'lost', 'began', 'went', 'hit', 'put', 'shut', 'sold', 'bought', 'paid', 'led', 'saw', 'gave', 'brought', 'spent']);

const PROPOSAL_IN_CLAIM = /\b(propos(?:ed|es|al|ing)?|draft (?:rules?|bill|norms|framework|guidelines)|consultation (?:paper|process)|mooted|floated)\b/i;
const IMPLEMENTED = /\b(imposed|implemented|introduced|enacted|levied|approved|rolled out|brought in|takes effect|took effect|came into (?:force|effect)|comes into (?:force|effect)|now (?:charges|requires|mandates|applies)|has (?:banned|mandated|capped|imposed))\b/i;
const PROPOSAL_IN_DRAFT = /\b(propos|draft|consult|plan|could|may|might|would|if |mooted|floated|considering)/i;

const ASSOCIATION_IN_CLAIM = /\b(associat\w*|correlat\w*|linked (?:to|with)|tied to)\b/i;
const CAUSATION_CLAIMED = /\b(prove[sd]?|proof|proven|caus(?:e|es|ed|ation|al)|leads? to|results? in|resulted in)\b/i;

const CAUSAL_CONNECTOR = /\b(because(?: of)?|due to|caused|causes|causing|led to|leads to|resulted in|results in|as a result of|driven by|thanks to|on the back of|triggered by|therefore)\b/i;

const ACCOUNTING_LOSS_IN_CLAIM = /\b(?:net |operating |quarterly |annual |reported (?:a |an )?)?loss(?:es)?\b/i;
const CASH_FRAMING = /\b(in cash|cash (?:burn|loss|outflow)|burn(?:ed|t)? (?:through )?(?:\$|₹|rs))/i;

const ATTRIBUTION_MARKERS = /\b(according to|said|says|told|reported|reports|reportedly|per |claim(?:s|ed)?|stated|states|announced|estimates?|estimated|cited|citing|noted|warned|data from|figures from|survey)\b/i;

const PERIODS: { name: string; pattern: RegExp }[] = [
  { name: 'year-over-year', pattern: /\b(year[- ](?:on|over)[- ]year|yoy|y-o-y|from a year (?:ago|earlier)|annual(?:ly)?|than last year)\b/i },
  { name: 'month-over-month', pattern: /\b(month[- ](?:on|over)[- ]month|mom|m-o-m|from (?:a|the previous|last) month|sequential(?:ly)?)\b/i },
  { name: 'quarter-over-quarter', pattern: /\b(quarter[- ](?:on|over)[- ]quarter|qoq|q-o-q|from (?:the previous|last) quarter)\b/i },
];

export interface ClaimFeatures {
  claim: Claim;
  stems: string[];
  entityStems: string[];
  isNovelty: boolean;
  isRecurring: boolean;
  hasSinceQualifier: boolean;
  isUncertain: boolean;
  uncertainEventStems: string[];
  isSettled: boolean;
  isProposal: boolean;
  isAssociation: boolean;
  isAccountingLoss: boolean;
  period: string | null;
  attributedTo: string | null;
}

function periodOf(text: string): string | null {
  return PERIODS.find((p) => p.pattern.test(text))?.name ?? null;
}

// Content stems appearing within a few tokens after a hedge in the claim — i.e. the
// event the hedge governs ("expected to LAUNCH", "could REDUCE").
function hedgedEventStems(text: string): string[] {
  const tokens = tokenize(text);
  const stems: string[] = [];
  tokens.forEach((t, i) => {
    if (!HEDGE_WORDS.has(t)) return;
    for (const next of tokens.slice(i + 1, i + 4)) {
      if (next === 'to' || next === 'be' || HEDGE_WORDS.has(next)) continue;
      stems.push(stem(next));
      break;
    }
  });
  return stems;
}

function attributionOf(claim: Claim): string | null {
  if (claim.attributedTo) return claim.attributedTo;
  const according = /[Aa]ccording to ([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*)*)/.exec(claim.text);
  if (according?.[1]) return according[1];
  return null;
}

export function claimFeatures(claim: Claim): ClaimFeatures {
  const text = claim.text;
  const status = claim.temporalContext.status;
  const qualifier = claim.temporalContext.qualifier ?? '';
  const isUncertainStatus = status === 'expected' || status === 'possible' || status === 'proposed';
  const isUncertain = isUncertainStatus || HEDGE.test(text) || ['FORECAST', 'SPECULATION', 'RUMOR'].includes(claim.type);
  return {
    claim,
    stems: contentStems(text),
    entityStems: claim.entities.flatMap((e) => contentStems(e)),
    isNovelty: status === 'first_since' || NOVELTY_IN_CLAIM.test(text) || NOVELTY_IN_CLAIM.test(qualifier),
    isRecurring: status === 'recurring' || REPETITION.test(text),
    hasSinceQualifier: /\bsince\b|\bin (?:nearly |almost |over )?\w+ years\b/i.test(`${text} ${qualifier}`),
    isUncertain,
    uncertainEventStems: hedgedEventStems(text),
    isSettled: !isUncertain && ['completed', 'first_since', 'effective', 'approved', 'historical', 'announced'].includes(status),
    isProposal: status === 'proposed' || PROPOSAL_IN_CLAIM.test(text),
    isAssociation: ASSOCIATION_IN_CLAIM.test(text),
    isAccountingLoss: ACCOUNTING_LOSS_IN_CLAIM.test(text) && !/\bcash\b/i.test(text),
    period: periodOf(text),
    attributedTo: attributionOf(claim),
  };
}

function restatesClaim(sentenceStems: readonly string[], f: ClaimFeatures): boolean {
  const own = f.stems.filter((st) => !f.entityStems.includes(st) && !contentStems(f.attributedTo ?? '').includes(st));
  if (own.length === 0) return false;
  return sharedStemCount(sentenceStems, own) >= Math.max(2, Math.ceil(own.length / 2));
}

// "Reserve Bank of India" is named by "RBI" too.
function namesSource(sentence: string, source: string): boolean {
  if (normalizeForMatch(sentence).includes(normalizeForMatch(source))) return true;
  const acronym = source
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && !/^(Of|The|And|For)$/.test(w))
    .map((w) => w[0])
    .join('');
  return acronym.length >= 2 && new RegExp(`\\b${acronym}\\b`).test(sentence);
}

function hasNearbyBefore(tokens: string[], index: number, words: ReadonlySet<string>, window: number): boolean {
  return tokens.slice(Math.max(0, index - window), index).some((t) => words.has(t));
}

function isPastForm(token: string): boolean {
  return (token.endsWith('ed') && token.length > 4) || IRREGULAR_PAST.has(token);
}

function sentenceMentionsEntity(sentenceStems: readonly string[], f: ClaimFeatures): boolean {
  return f.entityStems.length === 0 || sharedStemCount(sentenceStems, f.entityStems) > 0;
}

function checkSentence(sentence: string, f: ClaimFeatures, causalSupportStems: readonly string[][]): DriftIssue[] {
  const issues: DriftIssue[] = [];
  const sStems = contentStems(sentence);
  const sharedNumbers = extractQuantities(sentence).some((q) =>
    extractQuantities(f.claim.text).some((c) => quantitiesMatch(q, c)),
  );
  if (!isAnchored(sStems, f.stems) && !(sharedNumbers && sharedStemCount(sStems, f.stems) >= 1)) return issues;

  const tokens = tokenize(sentence);
  const add = (category: DriftCategory, rule: string, explanation: string): void => {
    issues.push({ category, rule, claimId: f.claim.id, sentence, explanation });
  };

  if (f.isNovelty && REPETITION.test(sentence)) {
    add(
      'temporal',
      'novelty_to_repetition',
      `Claim "${f.claim.text}" describes a first occurrence; the draft frames it as a repeat ("${REPETITION.exec(sentence)?.[0] ?? ''}").`,
    );
  }
  if (f.isNovelty && f.hasSinceQualifier && FIRST_EVER.test(sentence)) {
    add('temporal', 'first_since_to_first_ever', `Claim "${f.claim.text}" is "first since", not first ever.`);
  }
  if (f.isRecurring && !f.isNovelty && FIRST_MARKER.test(sentence)) {
    add('temporal', 'repetition_to_novelty', `Claim "${f.claim.text}" describes a recurrence; the draft presents it as a first.`);
  }

  if (f.isUncertain && f.uncertainEventStems.length > 0) {
    const sentenceHedged = HEDGE.test(sentence);
    tokens.forEach((t, i) => {
      if (!f.uncertainEventStems.includes(stem(t))) return;
      if (hasNearbyBefore(tokens, i, CERTAIN_FUTURE_WORDS, 3) && !hasNearbyBefore(tokens, i, HEDGE_WORDS, 3)) {
        add('meaning', 'possibility_to_certainty', `Claim "${f.claim.text}" is uncertain; the draft states it with certainty ("${tokens.slice(Math.max(0, i - 2), i + 1).join(' ')}").`);
      } else if (isPastForm(t) && !sentenceHedged) {
        add('temporal', 'expected_to_completed', `Claim "${f.claim.text}" has not happened yet; the draft describes it as done ("${t}").`);
      }
    });
  }

  if (f.isSettled && f.claim.type !== 'FORECAST' && sentenceMentionsEntity(sStems, f)) {
    tokens.forEach((t, i) => {
      if (!f.stems.includes(stem(t)) || f.entityStems.includes(stem(t))) return;
      if (hasNearbyBefore(tokens, i, FUTURE_OR_POSSIBLE_WORDS, 2)) {
        add('temporal', 'completed_to_possibility', `Claim "${f.claim.text}" already happened; the draft frames it as a future possibility ("${tokens.slice(Math.max(0, i - 2), i + 1).join(' ')}").`);
      }
    });
  }

  if (f.isProposal && IMPLEMENTED.test(sentence) && !PROPOSAL_IN_DRAFT.test(sentence)) {
    add('meaning', 'proposal_to_implemented', `Claim "${f.claim.text}" is a proposal; the draft says it was implemented ("${IMPLEMENTED.exec(sentence)?.[0] ?? ''}").`);
  }

  if (f.isAssociation && CAUSATION_CLAIMED.test(sentence)) {
    add('causality', 'association_to_causation', `Claim "${f.claim.text}" reports an association; the draft claims causation or proof.`);
  }

  if (CAUSAL_CONNECTOR.test(sentence) && f.claim.type !== 'CAUSE' && f.claim.type !== 'EFFECT') {
    const supported = causalSupportStems.some((stems) => isAnchored(sStems, stems));
    if (!supported) {
      add('causality', 'unsupported_causality', `Draft asserts a cause ("${CAUSAL_CONNECTOR.exec(sentence)?.[0] ?? ''}") for "${f.claim.text}" that no verified CAUSE/EFFECT claim supports.`);
    }
  }

  if (f.isAccountingLoss && CASH_FRAMING.test(sentence)) {
    add('meaning', 'accounting_loss_to_cash', `Claim "${f.claim.text}" is a reported (accounting) loss, not cash lost.`);
  }

  if (f.period) {
    const draftPeriod = periodOf(sentence);
    if (draftPeriod && draftPeriod !== f.period && sharedNumbers) {
      add('number', 'period_changed', `Claim "${f.claim.text}" is ${f.period}; the draft says ${draftPeriod}.`);
    }
  }

  // Attribution only matters when the sentence actually restates the attributed
  // content (most of the claim's own words) — sharing "RBI" and "rate" with an
  // attributed forecast doesn't make a sentence about the hike itself unattributed.
  if (f.attributedTo && restatesClaim(sStems, f)) {
    const named = namesSource(sentence, f.attributedTo);
    if (!named && !ATTRIBUTION_MARKERS.test(sentence)) {
      add('attribution', 'attribution_dropped', `Claim "${f.claim.text}" is only established as attributed to ${f.attributedTo}; the draft states it without attribution.`);
    }
  }

  return issues;
}

const QUOTED_SPAN = /[“"]([^”"]{12,})[”"]/g;

// Quotes must be exact (spec 31): any quoted span of meaningful length must appear
// verbatim in a QUOTE/ATTRIBUTION claim or in a claim's evidence excerpt.
function checkQuotes(text: string, claims: readonly Claim[]): DriftIssue[] {
  const corpus = claims
    .flatMap((c) => [c.text, ...c.evidence.map((e) => e.quote)])
    .map(normalizeForMatch)
    .join('\n');
  const issues: DriftIssue[] = [];
  for (const match of text.matchAll(QUOTED_SPAN)) {
    const quoted = match[1] ?? '';
    if (quoted.split(/\s+/).length < 4) continue;
    if (!corpus.includes(normalizeForMatch(quoted))) {
      issues.push({
        category: 'attribution',
        rule: 'unverified_quote',
        claimId: '',
        sentence: match[0],
        explanation: `Quoted text "${quoted}" does not appear verbatim in any verified quote or evidence.`,
      });
    }
  }
  return issues;
}

// Which claims a draft is held to: everything usable, plus anything marked
// mustPreserve even if verification fell short (its meaning still can't be flipped).
function claimsToCheck(claims: readonly Claim[]): Claim[] {
  return claims.filter((c) => isUsableClaim(c) || c.mustPreserve);
}

export function detectMeaningDrift(text: string, claims: readonly Claim[]): DriftIssue[] {
  const checked = claimsToCheck(claims);
  const features = checked.map(claimFeatures);
  const causalSupportStems = claims
    .filter((c) => (c.type === 'CAUSE' || c.type === 'EFFECT') && isUsableClaim(c))
    .map((c) => contentStems(c.text));
  const issues: DriftIssue[] = [];
  for (const sentence of splitSentences(text)) {
    for (const f of features) issues.push(...checkSentence(sentence, f, causalSupportStems));
  }
  issues.push(...checkQuotes(text, claims));
  // One issue per (rule, claim, sentence) — several claims can share a sentence. An
  // unsupported causal connector is a property of the sentence, so it's reported once.
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = i.rule === 'unsupported_causality' ? `${i.rule}|${i.sentence}` : `${i.rule}|${i.claimId}|${i.sentence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
