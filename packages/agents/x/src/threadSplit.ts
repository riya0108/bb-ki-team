import { X_MAX_POST_LENGTH, xPostLength } from '@bb/shared-types';

// The limit and X's weighted character count live in @bb/shared-types so this
// draft-time split and packages/mcp-client's publish-time backstop count identically.
export { X_MAX_POST_LENGTH };

// Greedily packs `units` into runs joined by `joiner`, each run capped at maxLen. A
// unit that alone exceeds maxLen is handed to `splitOversized` for its own finer-grained
// split rather than truncated — nothing here ever silently drops content.
function pack(units: string[], joiner: string, maxLen: number, splitOversized: (unit: string) => string[]): string[] {
  const out: string[] = [];
  let current = '';
  for (const unit of units) {
    const candidate = current ? `${current}${joiner}${unit}` : unit;
    if (xPostLength(candidate) <= maxLen) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    if (xPostLength(unit) <= maxLen) {
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
    // Last resort for a single over-long "word": a hard slice, packed code point by code
    // point by X's weighted length so double-weighted characters still fit.
    const chunks: string[] = [];
    let chunk = '';
    for (const char of word) {
      if (chunk && xPostLength(chunk + char) > maxLen) {
        chunks.push(chunk);
        chunk = '';
      }
      chunk += char;
    }
    if (chunk) chunks.push(chunk);
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
