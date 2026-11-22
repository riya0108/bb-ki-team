import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN, renderCraftPlaybook } from '@bb/core';
import { renderBriefForWriter, STORY_FIRST_WRITING_RULES } from '@bb/editorial-intelligence';
import type { ComponentType, ContentDnaRecord, EditorialArchitecture, EditorialBrief } from '@bb/shared-types';
import {
  BarChartComponentSchema,
  DecisionComponentSchema,
  EditorialArchitectureSchema,
  EditorialQualitySchema,
  EditorialWarningSchema,
  FaqSchema,
  InternalLinkSchema,
  QuizComponentSchema,
  SeoPlanSchema,
  StyleMemorySignalSchema,
  TableComponentSchema,
  TimelineComponentSchema,
} from '@bb/shared-types';
import { z } from 'zod';

import { AI_SLOP_PHRASES } from './editorial/slopFilter.js';

// Spec section 12.8 — the site's own written editorial observations, used as the
// default style baseline when no Blog Style Profile has been learned yet (see
// editorial/styleProfile.ts, which supersedes this once approved articles or
// approved references exist). Spec 12.7: learn from the site's actual articles, not
// from generic "blog style" instructions.
export const EDITORIAL_OBSERVATIONS: readonly string[] = [
  'Titles frequently use a strong question, tension, surprising claim or practical problem.',
  'Articles aim to explain why something happens, not merely state what happened.',
  'The site uses plain, direct language and avoids unnecessary jargon.',
  'Practical usefulness matters: explainers, comparisons, guides and concrete takeaways.',
  'Preserve the brand\'s independence — never pretend to be a licensed financial, legal or tax adviser.',
];

// Spec 24 (editorial refactor): Blog's job is CLICK -> UNDERSTAND -> EXPLORE -> SEARCH/SHARE.
// More depth than X or LinkedIn, never more facts than the verified claim set.
export const BLOG_EDITORIAL_RULES: readonly string[] = [
  'The title is built on the strongest verified angle from the brief.',
  'The introduction is the cold-open scene, then the turn: within the first 4-6 paragraphs the reader knows what is happening, why it is unusual or important, and why they should care.',
  'No textbook filler openings: not "In today\'s fast-paced financial landscape", "The world of finance is constantly evolving", "In recent years".',
  'Go deeper than social posts (mechanism, context, what to watch), but every factual statement must come from the brief\'s verified claims; anything else is clearly labelled interpretation or opinion.',
  'Cite the brief\'s sources near the claims they support, and list them in "sources".',
];

