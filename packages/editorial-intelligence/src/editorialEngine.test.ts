import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import type { EditorialAngle } from '@bb/shared-types';
import { buildClaimFixture, buildRbiClaims, buildRbiEditorialBrief, RBI_FIRST_SINCE_CLAIM_ID } from '@bb/shared-types/testing';
import { describe, expect, it } from 'vitest';

import { fallbackUserRequest, hasFactualSignal } from './analyzeTopic.js';
import { EditorialBriefValidationError, validateBriefSemantics } from './buildEditorialBrief.js';
import { critiqueHooks, deterministicHookIssues, rankAccepted } from './critiqueHooks.js';
import { selectAngle } from './selectAngles.js';
import { RBI_BAD_HOOK, RBI_GOOD_HOOK, RBI_USER_MESSAGE } from './testing/index.js';
import { deriveThingsNotToSay } from './thingsNotToSay.js';
import { normalizeTopicKey } from './topicKey.js';
import { buildEditorialSummary, renderBriefForWriter } from './writerBrief.js';

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

describe('analyzeTopic deterministic layer', () => {
  it('treats news-shaped topics as needing research and evergreen opinion as not', () => {
    expect(hasFactualSignal('RBI just hiked rates for the first time since 2023')).toBe(true);
    expect(hasFactualSignal('Give me 5 opinions about budgeting')).toBe(false);
  });

  it('splits the RBI request into a candidate fact and a hook suggestion, dropping instructions', () => {
    const split = fallbackUserRequest(RBI_USER_MESSAGE);
    expect(split.candidateFacts).toEqual(['RBI just hiked rates for the first time since 2023.']);
    expect(split.hookSuggestions[0]).toContain('first time in nearly four years');
  });
});

describe('Hook critic (spec 18/40)', () => {
  const claims = buildRbiClaims();

  it('rejects "again" for a first-since fact even when the LLM critic loves it', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        critiques: ['h_bad', 'h_good'].map((hookId) => ({
          hookId,
          factualAccuracy: true,
          meaningPreservation: true,
          specificity: hookId === 'h_bad' ? 10 : 6,
          curiosity: hookId === 'h_bad' ? 10 : 6,
          relevance: 8,
          readerImpact: 8,
          surprise: 8,
          clarity: 8,
          naturalness: 8,
          brandFit: 8,
          platformPotential: hookId === 'h_bad' ? 10 : 6,
          notes: 'ok',
        })),
      }),
    );
    const scored = await critiqueHooks({
      hooks: [
        { id: 'h_bad', text: RBI_BAD_HOOK, pattern: 'consequenceFirst', supportingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID] },
        { id: 'h_good', text: RBI_GOOD_HOOK, pattern: 'firstOrLast', supportingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID, 'claim_rbi_003'] },
      ],
      claims,
      thingsNotToSay: [],
      llm,
      logger: noopLogger,
      runId: 'r',
    });
    const bad = scored.find((s) => s.candidate.id === 'h_bad');
    expect(bad?.rejected).toBe(true);
    expect(bad?.rejectionReasons.join(' ')).toContain('first occurrence');
    expect(rankAccepted(scored).map((s) => s.candidate.id)).toEqual(['h_good']);
  });

  it('rejects hooks with unsupported numbers, unknown claims, unverified support or LLM gate failures', async () => {
    expect(deterministicHookIssues({ id: 'h', text: 'Your EMI could rise by ₹4,000.', pattern: 'scale', supportingClaimIds: ['claim_rbi_003'] }, claims, [])).not.toEqual([]);
    expect(deterministicHookIssues({ id: 'h', text: 'Something true.', pattern: 'scale', supportingClaimIds: ['nope'] }, claims, [])).not.toEqual([]);

    const scored = await critiqueHooks({
      hooks: [{ id: 'h1', text: RBI_GOOD_HOOK, pattern: 'firstOrLast', supportingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID] }],
      claims,
      thingsNotToSay: [],
      llm: createFakeLlmClient(() =>
        JSON.stringify({
          critiques: [{ hookId: 'h1', factualAccuracy: false, meaningPreservation: true, specificity: 9, curiosity: 9, relevance: 9, readerImpact: 9, surprise: 9, clarity: 9, naturalness: 9, brandFit: 9, platformPotential: 9, notes: 'overstates' }],
        }),
      ),
      logger: noopLogger,
      runId: 'r',
    });
    expect(scored[0]?.rejected).toBe(true);
  });

  it('still ranks hooks on deterministic gates when the critic LLM is unavailable', async () => {
    const scored = await critiqueHooks({
      hooks: [{ id: 'h1', text: RBI_GOOD_HOOK, pattern: 'firstOrLast', supportingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID] }],
      claims,
      thingsNotToSay: [],
      llm: createFakeLlmClient(() => 'not json'),
      logger: noopLogger,
      runId: 'r',
    });
    expect(scored[0]?.rejected).toBe(false);
    expect(scored[0]?.critique).toBeNull();
  });
});

