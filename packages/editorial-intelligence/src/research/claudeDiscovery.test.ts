import { createLogger } from '@bb/core';
import type { FetchTool } from '@bb/mcp-client';
import { describe, expect, it, vi } from 'vitest';

import { createClaudeCodeDiscoveryResearcher, parseDiscoveryOutput, quotesFoundIn, withOpenedPrimaryDocuments } from './claudeDiscovery.js';
import { researchStory } from './researchStory.js';

const logger = createLogger({ module: 'claudeDiscovery.test' });

const lead = (url: string, quote: string | null = null) => ({
  url,
  title: 'How India Saves 2026',
  publisher: 'Business Standard',
  publishedDate: '2026-11-05',
  sourceType: 'news' as const,
  whyItMatters: 'The survey itself.',
  keyFacts: [{ fact: '26% of Gen Z named a home first', verbatimQuote: quote }],
});

describe('parseDiscoveryOutput', () => {
  it('reads fenced JSON, drops malformed and duplicate leads, rejects non-http URLs', () => {
    const text = 'Here you go:\n```json\n' + JSON.stringify({
      leads: [lead('https://a.example/1'), lead('https://a.example/1'), { url: 'javascript:alert(1)', title: 'x' }, { title: 'no url' }, lead('https://b.example/2')],
    }) + '\n```';
    expect(parseDiscoveryOutput(text).map((l) => l.url)).toEqual(['https://a.example/1', 'https://b.example/2']);
  });

  it('throws on output with no JSON object (the pipeline treats that as "no leads")', () => {
    expect(() => parseDiscoveryOutput('I could not find anything.')).toThrow();
  });
});

describe('quotesFoundIn', () => {
  it('matches verbatim quotes despite whitespace, case and typographic differences only', () => {
    const page = 'Among Gen Z,  26%  named “buying a home” as their primary goal — the survey said.';
    expect(quotesFoundIn(['26% named "buying a home" as their primary goal - the survey said'], page)).toHaveLength(1);
    expect(quotesFoundIn(['31% named buying a home as their primary goal'], page)).toHaveLength(0);
    expect(quotesFoundIn(['26%'], page)).toHaveLength(0); // too short to mean anything
  });
});

describe('createClaudeCodeDiscoveryResearcher', () => {
  it('runs with only WebSearch/WebFetch and logs every tool call with the run ID', async () => {
    const info = vi.spyOn(logger, 'info');
    const run = vi.fn((_config: unknown, input: { tools: readonly string[]; onToolCall?: (c: { name: string; input: unknown }) => void }) => {
      input.onToolCall?.({ name: 'WebSearch', input: { query: 'gen z home survey' } });
      return Promise.resolve({ text: JSON.stringify({ leads: [lead('https://a.example/1')] }), model: 'opus', costUsd: null, toolCalls: [] });
    });
    const research = createClaudeCodeDiscoveryResearcher({ config: { model: 'opus' }, logger, run, now: () => new Date('2026-11-17T00:00:00Z') });
    const leads = await research({ topic: 'Gen Z homes', userMessage: null, queries: [], runId: 'run-9' });
    expect(leads).toHaveLength(1);
    expect(run.mock.calls[0]?.[1].tools).toEqual(['WebSearch', 'WebFetch']);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-9', tool: 'WebSearch', query: 'gen z home survey' }), 'Claude research tool call');
  });
});

describe('researchStory with discovered leads', () => {
  const pageText = `${'Context paragraph. '.repeat(20)}Among Gen Z, 26% named buying a home as their primary financial goal.`;
  const fetchTool = {
    fetchUrl: vi.fn((url: string) =>
      url.includes('blocked')
        ? Promise.reject(new Error('403'))
        : Promise.resolve({ text: pageText, title: 'Survey story', fetchedAt: '2026-11-17T00:00:00Z' }),
    ),
  } as unknown as FetchTool;

  it('re-fetches each lead through the scoped fetch tool and keeps only quotes found in the page', async () => {
    const dossier = await researchStory({
      topic: 'gen z home survey',
      queries: [],
      userUrls: [],
      providedDocuments: [],
      maxSearchQueries: 0,
      discoveredLeads: [
        { ...lead('https://www.business-standard.com/survey'), keyFacts: [
          { fact: 'a', verbatimQuote: 'Among Gen Z, 26% named buying a home as their primary financial goal.' },
          { fact: 'b', verbatimQuote: 'Invented sentence that is not on the page at all.' },
        ] },
        lead('https://blocked.example/x'),
      ],
      fetchTool,
      logger,
      runId: 'r',
    });
    const [fetched, unfetched] = dossier.documents;
    expect(fetched?.source).toMatchObject({ kind: 'fetched_article', tier: 'secondary', url: 'https://www.business-standard.com/survey' });
    expect(fetched?.text).toContain('Key passages (verified present in this page)');
    expect(fetched?.text).not.toContain('Invented sentence');
    // An unfetchable lead never becomes evidence that can verify a claim.
    expect(unfetched?.source).toMatchObject({ kind: 'news_search_result', tier: 'discovery' });
    expect(dossier.failures.map((f) => f.url)).toEqual(['https://blocked.example/x']);
  });
});

describe('withOpenedPrimaryDocuments', () => {
  const listed = parseDiscoveryOutput(
    JSON.stringify({ leads: [{ url: 'https://www.businesstoday.in/sebi-survey', title: 'SEBI survey story', sourceType: 'news' }] }),
  );

  it('adds primary-domain pages Claude opened but did not list', () => {
    const leads = withOpenedPrimaryDocuments(listed, [
      { name: 'WebFetch', input: { url: 'https://www.sebi.gov.in/reports/investor-survey-2025.pdf' } },
      { name: 'WebFetch', input: { url: 'https://www.businesstoday.in/sebi-survey' } },
      { name: 'WebFetch', input: { url: 'https://example-blog.com/fd-vs-mf' } },
      { name: 'WebSearch', input: { query: 'sebi survey' } },
    ]);
    expect(leads.map((l) => l.url)).toEqual(['https://www.businesstoday.in/sebi-survey', 'https://www.sebi.gov.in/reports/investor-survey-2025.pdf']);
    expect(leads[1]?.sourceType).toBe('primary');
  });
});
