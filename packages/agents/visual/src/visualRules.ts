// Transcribed from BB-Visual-Agent-Skill's SKILL.md and references/visual-rules.md —
// kept as data here (not copied prose) so future edits to the skill package can be
// diffed against this file's source of truth.

export const VISUAL_GUARDRAILS: readonly string[] = [
  'Never claim a result that has not actually been produced.',
  'Never publish raw AI output without the required review/editing process.',
  'Never use a client name without permission.',
  'Never manufacture outrage for engagement.',
  'Never present an estimate as a fact.',
  'Never cherry-pick numbers to force a narrative.',
  'Never confuse popularity with truth.',
  'Never make the reader feel stupid.',
  'Never sacrifice accuracy for a better hook.',
  'Never invent statistics, sources, quotes, screenshots, case studies, testimonials, earnings ' +
    'figures, experiments, documents, charts, government notices, financial statements, app ' +
    'interfaces, news screenshots or other evidence.',
  'Never imply personal experience that did not happen.',
  'Never expose private/confidential information.',
  'Never alter factual meaning for platform performance.',
  'Never present an AI reconstruction as a real documentary photograph.',
  'Never fabricate logos, official notices or institutional documents.',
  'If an illustrative reconstruction is used, record that fact in metadata.',
];

export const VISUAL_DECISION_PRIORITY: readonly string[] = [
  'mechanism (how something works)',
  'consequence (what happened to a person/business/system)',
  'conflict (two forces colliding)',
  'human reaction (story is fundamentally about people)',
  'object/product (a physical object is central)',
  'comparison (clean comparison without unsupported scores)',
  'data/explainer (chart/infographic using only supplied numbers)',
  'environment/context (establishing shot)',
  'symbolic/metaphorical (only when literal representation is weak)',
];

export const VISUAL_STYLE_PREFERENCES: readonly string[] = [
  'realistic editorial/documentary photography',
  'believable environments',
  'natural or motivated lighting',
  'restrained cinematic depth of field',
  'clear foreground/background hierarchy',
  'clean infographics for data-heavy stories',
];

export const VISUAL_STYLE_AVOID: readonly string[] = [
  'generic AI posters',
  'plastic people',
  'excessive neon',
  'fake screenshots',
  'fake documents',
  'fake news headlines',
  'fake charts',
  'fake testimonials',
  'invented logos',
];

export const HIGH_RISK_VISUAL_TOPICS: readonly string[] = [
  'politics',
  'elections',
  'breaking news',
  'medical',
  'legal',
  'financial-market breaking news',
  'allegations involving identifiable people',
  'crime',
  'accidents/disasters',
  'client-sensitive material',
  'reputationally sensitive claims',
];
