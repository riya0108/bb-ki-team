import type { MemoryCategory } from '@bb/shared-types';

// Controlled vocabulary for editorial memory subjects. A shared key per pattern is what
// lets repeated signals reinforce one memory instead of piling up near-duplicates, and
// lets an opposite signal on the same key supersede it. Anything outside this list is
// stored as `custom:<slug>`.

export interface SubjectDefinition {
  category: MemoryCategory;
  prefer: string;
  avoid: string;
}

export const MEMORY_SUBJECTS: Record<string, SubjectDefinition> = {
  'opening:question_led': { category: 'structure', prefer: 'Open with a sharp question.', avoid: 'Avoid question-led openings.' },
  'opening:statistic_led': { category: 'structure', prefer: 'Open with a surprising verified number.', avoid: 'Avoid statistic-first openings.' },
  'opening:anecdote_led': { category: 'structure', prefer: 'Open with a concrete human scene or observation.', avoid: 'Avoid anecdote openings.' },
  'opening:tension_led': { category: 'structure', prefer: 'Open with tension or a contradiction.', avoid: 'Avoid tension-first openings.' },
  'opening:event_led': { category: 'structure', prefer: 'Open with the specific event.', avoid: 'Avoid event-first openings.' },
  'background:before_hook': { category: 'structure', prefer: 'Give background before the interesting part.', avoid: 'Get to the interesting part before giving background.' },
  'length:longer': { category: 'structure', prefer: 'Go deeper: longer, more complete articles.', avoid: 'Keep articles tight; do not over-extend.' },
  'length:shorter': { category: 'structure', prefer: 'Keep articles shorter and tighter.', avoid: 'Do not cut articles too short.' },
  'sections:fewer': { category: 'structure', prefer: 'Use fewer, fuller sections.', avoid: 'Do not merge sections too aggressively.' },
  'component:table': { category: 'structure', prefer: 'Use a table when comparing figures.', avoid: 'Avoid tables unless essential.' },
  'component:quiz': { category: 'structure', prefer: 'Quizzes work when they reinforce the article.', avoid: 'Quizzes tend to feel forced; avoid them.' },
  'component:poll': { category: 'structure', prefer: 'Polls work for genuine reader self-identification.', avoid: 'Polls tend to feel forced; avoid them.' },
  'component:revealCards': { category: 'structure', prefer: 'Flip cards work for misconceptions and hidden mechanisms.', avoid: 'Flip cards tend to feel gimmicky; avoid them.' },
  'component:decision': { category: 'structure', prefer: 'Choose-an-option scenarios work for genuine trade-offs.', avoid: 'Avoid choose-an-option widgets.' },
  'component:timeline': { category: 'structure', prefer: 'Use a timeline when chronology matters.', avoid: 'Avoid timelines.' },
  'component:comparisonStat': { category: 'structure', prefer: 'Use a side-by-side stat callout for the key comparison.', avoid: 'Avoid stat callouts.' },
  'component:pullQuote': { category: 'structure', prefer: 'Use a pull quote for the sharpest line.', avoid: 'Avoid pull quotes.' },
  'ending:question': { category: 'structure', prefer: 'End on an open question.', avoid: 'Avoid ending on a question.' },
  'ending:implication': { category: 'structure', prefer: 'End on the implication or changed assumption.', avoid: 'Avoid implication endings.' },
  'headline:question_style': { category: 'language', prefer: 'Question-style headlines work.', avoid: 'Avoid question headlines.' },
  'tone:conversational': { category: 'language', prefer: 'Make the tone more conversational.', avoid: 'Keep the tone less casual.' },
  'sentences:shorter': { category: 'language', prefer: 'Use shorter sentences.', avoid: 'Allow longer, more developed sentences.' },
  'jargon:less': { category: 'language', prefer: 'Strip jargon; explain terms plainly.', avoid: 'Technical terms are fine for this audience.' },
  ai_language: { category: 'language', prefer: 'AI-style phrasing is acceptable.', avoid: 'Too much AI-sounding language: remove stock phrases and formulaic rhythm.' },
  'context:more_history': { category: 'editorial', prefer: 'Add more historical context.', avoid: 'Keep historical context brief.' },
  'counterargument:stronger': { category: 'editorial', prefer: 'Make the counterargument stronger and engage it honestly.', avoid: 'Keep counterarguments brief.' },
  'numbers:more_interpretation': { category: 'editorial', prefer: 'Interpret every number: fewer facts, more meaning.', avoid: 'Let the numbers speak with less commentary.' },
  'mechanism:explain': { category: 'editorial', prefer: 'Explain the hidden mechanism — readers value it.', avoid: 'Spend less time on mechanism.' },
  'so_what:stronger': { category: 'editorial', prefer: 'Make the "so what?" for the reader explicit.', avoid: 'Keep the reader takeaway implicit.' },
  india_first: { category: 'editorial', prefer: 'Bring the Indian angle forward when relevant.', avoid: 'Do not force an India angle.' },
  'opinion:more': { category: 'editorial', prefer: 'Take a clearer Bull or Bear point of view.', avoid: 'Hold back on opinion; show, don\'t tell.' },
  generic: { category: 'quality', prefer: 'Generic framing is acceptable.', avoid: 'Too generic: every paragraph must say something specific to this story.' },
  conclusion_repeats_intro: { category: 'quality', prefer: 'Restating the opening in the conclusion is fine.', avoid: 'The conclusion must not repeat the introduction; it should change understanding.' },
  unsupported_claims: { category: 'quality', prefer: 'n/a', avoid: 'Never include a claim the evidence does not support.' },
};

export function statementFor(subject: string, polarity: 'prefer' | 'avoid'): string | null {
  const def = MEMORY_SUBJECTS[subject];
  return def ? def[polarity] : null;
}

export function categoryFor(subject: string): MemoryCategory {
  return MEMORY_SUBJECTS[subject]?.category ?? 'editorial';
}

export function customSubject(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join('_');
  return `custom:${slug || 'note'}`;
}
