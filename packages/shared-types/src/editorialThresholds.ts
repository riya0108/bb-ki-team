import type { EditorialQuality } from './blogEditorial.js';

// Spec 25: the editorial critic's hard thresholds. A draft below any of them is revised,
// and one still below after the final editor is BLOCKED (never presented as
// publish-ready). aiSlopRiskScore is "lower is better".
export const EDITORIAL_HARD_THRESHOLDS: readonly { key: keyof EditorialQuality; min?: number; max?: number }[] = [
  { key: 'factualGroundingScore', min: 9 },
  { key: 'evidenceQualityScore', min: 9 },
  { key: 'clarityScore', min: 8 },
  { key: 'humanVoiceScore', min: 8 },
  { key: 'depthScore', min: 8 },
  { key: 'brandFitScore', min: 9 },
  { key: 'aiSlopRiskScore', max: 2 },
];
