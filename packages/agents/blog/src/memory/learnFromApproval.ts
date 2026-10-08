import type { Logger } from '@bb/core';
import type { Pool } from '@bb/db';
import { listRevisionsForContent, upsertStyleSample } from '@bb/db';
import { contentStems, sharedStemCount } from '@bb/qa-gate';
import type { ContentItem, StyleMemorySignal } from '@bb/shared-types';

import type { ArticleHtmlAnalysis } from '../editorial/styleMetrics.js';
import { analyzeArticleHtml, classifyOpening, computeStyleMetrics } from '../editorial/styleMetrics.js';

import type { SignalOutcome } from './editorialMemory.js';
import { recordEditorialSignal } from './editorialMemory.js';
import { statementFor } from './subjects.js';

// Spec 45: after a human approves a blog article, compare the AI's first draft with
// the version actually approved and keep only the editorial PATTERN of what changed
// ("removed the quiz", "shortened it", "added a counterargument", "rewrote the opening
// as a question") — never the edited text itself. Every signal is "observed" strength:
// it becomes a confirmed preference only once it repeats (memory/editorialMemory.ts).
// The approved article is also measured into the Blog Style Profile.

const COUNTER_HEADING = /\b(counter|the case against|but what if|what could go wrong|the other side|bear case|bull case|skeptic|sceptic|the catch)\b/i;

function wordsIn(a: ArticleHtmlAnalysis): number {
  return a.shape.paragraphs.join(' ').split(/\s+/).filter((w) => w.length > 0).length;
}

export function diffEditorialSignals(original: ArticleHtmlAnalysis, approved: ArticleHtmlAnalysis): StyleMemorySignal[] {
  const signals: StyleMemorySignal[] = [];
  const push = (subject: string, polarity: 'prefer' | 'avoid', why: string): void => {
    signals.push({ subject, polarity, statement: `${statementFor(subject, polarity) ?? subject} (${why})` });
  };

  for (const removed of original.components.filter((c) => !approved.components.includes(c))) {
    push(`component:${removed}`, 'avoid', `editor removed a ${removed} before approving`);
  }
  for (const added of approved.components.filter((c) => !original.components.includes(c))) {
    push(`component:${added}`, 'prefer', `editor added a ${added} before approving`);
  }

  const originalWords = wordsIn(original);
  const approvedWords = wordsIn(approved);
  if (originalWords > 0 && approvedWords < originalWords * 0.8) push('length:shorter', 'prefer', `cut from ~${originalWords} to ~${approvedWords} words`);
  if (originalWords > 0 && approvedWords > originalWords * 1.2) push('length:longer', 'prefer', `grew from ~${originalWords} to ~${approvedWords} words`);

  const originalSections = original.shape.headings.length;
  const approvedSections = approved.shape.headings.length;
  if (approvedSections < originalSections - 1) push('sections:fewer', 'prefer', `sections cut from ${originalSections} to ${approvedSections}`);

  const openingOverlap = (() => {
    const a = contentStems(original.shape.opening);
    const b = contentStems(approved.shape.opening);
    return a.length === 0 ? 1 : sharedStemCount(b, a) / Math.max(a.length, b.length, 1);
  })();
  if (openingOverlap < 0.5 && approved.shape.opening.length > 0) {
    const before = classifyOpening(original.shape.opening);
    const after = classifyOpening(approved.shape.opening);
    if (after !== before && ['question', 'statistic', 'anecdote', 'tension', 'event'].includes(after)) {
      push(`opening:${after}_led`, 'prefer', `editor rewrote a ${before} opening as a ${after} opening`);
    }
  }

  const hadCounter = original.shape.headings.some((h) => COUNTER_HEADING.test(h));
  const hasCounter = approved.shape.headings.some((h) => COUNTER_HEADING.test(h));
  if (!hadCounter && hasCounter) push('counterargument:stronger', 'prefer', 'editor added a counterargument section');

  if (original.title !== approved.title && approved.title.trim().endsWith('?') && !original.title.trim().endsWith('?')) {
    push('headline:question_style', 'prefer', 'editor changed the headline to a question');
  }
  return signals;
}

// Approved with no edits at all: the draft's own choices were accepted. Weak positive
// signals only (they reinforce, never create confirmed preferences on their own).
export function acceptanceSignals(approved: ArticleHtmlAnalysis): StyleMemorySignal[] {
  const signals: StyleMemorySignal[] = [];
  const opening = classifyOpening(approved.shape.opening);
  if (['question', 'statistic', 'anecdote', 'tension', 'event'].includes(opening)) {
    signals.push({ subject: `opening:${opening}_led`, polarity: 'prefer', statement: `${statementFor(`opening:${opening}_led`, 'prefer') ?? ''} (approved unedited)` });
  }
  for (const c of approved.components) {
    signals.push({ subject: `component:${c}`, polarity: 'prefer', statement: `${statementFor(`component:${c}`, 'prefer') ?? c} (approved unedited)` });
  }
  return signals;
}

export interface LearnFromApprovalResult {
  signals: StyleMemorySignal[];
  outcomes: SignalOutcome[];
  styleSampleId: string | null;
}

export async function learnFromApprovedBlog(pool: Pool, item: ContentItem, logger?: Logger): Promise<LearnFromApprovalResult> {
  if (item.platform !== 'blog') return { signals: [], outcomes: [], styleSampleId: null };
  const revisions = await listRevisionsForContent(pool, item.id);
  const first = [...revisions].sort((a, b) => a.version - b.version)[0];
  const originalHtml = first?.previousText ?? item.currentText;

  const approved = analyzeArticleHtml(item.currentText);
  const original = analyzeArticleHtml(originalHtml);
  const signals = originalHtml === item.currentText ? acceptanceSignals(approved) : diffEditorialSignals(original, approved);

  const outcomes: SignalOutcome[] = [];
  for (const s of signals) {
    outcomes.push(
      await recordEditorialSignal(pool, {
        subject: s.subject,
        polarity: s.polarity,
        statement: s.statement,
        source: originalHtml === item.currentText ? 'approval' : 'edit_diff',
        strength: 'observed',
        contentId: item.id,
      }),
    );
  }

  const sample = await upsertStyleSample(pool, {
    kind: 'approved_article',
    label: approved.title.length > 0 ? approved.title : (item.topic ?? 'Approved article'),
    sourceUrl: null,
    contentId: item.id,
    metrics: computeStyleMetrics(approved.shape),
    traits: {
      openingTechnique: null,
      transitionPatterns: [],
      conclusionPattern: null,
      evidenceUse: null,
      narrativeUse: null,
      conversationality: null,
      editorialDepth: null,
      directness: null,
      skepticism: null,
      warmth: null,
      formality: null,
    },
  });
  logger?.info({ contentId: item.id, signals: signals.length, styleSampleId: sample.id }, 'Learned editorial patterns from an approved blog article');
  return { signals, outcomes, styleSampleId: sample.id };
}