// The editorial standard (spec 31/54): a professional article is QUESTION -> EVIDENCE
// -> TENSION -> EXPLANATION -> CONTEXT -> COUNTERARGUMENT -> IMPLICATION ->
// UNDERSTANDING, never FACT + FACT + FACT.
export const BLOG_CRAFT_RULES: readonly string[] = [
  'Voice: a smart friend who went down the rabbit hole and came back with the answer. Sharp, curious, sceptical, conversational, evidence-led, independent, slightly provocative, practical. Not an AI assistant summarising the internet.',
  "Don't tell the reader what to think. Show them what they are missing.",
  'The very first sentence of the article is part of the cold-open scene (see the essay standard), never a thesis, a generalisation about a population or a statistic. Tension, a contradiction or a surprising verified number belongs inside the scene or in the turn paragraph right after it. The first 2-4 paragraphs must make the reader understand why they should keep reading.',
  'The opening scene, the turn paragraph, the title and the deck claim no more than the narrowest verified claim behind them. If a survey found 63% know of at least one market product, do not write "most households know about mutual funds"; if a figure covers all bank deposits, do not call it the FD\'s share; if the data is what people say they prefer, do not say what they pick. The opening is where overstatement is most tempting and most damaging: write it last, against the claims.',
  'Keep every attribution. A claim marked "attribute to X" (a fund house, a newspaper, a data site, a company) names X in the same sentence every time its figure is used: "Franklin Templeton\'s report counts...", "Livemint reported...", "according to Deccan Chronicle...". "The report" or "by one count" is not enough, and a link alone is not an attribution. Only claims with no "attribute to" may be stated plainly.',
  'Every section must earn its place. Cut paragraphs that only tell the reader what they already know. Never pad towards a word count.',
  'Numbers must have meaning: every major number answers "why does this matter?". Never dump statistics in a row.',
  'For any calculation show INPUT, ASSUMPTION, CALCULATION, RESULT and LIMITATION, and label hypothetical/illustrative calculations explicitly ("Assume...", "Illustratively..."). An illustration must never look like an official figure.',
  'Separate fact from interpretation in the language itself. FACT: "Amazon announced...". INTERPRETATION: "That suggests...". ANALYSIS: "The more important issue is...". OPINION: "At Bull or Bear, we think...". PREDICTION: "If this continues, the likely pressure point is...". HYPOTHETICAL: "Assume...".',
  'Never turn "could" into "will", "analysts expect" into "the company will", or "the data suggests" into "the data proves". Never state a cause the claims do not establish.',
  'Explain the mechanism, not just the event. Give context. Take the strongest counterargument seriously and answer it honestly. When interpretations compete, weigh the bull case against the bear case and say what the data says and what we do not know.',
  'Dates matter: keep "as of" qualifiers, never make a time-bound fact evergreen, and never confuse announcement date, effective date, publication date, financial year, calendar year or quarter.',
  'India-first when relevant (₹, Indian consumers, salaries, cities, companies, banks, UPI, RBI, SEBI, NSE/BSE, Indian tax and policy). Never force India into a story where it is irrelevant.',
  'Originality comes from angle, synthesis, structure, explanation, comparison, mechanism and framing. Never manufacture a hot take, an expert quote or a reader opinion.',
  'Short paragraphs, natural transitions, varied sentence rhythm. Avoid symmetrical "not X, but Y" constructions, repetitive sentence openers, fake rhetorical questions, colon-heavy prose and bullet-point walls.',
  'End with a changed assumption, an implication, an uncomfortable observation, a practical takeaway, a question, a prediction, a thing to watch or a concise synthesis. Never "In conclusion", "To sum up", "The future looks promising", "Stay tuned" or a follow CTA. The reader should finish thinking "I understand this differently now."',
  'Write about the world, never about the research process: no "verified data", "unverified", "the brief", "claims", claim IDs or "according to our sources" in the prose. Attribute like a journalist ("RBI said", "Reuters reported") and cite in sourceNote.',
  'Never paste a claim\'s wording in as a sentence, and never state the same fact twice: claims are evidence to explain, not copy to repeat. Each number appears once, where it does the most work.',
  'Interim or time-bound figures (live tallies, running totals, forecasts) always carry their date ("as of 21 September") and are never presented as final.',
  'SEO sits underneath editorial quality (truth > editorial quality > reader value > brand > SEO): no keyword stuffing, no filler FAQ sections, no headings written for search engines.',
  'Quotation marks are only for words someone actually said or wrote, copied verbatim from the evidence. Imagined thoughts, a reader\'s inner voice or your own catchphrases never go in quotation marks: write them as plain prose or reported speech (the worry is that someone might cheat them).',
  'The title, deck and every heading are held to the same numbers as the body: any figure or proportion in them ("nine in ten", "80%", "half") must match a verified claim exactly. Never round 63% to "nine in ten" or 79% to "almost all".',
  'Keep what a number measures. A survey of stated preference reports what people SAY ("80% say they prefer..."), never what they DO ("80% choose..."); a share of new savings is not a share of total wealth; a generation is not an age band unless the source says so.',
  'Use the newest data in the brief. If a later period (the latest fiscal year, quarter or month) exists, it leads, and older figures are framed as history. When newer data cuts against the thesis or is disputed between sources, say so in the text and explain what it would mean if it holds; never silently present an older year as the current state.',
];

