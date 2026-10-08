import type { LlmClient, Logger } from '@bb/core';
import type { Queryable } from '@bb/db';
import type { MemorySource } from '@bb/shared-types';
import { MemoryCategorySchema } from '@bb/shared-types';
import { z } from 'zod';

import type { EditorialSignal, SignalOutcome, SignalStrength } from './editorialMemory.js';
import { recordEditorialSignal } from './editorialMemory.js';
import { customSubject, MEMORY_SUBJECTS } from './subjects.js';

// Spec 8 "Quality memory": editorial feedback ("Too generic.", "Table was useful.",
// "Quiz felt forced.") becomes an editorial PATTERN, never stored article text.
// Deterministic rules cover the common phrasings; an LLM classifier maps anything else
// onto the subject vocabulary (or a custom subject); if that is unavailable the
// feedback is kept as a custom memory in the user's own words.

interface Rule { pattern: RegExp; subject: string; polarity: 'prefer' | 'avoid' }

const COMPONENT_WORDS: Record<string, string> = {
  quiz: 'component:quiz',
  quizzes: 'component:quiz',
  poll: 'component:poll',
  polls: 'component:poll',
  table: 'component:table',
  tables: 'component:table',
  'flip card': 'component:revealCards',
  'flip cards': 'component:revealCards',
  'reveal card': 'component:revealCards',
  'reveal cards': 'component:revealCards',
  cards: 'component:revealCards',
  timeline: 'component:timeline',
  decision: 'component:decision',
  'choose an option': 'component:decision',
  'pull quote': 'component:pullQuote',
};

const RULES: Rule[] = [
  { pattern: /\btoo generic\b|\bgeneric\b.*\b(article|draft|piece|writing)\b/i, subject: 'generic', polarity: 'avoid' },
  { pattern: /\btoo many facts\b|\bfacts without interpretation\b|\bmore interpretation\b|\bwhat do the numbers mean\b/i, subject: 'numbers:more_interpretation', polarity: 'prefer' },
  { pattern: /\b(needs?|want|add) more (historical )?(context|history)\b/i, subject: 'context:more_history', polarity: 'prefer' },
  { pattern: /\btoo much background\b|\bget to the (point|interesting part) (faster|sooner)\b/i, subject: 'background:before_hook', polarity: 'avoid' },
  { pattern: /\b(too much|sounds like|reads like|too) (ai|chatgpt|a bot|robotic)\b|\bai[- ]sounding\b|\bai language\b/i, subject: 'ai_language', polarity: 'avoid' },
  { pattern: /\bstronger counter-?argument\b|\bneeds? (a )?counter-?argument\b|\bother side\b/i, subject: 'counterargument:stronger', polarity: 'prefer' },
  { pattern: /\bconclusion (repeat|restate)(s|d|ed)?\b|\brepeat(s|ed)? the (intro|introduction)\b/i, subject: 'conclusion_repeats_intro', polarity: 'avoid' },
  { pattern: /\b(excellent|great|good|loved the) (hidden )?mechanism\b|\bexplain the mechanism\b/i, subject: 'mechanism:explain', polarity: 'prefer' },
  { pattern: /\bmore conversational\b|\btoo (formal|stiff|academic)\b/i, subject: 'tone:conversational', polarity: 'prefer' },
  { pattern: /\btoo long\b|\b(make it |keep it )?shorter\b|\btoo wordy\b/i, subject: 'length:shorter', polarity: 'prefer' },
  { pattern: /\btoo short\b|\bmore depth\b|\bgo deeper\b|\btoo shallow\b/i, subject: 'length:longer', polarity: 'prefer' },
  { pattern: /\btoo much jargon\b|\bless jargon\b|\bsimpler language\b/i, subject: 'jargon:less', polarity: 'prefer' },
  { pattern: /\bshorter sentences\b/i, subject: 'sentences:shorter', polarity: 'prefer' },
  { pattern: /\b(more|stronger) (india|indian)\b|\bindia[- ]first\b/i, subject: 'india_first', polarity: 'prefer' },
  { pattern: /\b(so what|why should i care)\b/i, subject: 'so_what:stronger', polarity: 'prefer' },
  { pattern: /\bunsupported claim|\bmade up\b|\bnot in the source\b/i, subject: 'unsupported_claims', polarity: 'avoid' },
];

const COMPONENT_NEGATIVE = /(felt|was|is|seemed|feels|looks)\s+(forced|unnecessary|pointless|gimmicky|distracting|useless|childish)|\b(remove|drop|cut|lose|no)\s+the\b|\bno more\b|\bdon'?t (use|add)\b/i;
const COMPONENT_POSITIVE = /(was|is|felt|were)\s+(useful|great|helpful|good|excellent|perfect|clear)|\bmore\b|\b(loved|liked)\b/i;

export interface ParsedFeedbackSignal {
  subject: string;
  polarity: 'prefer' | 'avoid';
  statement?: string;
}

const GOOD_OPENING = /\b(good|great|strong|excellent|loved the|nice) (opening|intro|introduction|hook)\b/i;
const BAD_OPENING = /\b(weak|bad|boring|slow|generic) (opening|intro|introduction|hook)\b/i;

