// Mirrors X_MAX_POST_LENGTH in packages/mcp-client/src/xClient.ts (that copy is the
// publish-time backstop; this one is the draft-time source of truth). Kept as a
// separate constant rather than a shared import — packages/mcp-client sits below
// packages/agents/x in the dependency graph, so this package can't import from it.
export const X_MAX_POST_LENGTH = 280;

// Greedily packs `units` into runs joined by `joiner`, each run capped at maxLen. A
// unit that alone exceeds maxLen is handed to `splitOversized` for its own finer-grained
// split rather than truncated — nothing here ever silently drops content.
function pack(units: string[], joiner: string, maxLen: number, splitOversized: (unit: string) => string[]): string[] {
  const out: string[] = [];
  let current = '';
  for (const unit of units) {
    const candidate = current ? `${current}${joiner}${unit}` : unit;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    if (unit.length <= maxLen) {
      current = unit;
    } else {
      out.push(...splitOversized(unit));
      current = '';
    }
  }
  if (current) out.push(current);
  return out;
}

function splitWords(text: string, maxLen: number): string[] {
  return pack(text.split(/\s+/), ' ', maxLen, (word) => {
    const chunks: string[] = [];
    for (let i = 0; i < word.length; i += maxLen) chunks.push(word.slice(i, i + maxLen));
    return chunks;
  });
}

function splitSentences(text: string, maxLen: number): string[] {
  const sentences = (text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  return pack(sentences, ' ', maxLen, (sentence) => splitWords(sentence, maxLen));
}

// Splits one over-limit post into an ordered thread, preferring the author's own
// paragraph breaks (then sentences, then words, then a hard character slice as a
// last resort) so each tweet still reads as a coherent unit instead of an arbitrary
// cut. A post already within maxLen comes back as a single-element array, unchanged.
export function splitPostIntoThread(text: string, maxLen: number = X_MAX_POST_LENGTH): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return pack(paragraphs, '\n\n', maxLen, (paragraph) => splitSentences(paragraph, maxLen));
}