// The long-form essay standard (set by the editor, 2026-11, from two reference
// essays: an AI-restraint essay and a Gen Z vs Gen X savings piece). Describes what
// those pieces DO — structure, rigour, rhythm — never their wording or topics.
export const ESSAY_STANDARD_RULES: readonly string[] = [
  `Depth: when the research supports it, a Bull or Bear essay runs 3,000-4,500 words (a 12-16 minute read) in 6-9 H2 sections, most split by one or two H3 subheads. Depth comes from more evidence, mechanism, context and honest caveats, never from repetition or padding.`,
  `Cold open: 2-4 short paragraphs of a concrete, sensory scene or small human moment that contains the whole problem in miniature. A clearly hypothetical or composite scene ("Picture a dinner party...", "Ask a 24-year-old and a 55-year-old what they are saving for") is fine; never invent a named real person, a quote, or an event.`,
  `Then the turn: one paragraph that names the tension and states the thesis plainly, then one short paragraph that tells the reader what the piece will cover.`,
  `The first body section pins the facts down precisely, including methodology: who ran the survey or study, who paid for it, fieldwork dates, sample size and population, and what it measures (stated preferences vs actual behaviour). Name conflicts of interest calmly, without accusing anyone.`,
  `Research method: every essay has a short section on where the numbers come from, either its own H2 or an H3 inside the first or second body section, headed "Where these numbers come from" (or "Where the numbers come from"). In 2-5 short paragraphs or a short list: the main sources and who produced each, what each measures and does not, the period it covers, sample and fieldwork where relevant, who paid or has an interest, and where sources disagree or data is missing. It is about the sources, never about our own research process ("we verified", "the brief", "claims").`,
  `Each H2 makes one move in the argument. Headings are short, concrete and specific to this piece (often a phrase from it), never generic ("Introduction", "Overview", "Key Takeaways").`,
  `Give every number its meaning straight away: compare it, invert it ("if 26% want a home, 74% want something else"), set it against a benchmark, or translate it into the reader's life. Worked examples use round inputs, show the arithmetic step by step, and say they are illustrative.`,
  `Steelman, then push back: present the popular explanation fairly, say what is right about it, then show where it breaks, with evidence.`,
  `Near the end, a caveats section (e.g. "Before You Draw the Wrong Conclusion"): 3-5 paragraphs, each opening with a **bold one-line caveat** followed by 1-3 sentences: stated vs revealed behaviour, averages hiding variation, correlation vs cause, sample limits, evidence from another country.`,
  `When there is something to do, a practical section for distinct reader groups: a **bold lead-in** line per group followed by a 3-4 item bullet list of concrete actions, each with its reason.`,
  `Use the first person sparingly, for judgement ("I'd flag two things", "I'd push back on the neat version", "Here is what I find most striking"), and label observation vs data ("this part is observation rather than data").`,
  `One or two pull quotes per article: a sentence of the article itself that compresses the argument, on its own as a "> " block. Never a quote attributed to a person.`,
  `Close by returning to the opening scene with the new understanding, then give the reader one concrete thing to do, ask or notice. The closing heading is a phrase from the piece (conclusionHeading), never "Conclusion".`,
  `FAQ: 4-5 questions a reader would actually search for, each answered in 2-4 self-contained sentences using only the article's verified facts. Answers are fact-checked like the body.`,
  `Cite inline like a good magazine: link the specific phrase that carries an important fact to its claim ID, e.g. [Knight Frank's Affordability Index](claim_012). Aim for 4-12 such links on the facts that matter most. Only claim IDs listed as VERIFIED or HIGH_CONFIDENCE.`,
];

