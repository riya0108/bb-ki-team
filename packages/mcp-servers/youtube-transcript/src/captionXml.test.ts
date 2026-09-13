import { describe, expect, it } from 'vitest';

import { parseTimedTextXml } from './captionXml.js';

describe('parseTimedTextXml', () => {
  it('joins caption lines in order, decoding HTML entities', () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?><transcript>
      <text start="0.5" dur="2.0">We didn&#39;t expect this</text>
      <text start="2.5" dur="2.0">but it changed everything &amp; more</text>
    </transcript>`;

    expect(parseTimedTextXml(xml)).toBe("We didn't expect this but it changed everything & more");
  });

  it('returns an empty string for XML with no text nodes', () => {
    expect(parseTimedTextXml('<transcript></transcript>')).toBe('');
  });

  it('drops empty/whitespace-only lines', () => {
    const xml = '<transcript><text start="0" dur="1">   </text><text start="1" dur="1">Real line</text></transcript>';
    expect(parseTimedTextXml(xml)).toBe('Real line');
  });
});
