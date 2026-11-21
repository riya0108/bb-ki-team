import { contentStems, extractQuantities, isMaterialQuantity, quantitiesMatch, sharedStemCount, splitSentences } from '@bb/qa-gate';
import type { Claim } from '@bb/shared-types';

import type { ResearchDocument } from './research/researchStory.js';

// The claim extractor usually cites one document per claim, even when the same figure
// was fetched from three outlets. Before verification, look through every OTHER
// fetched document for a passage (one sentence, or two adjacent ones) that carries ALL
// of the claim's material figures and is about the same thing. Each match is attached
// as an extra evidence quote — verbatim from that document, so the deterministic quote
// check still passes on the text itself — and the evidence ceiling can then count
// independent publishers. Claims without figures are left alone: words alone are too
// loose a signal to call two passages the same fact.

const MAX_EXTRA_EVIDENCE = 3;
const MIN_TOPIC_OVERLAP = 0.35;

export function corroborateClaims(claims: readonly Claim[], documents: readonly ResearchDocument[]): Claim[] {
  const passagesByDoc = new Map(documents.map((d) => [d.source.id, passagesOf(d.text)]));
  return claims.map((claim) => {
    const figures = extractQuantities(claim.text).filter(isMaterialQuantity);
    if (figures.length === 0) return claim;
    const claimStems = contentStems(claim.text);
    if (claimStems.length < 3) return claim;
    const cited = new Set(claim.evidence.map((e) => e.sourceId));
    const extra: Claim['evidence'] = [];
    for (const doc of documents) {
      if (extra.length >= MAX_EXTRA_EVIDENCE) break;
      if (cited.has(doc.source.id)) continue;
      const passage = (passagesByDoc.get(doc.source.id) ?? []).find((p) => supports(p, figures, claimStems));
      if (passage) extra.push({ sourceId: doc.source.id, quote: passage, quoteFound: false });
    }
    if (extra.length === 0) return claim;
    return {
      ...claim,
      evidence: [...claim.evidence, ...extra],
      sourceIds: [...new Set([...claim.sourceIds, ...extra.map((e) => e.sourceId)])],
    };
  });
}

function passagesOf(text: string): string[] {
  const sentences = splitSentences(text).filter((s) => s.length <= 600);
  const pairs = sentences.slice(1).map((s, i) => `${sentences[i]} ${s}`);
  return [...sentences, ...pairs];
}

function supports(passage: string, figures: ReturnType<typeof extractQuantities>, claimStems: readonly string[]): boolean {
  const found = extractQuantities(passage);
  if (!figures.every((f) => found.some((q) => quantitiesMatch(f, q)))) return false;
  return sharedStemCount(contentStems(passage), claimStems) / claimStems.length >= MIN_TOPIC_OVERLAP;
}