// The closed markup a section body may use (rendered by bodyMarkup.ts/htmlBuilder.ts).
export const BODY_MARKUP_GUIDE = `BODY MARKUP (section bodies, practicalTakeaway and conclusion; no HTML, no other markdown):
- Paragraphs are separated by a blank line. Keep most paragraphs 1-4 sentences; vary the rhythm.
- "### Subheading" on its own line starts an H3 subsection inside the section.
- A block where every line starts with "- " is a bulleted list. Use lists sparingly, for genuinely parallel items.
- "> One sentence from the article" on its own is a pull quote (max 2 in the whole article).
- **bold** for a lead-in phrase or the single most important idea in a paragraph; *italic* for titles and emphasis.
- [anchor phrase](claim_012) links the phrase to the source behind that verified claim. Claim IDs only, never URLs.`;

const BlogSectionOutputSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  sourceNote: z.string().nullable(),
  // Claim IDs from the editorial brief this section's factual statements rest on.
  claimIds: z.array(z.string()).default([]),
});

// Optional visual components matching the Bull or Bear reference article format
// (see htmlBuilder.ts). The model includes one only when the content genuinely
// supports it — never invented to decorate an article that doesn't warrant it — and
// every number/claim inside one is subject to the same sourcing rules as prose.
const ComparisonStatOutputSchema = z.object({
  label: z.string().min(1),
  leftValue: z.string().min(1),
  leftCaption: z.string().min(1),
  rightValue: z.string().min(1),
  rightCaption: z.string().min(1),
  footnote: z.string().min(1),
  afterSectionIndex: z.number().int().min(0),
});

const RevealCardOutputSchema = z.object({
  icon: z.string().min(1),
  teaser: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  // Optional upgrades (spec 19): a headline number on the front, a source on the back.
  number: z.string().nullable().optional(),
  sourceNote: z.string().nullable().optional(),
});

const RevealCardsOutputSchema = z.object({
  title: z.string().min(1),
  cards: z.array(RevealCardOutputSchema).min(3).max(6),
  afterSectionIndex: z.number().int().min(0),
});

const PollOptionOutputSchema = z.object({
  label: z.string().min(1),
  revealText: z.string().min(1),
});

const PollOutputSchema = z.object({
  question: z.string().min(1),
  options: z.tuple([PollOptionOutputSchema, PollOptionOutputSchema]),
  afterSectionIndex: z.number().int().min(0),
});

const PullQuoteOutputSchema = z.object({
  text: z.string().min(1),
  afterSectionIndex: z.number().int().min(0),
});

// New components are parsed leniently (`.catch(null)`): a malformed table/quiz is
// dropped rather than failing the whole article — a plain paragraph is always better
// than a broken widget (spec 22).
const lenient = <T extends z.ZodType>(schema: T) => schema.nullable().default(null).catch(null);

const WriterInternalLinkSchema = z.object({
  anchorText: z.string().min(1),
  targetContentId: z.string(),
  reason: z.string(),
});

// What the writer model returns.
export const DraftBlogArticleWriterSchema = z.object({
  titleOptions: z.array(z.string()).min(1).max(3),
  category: z.string().min(1),
  metaDescription: z.string().min(1),
  deck: z.string().min(1),
  // "Here's the short version": 2-4 plain-text bullets, or null.
  shortVersion: z.array(z.string().min(1)).min(2).max(4).nullable().default(null).catch(null),
  thesis: z.string().min(1),
  sections: z.array(BlogSectionOutputSchema).min(2),
  practicalTakeaway: z.string().nullable(),
  conclusion: z.string().min(1),
  disclaimer: z.string().nullable(),
  sources: z.array(z.string()).default([]),
  articleSummary: z.string().min(1),
  estimatedReadTime: z.string().nullable(),
  seoStatus: z.string(),
  styleMatchStatus: z.string(),
  comparisonStat: ComparisonStatOutputSchema.nullable().default(null),
  revealCards: RevealCardsOutputSchema.nullable().default(null),
  poll: PollOutputSchema.nullable().default(null),
  pullQuote: PullQuoteOutputSchema.nullable().default(null),
  table: lenient(TableComponentSchema),
  quiz: lenient(QuizComponentSchema),
  decision: lenient(DecisionComponentSchema),
  timeline: lenient(TimelineComponentSchema),
  barChart: lenient(BarChartComponentSchema),
  // Essay-standard fields (all lenient: a missing one never fails the draft).
  faq: FaqSchema.nullable().default(null).catch(null),
  conclusionHeading: z.string().max(90).nullable().default(null).catch(null),
  strapline: z.string().max(110).nullable().default(null).catch(null),
  titleAccent: z.string().max(60).nullable().default(null).catch(null),
  internalLinks: z.array(WriterInternalLinkSchema).max(5).default([]).catch([]),
  seo: SeoPlanSchema.nullable().default(null).catch(null),
  // The brief claim IDs the title/introduction rest on (empty for opinion/no-brief drafts).
  supportingClaimIds: z.array(z.string()).default([]),
});
export type DraftBlogArticleWriterOutput = z.infer<typeof DraftBlogArticleWriterSchema>;

