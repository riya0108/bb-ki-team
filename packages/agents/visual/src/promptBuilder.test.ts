import type { GenerationBrief } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { buildGenerationPrompt, buildNegativePrompt } from './promptBuilder.js';

const brief: GenerationBrief = {
  subject: 'a trader',
  secondarySubjects: ['a falling stock chart'],
  action: 'staring at a screen',
  environment: 'a dim trading floor',
  emotion: 'concern',
  composition: 'rule of thirds',
  camera: 'medium shot',
  lens: '50mm',
  lighting: 'low key',
  depthOfField: 'shallow',
  style: 'editorial photography',
  aspectRatio: '4:5',
  textOnImage: 'none',
  negativeConstraints: ['no visible brand logos'],
};

describe('buildGenerationPrompt', () => {
  it('includes every brief field without inventing anything new', () => {
    const prompt = buildGenerationPrompt(brief);
    expect(prompt).toContain('a trader');
    expect(prompt).toContain('a falling stock chart');
    expect(prompt).toContain('a dim trading floor');
    expect(prompt).toContain('No text on the image.');
  });

  it('states the requested text when textOnImage is not "none"', () => {
    const prompt = buildGenerationPrompt({ ...brief, textOnImage: 'UPI FEES RISE' });
    expect(prompt).toContain('Text on image: UPI FEES RISE.');
  });
});

describe('buildNegativePrompt', () => {
  it('always includes the standing style-avoid list plus the brief-specific constraints', () => {
    const negative = buildNegativePrompt(brief);
    expect(negative).toContain('fake screenshots');
    expect(negative).toContain('no visible brand logos');
  });
});
