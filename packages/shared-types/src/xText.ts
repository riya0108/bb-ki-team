// X's own character counting (twitter-text v3 weighting), shared by drafting
// (packages/agents/x) and the publish-time backstop (packages/mcp-client) so the two
// can never disagree about whether a post fits. A plain `text.length` undercounts:
// X weighs characters above U+10FF (outside Latin, Greek, Cyrillic, Indic scripts and
// a few punctuation blocks) as 2, so "₹" and "→" each cost two of the 280, every emoji
// costs two, and any URL costs a flat 23 however long it is.

export const X_MAX_POST_LENGTH = 280;

const URL_LENGTH = 23;
const URL = /\bhttps?:\/\/[^\s]+/gi;
// One emoji, including skin-tone modifiers, variation selectors and ZWJ sequences.
const EMOJI = /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

// Code-point ranges X counts as weight 1; everything else is weight 2.
const LIGHT_RANGES: readonly (readonly [number, number])[] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

function weightOf(codePoint: number): number {
  return LIGHT_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi) ? 1 : 2;
}

export function xPostLength(text: string): number {
  let length = 0;
  const rest = text
    .normalize('NFC')
    .replace(URL, () => {
      length += URL_LENGTH;
      return '';
    })
    .replace(EMOJI, () => {
      length += 2;
      return '';
    });
  for (const char of rest) length += weightOf(char.codePointAt(0) ?? 0);
  return length;
}

export function fitsXPost(text: string): boolean {
  return xPostLength(text) <= X_MAX_POST_LENGTH;
}
