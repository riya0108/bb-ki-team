import { describe, expect, it } from 'vitest';

import { bodyCitedClaimIds, bodyPlainText, bodySubheadings, parseBody } from './bodyMarkup.js';

const body = [
  'The **arithmetic** is the whole story, says [Knight Frank](claim_004).',
  '### A House Is Not Just a House',
  'A home is the only asset you can *sleep inside*.',
  'What to do:\n- Keep retirement on the list.\n- Run the EMI test.',
  '> Four walls and six months of cash.',
].join('\n\n');

describe('parseBody', () => {
  it('parses paragraphs, subheads, lists (incl. a lead-in line) and pull quotes', () => {
    expect(parseBody(body).map((b) => b.kind)).toEqual(['p', 'h3', 'p', 'p', 'ul', 'pull']);
    expect(bodySubheadings(body)).toEqual(['A House Is Not Just a House']);
  });

  it('treats a plain multi-line paragraph as one paragraph', () => {
    expect(parseBody('one line\nsame paragraph')).toEqual([{ kind: 'p', text: 'one line same paragraph' }]);
  });
});

describe('bodyPlainText', () => {
  it('strips markup for QA and leaves pull quotes out (they repeat the article)', () => {
    const plain = bodyPlainText(body);
    expect(plain).toContain('The arithmetic is the whole story, says Knight Frank.');
    expect(plain).toContain('the only asset you can sleep inside.');
    expect(plain).toContain('Keep retirement on the list.');
    expect(plain).not.toMatch(/[*#>[\]]/);
    expect(plain).not.toContain('Four walls and six months');
  });

  it('keeps arithmetic asterisks that are not emphasis', () => {
    expect(bodyPlainText('5 * 3 = 15')).toBe('5 * 3 = 15');
  });
});

describe('bodyCitedClaimIds', () => {
  it('lists cited claim IDs once each', () => {
    expect(bodyCitedClaimIds('[a](claim_001) and [b](claim_002) and [c](claim_001)')).toEqual(['claim_001', 'claim_002']);
  });
});