// Splits feedback into clauses so "Good opening. Quiz felt forced." yields two signals.
// `articleOpeningStyle` (the reviewed article's measured opening style) lets "good
// opening" become a reusable pattern ("question-led openings work") rather than praise
// for one article.
export function parseFeedbackDeterministically(feedback: string, articleOpeningStyle?: string | null): ParsedFeedbackSignal[] {
  const clauses = feedback
    .split(/(?<=[.!?;])\s+|\n+|,\s*(?=but\b)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const out = new Map<string, ParsedFeedbackSignal>();
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const openingSubject = articleOpeningStyle ? `opening:${articleOpeningStyle}_led` : null;
    if (openingSubject && openingSubject in MEMORY_SUBJECTS && (GOOD_OPENING.test(clause) || BAD_OPENING.test(clause))) {
      out.set(openingSubject, { subject: openingSubject, polarity: GOOD_OPENING.test(clause) ? 'prefer' : 'avoid' });
      continue;
    }
    const componentKey = Object.keys(COMPONENT_WORDS)
      .sort((a, b) => b.length - a.length)
      .find((w) => new RegExp(`\\b${w}\\b`, 'i').test(lower));
    if (componentKey) {
      const subject = COMPONENT_WORDS[componentKey] ?? '';
      if (COMPONENT_NEGATIVE.test(clause)) out.set(subject, { subject, polarity: 'avoid' });
      else if (COMPONENT_POSITIVE.test(clause)) out.set(subject, { subject, polarity: 'prefer' });
      continue;
    }
    for (const rule of RULES) {
      if (rule.pattern.test(clause)) out.set(rule.subject, { subject: rule.subject, polarity: rule.polarity });
    }
  }
  return [...out.values()];
}

const ClassifiedFeedbackSchema = z.object({
  signals: z
    .array(
      z.object({
        subject: z.string().min(1),
        polarity: z.enum(['prefer', 'avoid']),
        category: MemoryCategorySchema,
        statement: z.string().min(1).max(240),
      }),
    )
    .max(6),
});

async function classifyWithLlm(feedback: string, llm: LlmClient, runId: string): Promise<ParsedFeedbackSignal[]> {
  const result = await llm.completeStructured(
    {
      system: `ROLE: blog-feedback-classifier
You turn an editor's feedback on a Bull or Bear blog article into reusable editorial patterns — what
makes a successful article in general, never facts about this one article and never copied sentences.
Use one of these subjects when it fits: ${Object.keys(MEMORY_SUBJECTS).join(', ')}. Otherwise use
"custom:<two_to_five_words>". polarity "prefer" = do more of it, "avoid" = do less of it. statement:
one short general instruction for future articles. Return an empty list if the feedback is only about
this specific article's content.`,
      messages: [{ role: 'user', content: feedback }],
      runId,
      stepId: 'blog-feedback-classifier',
      temperature: 0,
      maxTokens: 800,
    },
    ClassifiedFeedbackSchema,
  );
  return result.signals.map((s) => ({
    subject: s.subject in MEMORY_SUBJECTS || /^custom:[a-z0-9_]+$/.test(s.subject) ? s.subject : customSubject(s.subject),
    polarity: s.polarity,
    statement: s.statement,
  }));
}

export interface RecordFeedbackInput {
  db: Queryable;
  feedback: string;
  source: MemorySource;
  strength: SignalStrength;
  contentId?: string | null;
  articleOpeningStyle?: string | null;
  // When present, unmatched feedback is classified by the model before falling back.
  llm?: LlmClient;
  // Store feedback nothing could classify as a custom memory in the editor's own words
  // (the dedicated feedback endpoint). Off for review-flow feedback, which is often
  // about one article's specifics rather than a reusable pattern.
  keepUnclassified?: boolean;
  logger?: Logger;
  runId?: string;
}

export async function recordEditorialFeedback(input: RecordFeedbackInput): Promise<SignalOutcome[]> {
  let parsed = parseFeedbackDeterministically(input.feedback, input.articleOpeningStyle);
  if (parsed.length === 0 && input.llm && input.runId) {
    parsed = await classifyWithLlm(input.feedback, input.llm, input.runId).catch((error: unknown) => {
      input.logger?.warn(
        { runId: input.runId, stepId: 'blog-feedback-classifier', err: error instanceof Error ? error.message : String(error) },
        'Feedback classification failed; storing as a custom memory',
      );
      return [];
    });
  }
  // Explicit feedback nothing could classify is still an editorial instruction — keep
  // it in the editor's own (short) words rather than dropping it.
  if (parsed.length === 0 && input.strength === 'explicit' && input.keepUnclassified === true) {
    const statement = input.feedback.trim().slice(0, 240);
    parsed = [{ subject: customSubject(statement), polarity: 'prefer', statement }];
  }
  const outcomes: SignalOutcome[] = [];
  for (const p of parsed) {
    const signal: EditorialSignal = {
      subject: p.subject,
      polarity: p.polarity,
      ...(p.statement ? { statement: p.statement } : {}),
      source: input.source,
      strength: input.strength,
      contentId: input.contentId ?? null,
    };
    outcomes.push(await recordEditorialSignal(input.db, signal));
  }
  return outcomes;
}
