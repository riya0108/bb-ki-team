import type { GenerationBrief } from '@bb/shared-types';

import { VISUAL_STYLE_AVOID } from './visualRules.js';

// Turns the structured generation brief into the actual prompt sent to the image
// provider (templates/image-generation.prompt.md's shape). Never adds a fact not
// already present in the brief — the brief itself is where fabrication is guarded
// against (decideAndBrief.ts's system prompt), this function is a pure formatter.
export function buildGenerationPrompt(brief: GenerationBrief): string {
  const lines = [
    `Subject: ${brief.subject}.`,
    brief.secondarySubjects.length > 0
      ? `Also present: ${brief.secondarySubjects.join(', ')}.`
      : null,
    `Action: ${brief.action}.`,
    `Environment: ${brief.environment}.`,
    brief.emotion ? `Emotion: ${brief.emotion}.` : null,
    `Composition: ${brief.composition}.`,
    `Camera: ${brief.camera}.`,
    brief.lens ? `Lens: ${brief.lens}.` : null,
    `Lighting: ${brief.lighting}.`,
    brief.depthOfField ? `Depth of field: ${brief.depthOfField}.` : null,
    `Style: ${brief.style}.`,
    brief.textOnImage !== 'none' ? `Text on image: ${brief.textOnImage}.` : 'No text on the image.',
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}

export function buildNegativePrompt(brief: GenerationBrief): string {
  return [...VISUAL_STYLE_AVOID, ...brief.negativeConstraints].join(', ');
}