// The structured draft as stored in content_items.package and handed to packaging:
// the writer's output plus everything the editorial pipeline added around it. Every
// added field defaults, so packages stored before the editorial upgrade still parse.
export const DraftBlogArticleOutputSchema = DraftBlogArticleWriterSchema.extend({
  internalLinks: z.array(InternalLinkSchema).default([]).catch([]),
  editorialArchitecture: EditorialArchitectureSchema.nullable().default(null).catch(null),
  editorialQuality: EditorialQualitySchema.nullable().default(null).catch(null),
  styleMemorySignals: z.array(StyleMemorySignalSchema).default([]).catch([]),
  editorialWarnings: z.array(EditorialWarningSchema).default([]).catch([]),
});
export type DraftBlogArticleOutput = z.infer<typeof DraftBlogArticleOutputSchema>;

export interface InternalLinkCandidate {
  contentId: string;
  title: string;
  url: string;
  thesis: string | null;
}

export interface DraftBlogArticleInput {
  topic: string;
  articleType: string;
  constraints?: string | null;
  sourceTexts: string[];
  sampleArticleTexts?: string[];
  contentDna: ContentDnaRecord;
  llm: LlmClient;
  runId: string;
  stepId: string;
  // The verified editorial core (spec 20); replaces raw sourceTexts when present.
  editorialBrief?: EditorialBrief | null;
  revisionNotes?: readonly string[];
  // Editorial upgrade inputs (all optional so the original call shape still works).
  architecture?: EditorialArchitecture | null;
  // Rendered Blog Style Profile + Editorial Memory guidance (editorial/styleProfile.ts,
  // memory/editorialMemory.ts).
  styleGuidance?: string | null;
  internalLinkCandidates?: readonly InternalLinkCandidate[];
  // Revision mode: the draft being edited by the final editor pass.
  previousDraft?: DraftBlogArticleWriterOutput | null;
}

