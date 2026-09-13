import { describe, expect, it } from 'vitest';

import { checkEmDash } from './emDash.js';
import { checkForbiddenPhrases } from './forbiddenPhrases.js';
import { classifyHighRiskTopic } from './highRiskTopic.js';
import { checkPersonalExperience } from './personalExperience.js';
import { checkPrivacy } from './privacy.js';
import { checkSourceIntegrity } from './sourceIntegrity.js';
import { checkApprovalState, checkEditability, checkPublishing } from './trivialChecks.js';
import { checkUnsupportedNumbers } from './unsupportedNumbers.js';

describe('checkEmDash', () => {
  it('fails on an em dash', () => {
    expect(checkEmDash('This is bad — very bad.').status).toBe('FAIL');
  });
  it('fails on a double hyphen', () => {
    expect(checkEmDash('This is bad -- very bad.').status).toBe('FAIL');
  });
  it('passes with no em dashes', () => {
    expect(checkEmDash('This is fine. Really fine.').status).toBe('PASS');
  });
});

describe('checkForbiddenPhrases', () => {
  for (const phrase of ['revolutionary', 'game-changing', 'unlock', 'supercharge', 'leverage', 'delve', 'seamless']) {
    it(`fails on brand-forbidden phrase "${phrase}"`, () => {
      expect(checkForbiddenPhrases(`This is a ${phrase} idea.`).status).toBe('FAIL');
    });
  }

  it('fails on a DNA-specific forbidden phrase', () => {
    expect(checkForbiddenPhrases('We must synergize our efforts.', ['synergize']).status).toBe('FAIL');
  });

  it('passes with no forbidden phrases', () => {
    expect(checkForbiddenPhrases('This is a plain, direct sentence.').status).toBe('PASS');
  });
});

describe('checkUnsupportedNumbers', () => {
  it('fails an unsupported statistic on a high-risk topic', () => {
    const result = checkUnsupportedNumbers('This stock returned 45% last year.', [], true);
    expect(result.status).toBe('FAIL');
  });

  it('warns (not fails) an unsupported statistic on a low-risk topic', () => {
    const result = checkUnsupportedNumbers('I bought 25 apples today.', [], false);
    expect(result.status).toBe('WARN');
  });

  it('passes when the number is present in source text', () => {
    const result = checkUnsupportedNumbers('This stock returned 45% last year.', ['the fund returned 45% last year'], true);
    expect(result.status).toBe('PASS');
  });

  it('passes when there are no numeric claims', () => {
    expect(checkUnsupportedNumbers('This is a plain sentence.', [], true).status).toBe('PASS');
  });
});

describe('checkPersonalExperience', () => {
  it('fails unauthorized first-person experience claims', () => {
    const result = checkPersonalExperience('When I lost my job, I learned a lot.', [], []);
    expect(result.status).toBe('FAIL');
  });

  it('warns when experiences are authorized but cannot be exactly matched', () => {
    const result = checkPersonalExperience('When I lost my job, I learned a lot.', ['lost my job in 2020'], []);
    expect(result.status).toBe('WARN');
  });

  it('passes with no first-person experience claims', () => {
    expect(checkPersonalExperience('The market moved sharply today.', [], []).status).toBe('PASS');
  });
});

describe('classifyHighRiskTopic', () => {
  it('flags financial claims', () => {
    const result = classifyHighRiskTopic('This mutual fund investment looks great.');
    expect(result.riskFlags).toContain('financial_claims');
  });

  it('classifies low risk with no matches', () => {
    const result = classifyHighRiskTopic('A pleasant walk in the park.');
    expect(result.riskLevel).toBe('low');
    expect(result.riskFlags).toHaveLength(0);
  });

  it('classifies high risk with 2+ category matches', () => {
    const result = classifyHighRiskTopic('The minister was accused of stock market fraud, 40% returns promised.');
    expect(result.riskLevel).toBe('high');
  });
});

describe('checkSourceIntegrity', () => {
  it('passes with source references attached', () => {
    expect(checkSourceIntegrity('A claim with 40% growth.', ['https://example.com']).status).toBe('PASS');
  });

  it('fails claim-like text with no sources', () => {
    expect(checkSourceIntegrity('According to a new study, 40% of users churn.', []).status).toBe('FAIL');
  });

  it('passes plain opinion text with no sources', () => {
    expect(checkSourceIntegrity('I think this trend will continue.', []).status).toBe('PASS');
  });
});

describe('checkPrivacy', () => {
  it('fails when sensitive/private DNA content appears', () => {
    expect(checkPrivacy('My friend at Acme Corp told me this.', ['Acme Corp']).status).toBe('FAIL');
  });

  it('warns on client-confidential language', () => {
    expect(checkPrivacy('Per our NDA with the client data team.', []).status).toBe('WARN');
  });

  it('passes clean text', () => {
    expect(checkPrivacy('A general observation about markets.', []).status).toBe('PASS');
  });
});

describe('trivial checks', () => {
  it('editability fails on empty text', () => {
    expect(checkEditability('').status).toBe('FAIL');
  });
  it('editability passes on non-empty text', () => {
    expect(checkEditability('hello').status).toBe('PASS');
  });
  it('approvalState mechanically reflects status', () => {
    const result = checkApprovalState('in_review');
    expect(result.status).toBe('PASS');
    expect(result.notes).toContain('in_review');
  });
  it('publishing is always PASS with publish disabled by construction elsewhere', () => {
    expect(checkPublishing().status).toBe('PASS');
  });
});
