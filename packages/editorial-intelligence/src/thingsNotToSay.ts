import { claimFeatures } from '@bb/qa-gate';
import type { Claim } from '@bb/shared-types';

// Spec 21: forbidden formulations derived from protected facts. Short phrases (<= 6
// words) are also literally checked in hook critique and final QA; longer entries are
// writer guidance. Literal matching is never the only defence — the semantic drift
// rules and the LLM checker catch paraphrases of the same distortion.

// "This was the first RBI rate hike since 2023." -> "RBI rate hike"
function noveltyEventPhrase(text: string): string | null {
  const match = /\bfirst\s+(?:time\s+)?(?:ever\s+)?([\w\s-]{3,40}?)\s+(?:since|in)\b/i.exec(text);
  const phrase = match?.[1]?.trim();
  if (!phrase || /^(time|ever)$/i.test(phrase)) return null;
  return phrase;
}

function pluralize(phrase: string): string {
  return /s$/i.test(phrase) ? phrase : `${phrase}s`;
}

export function deriveThingsNotToSay(claims: readonly Claim[]): string[] {
  const out: string[] = [];
  for (const claim of claims) {
    if (!claim.mustPreserve) continue;
    const f = claimFeatures(claim);
    const quoted = claim.temporalContext.qualifier ?? claim.text;
    if (f.isNovelty) {
      const event = noveltyEventPhrase(claim.text);
      if (event) {
        out.push(`${event} again`, `another ${event}`, `continued ${pluralize(event)}`, `resumed ${pluralize(event)}`);
      }
      out.push(`Do not describe "${quoted}" as a repeat ("again", "another", "once more", "continues", "resumed").`);
      if (f.hasSinceQualifier) out.push(`Do not upgrade "${quoted}" to "first ever" or "unprecedented".`);
    }
    if (f.isProposal) out.push(`Do not describe "${claim.text}" as imposed, implemented, approved or in force.`);
    else if (f.isUncertain) out.push(`Do not state "${claim.text}" as certain or already happened ("will", "has").`);
    if (f.isSettled) out.push(`Do not turn "${claim.text}" into a possibility ("may", "could", "is expected to").`);
    if (f.isAssociation) out.push(`Do not say "${claim.text}" proves or causes anything.`);
    if (f.attributedTo) out.push(`Do not state "${claim.text}" without attributing it to ${f.attributedTo}.`);
    if (f.period) out.push(`Keep the period for "${claim.text}" as ${f.period}.`);
  }
  return [...new Set(out)];
}