const COMPONENT_GUIDANCE: Record<ComponentType, string> = {
  table: `table: { kind, title, subtitle|null, columns: [{label, align: "left"|"right"}], rows: [[cell, ...]],
  sourceNote, footnote|null, claimIds, afterSectionIndex }. Plain-text cells only. Every factual cell must
  come from the listed claimIds. Use for comparisons, timelines, bull vs bear, scenarios, metric breakdowns.`,
  revealCards: `revealCards: { title, cards: [{icon (one emoji), teaser, number|null, title, text, sourceNote|null}] (3-6),
  afterSectionIndex }. For "guess before you reveal", misconceptions, hidden mechanisms, myth vs reality.`,
  quiz: `quiz: { title, questions: [{question, type, options (2-4, distinct), correctOptionIndex, explanation,
  difficulty, sourceNote|null, claimIds}] (1-5), afterSectionIndex }. Exactly one correct option. The correct
  answer and the explanation must come from the listed claimIds. Reinforce what the article teaches — never trivia.`,
  poll: `poll: { question, options: [{label, revealText}, {label, revealText}], afterSectionIndex }. A genuine
  "what do you think?" with a fact-based reveal per option.`,
  decision: `decision: { title, question, options: [{label, revealTitle, revealText, evidenceNote|null}] (2-4),
  claimIds, afterSectionIndex }. A genuine trade-off ("what would you do?") with consequence, evidence and
  the Bull or Bear interpretation per option. Never for a question with one obvious factual answer.`,
  comparisonStat: `comparisonStat: { label, leftValue, leftCaption, rightValue, rightCaption, footnote,
  afterSectionIndex }. Two verified numbers side by side (before vs after, guess vs reality).`,
  pullQuote: `pullQuote: { text, afterSectionIndex }. One sentence FROM the article worth pulling out — never a
  fabricated quote from a person.`,
  timeline: `timeline: { title, events: [{date, title, description, sourceNote|null}] (3-10), claimIds,
  afterSectionIndex }. Only when chronology is the point.`,
  barChart: `barChart: { title, subtitle|null (what is measured · source, date), bars: [{label, value (number),
  displayValue (e.g. "26%"), group|null}] (2-10), sourceNote, claimIds, afterSectionIndex }. For survey splits,
  shares, rankings: the numbers a reader should SEE side by side. Every value comes from the listed claimIds.
  Use group (max two distinct groups) to colour two populations, e.g. "Gen Z" / "Gen X".`,
};