describe('selectAngle', () => {
  const claims = buildRbiClaims();
  const angle = (id: string, overrides: Partial<EditorialAngle>): EditorialAngle => ({
    id,
    angle: id,
    rationale: 'r',
    supportingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID],
    audience: 'a',
    emotionalMode: 'curiosity',
    riskLevel: 'low',
    relevance: 7,
    novelty: 7,
    readerImpact: 7,
    curiosity: 7,
    brandFit: 7,
    matchesUserIntent: false,
    ...overrides,
  });

  it('prefers well-evidenced angles over vivid ones resting on unverified claims', () => {
    const weak = buildClaimFixture('weak', 'Analysts think another hike is coming.', { verificationStatus: 'PARTIALLY_VERIFIED' });
    const chosen = selectAngle(
      [angle('vivid', { supportingClaimIds: ['weak'], novelty: 10, curiosity: 10 }), angle('solid', {})],
      [...claims, weak],
      'medium',
    );
    expect(chosen?.id).toBe('solid');
  });

  it('honours the user-requested angle when evidence is comparable', () => {
    expect(selectAngle([angle('a', { relevance: 8 }), angle('user', { matchesUserIntent: true })], claims, 'low')?.id).toBe('user');
  });

  it('returns null when no angle rests on a usable claim', () => {
    expect(selectAngle([angle('x', { supportingClaimIds: ['missing'] })], claims, 'low')).toBeNull();
  });
});

describe('thingsNotToSay', () => {
  it('derives repeat-formulations to avoid for a first-since fact', () => {
    const out = deriveThingsNotToSay(buildRbiClaims());
    expect(out).toContain('RBI rate hike again');
    expect(out).toContain('another RBI rate hike');
    expect(out.some((s) => s.includes('first ever'))).toBe(true);
  });
});

describe('EditorialBrief construction and rendering', () => {
  it('rejects a brief whose selected hook references a claim that does not exist', () => {
    const brief = buildRbiEditorialBrief();
    const broken = { ...brief, selectedHooks: [{ id: 'h', text: 'x', pattern: 'scale' as const, supportingClaimIds: ['ghost'] }] };
    expect(validateBriefSemantics(broken)).toContain('hook h references unknown claims');
    expect(new EditorialBriefValidationError(['x'])).toBeInstanceOf(Error);
  });

  it('renders protected facts, approved hooks and things-not-to-say for writers', () => {
    const rendered = renderBriefForWriter(buildRbiEditorialBrief());
    expect(rendered).toContain('PROTECTED FACTS');
    expect(rendered).toContain('keep exactly: "first time since 2023"');
    expect(rendered).toContain('APPROVED HOOKS');
    expect(rendered).toContain('hiked rates again');
  });

  it('tells writers not to state facts when evidence was insufficient', () => {
    const rendered = renderBriefForWriter(buildRbiEditorialBrief({ kind: 'insufficient_evidence', storyEssence: null, selectedHooks: [], selectedAngle: null }));
    expect(rendered).toContain('research could not verify this story');
  });

  it('builds a review summary exposing story, angle, hook and key facts', () => {
    const summary = buildEditorialSummary(buildRbiEditorialBrief());
    expect(summary.selectedHook).toContain('first time since 2023');
    expect(summary.keyFacts[0]?.claimId).toBe(RBI_FIRST_SINCE_CLAIM_ID);
  });

  it('normalizes topic keys order-independently', () => {
    expect(normalizeTopicKey('RBI hikes rates first time since 2023')).toBe(normalizeTopicKey('First time since 2023: RBI hikes rates'));
  });
});
