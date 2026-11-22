import { type Quantity, quantitiesMatch } from './quantities.js';

// Worked examples ("Assume you put ₹1,00,000 into a one-year FD at 5.61%...") are the
// article's own arithmetic, not sourced statistics. A paragraph that labels itself as
// one opens an illustration span covering it and up to ILLUSTRATION_SPAN short
// follow-on paragraphs (the step-by-step working).

export const ILLUSTRATION_MARKER =
  /\b(illustrative(ly)?|an illustration|for illustration|hypothetical(ly)?|assume|assuming|suppose|imagine|picture|say you|let's say|made-up|worked example)\b/i;
const ILLUSTRATION_SPAN = 3;
const SHORT_PARAGRAPH_WORDS = 60;

export interface TextRange {
  start: number;
  end: number;
}

// Character ranges of the labelled paragraphs and their follow-on working.
export function illustrationRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const separator = /\n\s*\n/g;
  let cursor = 0;
  let remaining = 0;
  const visit = (start: number, end: number): void => {
    const paragraph = text.slice(start, end);
    if (ILLUSTRATION_MARKER.test(paragraph)) {
      remaining = ILLUSTRATION_SPAN;
      ranges.push({ start, end });
    } else if (remaining > 0 && paragraph.split(/\s+/).length <= SHORT_PARAGRAPH_WORDS) {
      remaining -= 1;
      ranges.push({ start, end });
    } else {
      remaining = 0;
    }
  };
  for (const match of text.matchAll(separator)) {
    visit(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  visit(cursor, text.length);
  // Adjacent ranges (one worked example over several paragraphs) are one span.
  return ranges.reduce<TextRange[]>((merged, r) => {
    const last = merged[merged.length - 1];
    if (last && text.slice(last.end, r.start).trim() === '') last.end = r.end;
    else merged.push({ ...r });
    return merged;
  }, []);
}

// A round amount ("₹1,00,000", "₹4 lakh") is an assumed input; "₹1,05,610" is not.
function isRoundInput(q: Quantity): boolean {
  if (q.unit !== 'inr' && q.unit !== 'usd' && q.unit !== 'plain') return false;
  const digits = String(Math.round(Math.abs(q.value))).replace(/0+$/, '');
  return digits.length > 0 && digits.length <= 2;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);
}

// Values reachable in one step from a and b: sum and difference (same unit), "b% of a", and a grown
// or shrunk by b%.
function oneStep(a: Quantity, b: Quantity): number[] {
  const out = a.unit === b.unit ? [a.value + b.value, Math.abs(a.value - b.value)] : [];
  if (b.unit === 'percent') out.push((a.value * b.value) / 100, a.value * (1 + b.value / 100), a.value * (1 - b.value / 100));
  return out;
}

// Of the draft's unsupported quantities, those an illustration span accounts for:
// round assumed inputs, and results of the span's own arithmetic over its supported
// figures and inputs. Percentages are never assumed: a rate in a worked example must
// be sourced (or computed) like any other.
export function illustrativeQuantities(
  text: string,
  quantities: readonly Quantity[],
  isSupported: (q: Quantity) => boolean,
): Set<Quantity> {
  const accounted = new Set<Quantity>();
  for (const range of illustrationRanges(text)) {
    const inSpan = quantities.filter((q) => q.index >= range.start && q.index < range.end);
    const known: Quantity[] = inSpan.filter(isSupported);
    for (const q of inSpan) {
      if (!isSupported(q) && isRoundInput(q)) {
        known.push(q);
        accounted.add(q);
      }
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const q of inSpan) {
        if (accounted.has(q) || isSupported(q)) continue;
        const derivable = known.some((a) =>
          known.some((b) => a !== b && (a.unit === q.unit || a.unit === 'plain') && oneStep(a, b).some((v) => near(v, q.value))),
        );
        if (derivable) {
          known.push(q);
          accounted.add(q);
          grew = true;
        }
      }
    }
    // A repeated figure ("You earn ₹5,610 ... grew by ₹5,610") is the same result.
    for (const q of inSpan) {
      if (!accounted.has(q) && known.some((k) => quantitiesMatch(k, q))) accounted.add(q);
    }
  }
  return accounted;
}