function renderArchitecture(a: EditorialArchitecture): string {
  const allowed = a.componentDecisions.filter((d) => d.decision === 'USE');
  const lines = [
    `ARTICLE ARCHITECTURE (decided before drafting — write to this plan; adapt headings, never the facts):`,
    `- Thesis: ${a.thesis}`,
    `- Primary angle: ${a.primaryAngle}${a.secondaryAngle ? `\n- Secondary angle: ${a.secondaryAngle}` : ''}`,
    `- Reader question the article answers: ${a.readerQuestion}`,
    a.hiddenMechanism ? `- Hidden mechanism to explain: ${a.hiddenMechanism}` : null,
    a.counterArgument ? `- Strongest counterargument to address honestly: ${a.counterArgument}` : null,
    a.bullCase ? `- Bull case: ${a.bullCase}` : null,
    a.bearCase ? `- Bear case: ${a.bearCase}` : null,
    a.whatWeDontKnow.length > 0 ? `- What we don't know (say so): ${a.whatWeDontKnow.join('; ')}` : null,
    a.keyFactClaimIds.length > 0 ? `- Key facts: ${a.keyFactClaimIds.join(', ')}` : null,
    a.keyNumberClaimIds.length > 0 ? `- Key numbers (give each one meaning): ${a.keyNumberClaimIds.join(', ')}` : null,
    `- Depth: ${a.articleDepth}, roughly ${a.targetWordRange[0]}-${a.targetWordRange[1]} words if the material genuinely supports it. Completeness over word count; shorter is fine, padding is not.`,
    `- Section plan (${a.sectionPlan.length}):`,
    ...a.sectionPlan.map((s, i) => `  ${i}. [${s.role}] ${s.headingIdea} — ${s.purpose}${s.claimIds.length > 0 ? ` (claims: ${s.claimIds.join(', ')})` : ''}`),
    a.mustNotClaim.length > 0 ? `- The article must NOT claim:\n${a.mustNotClaim.map((m) => `  - ${m}`).join('\n')}` : null,
    allowed.length > 0
      ? `- Interactive components APPROVED for this article (each optional; leave null if it stops earning its place):\n${allowed
          .map((d) => `  - ${d.type}: ${d.purpose}${d.claimIds.length > 0 ? ` (claims: ${d.claimIds.join(', ')})` : ''}${d.afterSectionIndex !== null ? ` — after section ${d.afterSectionIndex}` : ''}`)
          .join('\n')}`
      : '- No interactive components were approved for this article: every component field must be null.',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

function buildSystemPrompt(input: DraftBlogArticleInput): string {
  const dna = input.contentDna;
  const sampleArticleTexts = input.sampleArticleTexts ?? [];
  const styleBlock =
    sampleArticleTexts.length > 0
      ? `Sample recent Bull or Bear articles — identify recurring structural and linguistic patterns
across them and apply the common patterns. Do not blindly copy any one article's wording or
outline (spec 12.7):
${sampleArticleTexts.map((t, i) => `--- Sample ${i + 1} ---\n${t.slice(0, 3000)}`).join('\n\n')}`
      : (input.styleGuidance ??
        `No live site samples were supplied for this draft — use the site's own written editorial
observations below as the style baseline (spec 12.8):
${EDITORIAL_OBSERVATIONS.map((o) => `- ${o}`).join('\n')}`);

  const allowedTypes = new Set(
    (input.architecture?.componentDecisions ?? []).filter((d) => d.decision === 'USE').map((d) => d.type),
  );
  const componentBlock = input.architecture
    ? allowedTypes.size > 0
      ? `Component shapes (only for the approved components listed in the architecture; all others null):
${[...allowedTypes].map((t) => `- ${COMPONENT_GUIDANCE[t]}`).join('\n')}`
      : 'No interactive components are approved: set comparisonStat, revealCards, poll, pullQuote, table, quiz, decision and timeline to null.'
    : `Optional components — include each only when it genuinely improves understanding (a plain paragraph is
better than a widget that doesn't). Maximum one of each:
${Object.values(COMPONENT_GUIDANCE).map((g) => `- ${g}`).join('\n')}`;

  return `You are Agent 05 — the Bull or Bear Blog HTML Agent (spec section 12). Mission: accept a
topic and produce a finished article that feels like it was researched and edited by a strong
independent editorial team — closer to an intelligent Substack essay or a high-quality Indian business
publication's deep explainer than to generic AI SEO content, a listicle or a rewritten wire story.

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

${styleBlock}

Editorial craft:
${BLOG_CRAFT_RULES.map((r) => `- ${r}`).join('\n')}

THE BULL OR BEAR ESSAY STANDARD (what a finished article reads like — scale it to the material: a short
explainer keeps the rigour and the rhythm, not the length):
${ESSAY_STANDARD_RULES.map((r) => `- ${r}`).join('\n')}

${BODY_MARKUP_GUIDE}

${renderCraftPlaybook('blog')}
Never use these phrases (they read as AI-generated): ${AI_SLOP_PHRASES.slice(0, 40).join('; ')}.

Blog article anatomy (adapt to the topic — a 700-word explainer does not need seven sections):
- Title: specific, curiosity-led, honest and human. Deck: what the reader will learn.
- shortVersion (optional): 2-4 crisp bullets for skimmers, each traceable to a verified claim.
- Introduction: what happened, what is surprising, why the reader should care.
- Body: the facts, the question people are missing, what the data actually shows, the mechanism,
  the counterargument, what this means, what to watch next — as the material warrants.
- Evidence: a short sourceNote per section ("Source: RBI, September 2026"), never raw URLs in prose.
- Practical section: only when there is something useful to do or know.
- Conclusion: renders under a "Bottom line" heading; synthesis, implication or changed assumption.
- Disclaimer: only where financial/legal/tax/medical or other regulated subject matter requires it.

Never use an unsupported number. Every material claim must be traceable to the verified claims, or
clearly framed as interpretation/opinion/hypothetical. Do not invent image URLs, sources, quotes,
statistics, rankings, names, dates, causes, expert opinions or reader opinions.

Story-first writing rules:
${STORY_FIRST_WRITING_RULES.map((r) => `- ${r}`).join('\n')}
Blog editorial rules:
${BLOG_EDITORIAL_RULES.map((r) => `- ${r}`).join('\n')}
Priority order, never reversed: factual truth > verified editorial meaning > editorial quality > reader
value > brand voice > SEO > engagement.

${componentBlock}
Each component takes an afterSectionIndex (0-based index into "sections") — place it where it deepens
the argument, not automatically at the end. All component text is plain text (no HTML, no markdown).`;
}

function buildUserPrompt(input: DraftBlogArticleInput): string {
  const sourceBlock = input.editorialBrief
    ? `${renderBriefForWriter(input.editorialBrief)}

The brief decides WHAT is true and what the story is; you decide only how to express it as a Bull
or Bear article. Build the title on the selected angle and open with the strongest verified fact.`
    : input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 8000)}`).join('\n\n')
      : '(no source material supplied — original opinion/analysis; do not invent facts to fill the gap)';

  const architecture = input.architecture ? `\n\n${renderArchitecture(input.architecture)}` : '';
  const links =
    input.internalLinkCandidates && input.internalLinkCandidates.length > 0
      ? `\n\nPublished Bull or Bear articles you MAY link to (only where it genuinely helps the reader; the
anchorText must appear verbatim in one of your section bodies; use targetContentId exactly):
${input.internalLinkCandidates.map((c) => `- ${c.contentId}: "${c.title}"${c.thesis ? ` — ${c.thesis}` : ''}`).join('\n')}`
      : '';
  const revision =
    input.revisionNotes && input.revisionNotes.length > 0
      ? input.previousDraft
        ? `\n\nYou are now the FINAL EDITOR. Revise the draft below so it passes every point in the editor's
notes. Keep what works; fix what doesn't; cut what doesn't earn its place. Never add a fact that is not in
the verified claims. Return the full revised article.
Editor's notes:
${input.revisionNotes.map((n) => `- ${n}`).join('\n')}

Draft to revise (JSON):
${JSON.stringify(input.previousDraft)}`
        : `\n\nYour previous draft had these problems. Fix ALL of them, keeping every verified fact and qualifier exactly:\n${input.revisionNotes.map((n) => `- ${n}`).join('\n')}`
      : '';

  return `Topic: ${input.topic}
Article type: ${input.articleType} (spec 12.2's blog modes)
${input.constraints ? `Constraints (explicit user instructions override inferred style, never accuracy rules): ${input.constraints}\n` : ''}
Source material:
${sourceBlock}${architecture}${links}

Write one Bull or Bear article. Respond with the required JSON shape: titleOptions (1-3 honest,
curiosity-led options), category, metaDescription (under 160 characters, no keyword stuffing), deck,
shortVersion (or null), thesis (the article's one-sentence argument — internal, not rendered), sections
(ordered array, each an H2 with heading/body/sourceNote/claimIds — body uses the BODY MARKUP), practicalTakeaway
(or null), conclusion (BODY MARKUP), conclusionHeading (a phrase, not "Conclusion"), strapline (one short line for
the masthead, e.g. "Research, products and one uncomfortable experiment", or null), titleAccent (2-4 words of the
chosen title to set in the accent colour, copied exactly, or null), faq (4-5 {question, answer}, or null for a
short explainer), barChart (null unless approved), disclaimer (or null — only for
regulated subject matter), sources (clean labels like "Reuters, October 8, 2026"; can be empty),
articleSummary, estimatedReadTime (e.g. "6 min", or null), seoStatus (one sentence), styleMatchStatus (one
sentence: how this matches the style baseline), the component fields (null unless approved and genuinely
useful), internalLinks (or []), seo ({primaryKeyword, secondaryKeywords, searchIntent, relatedTopics}),
supportingClaimIds (claim IDs from the editorial brief that the title and introduction rest on, or an
empty list).${revision}`;
}

// A long-form article in JSON needs more room than the 4096-token default.
const WRITER_MAX_TOKENS = 8000;

export async function draftBlogArticle(input: DraftBlogArticleInput): Promise<DraftBlogArticleWriterOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(input),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
      maxTokens: WRITER_MAX_TOKENS,
    },
    DraftBlogArticleWriterSchema,
  );
}
