// Unit-aware number extraction (spec 29): "25", "25%", "₹25 lakh" and "25 basis
// points" are not interchangeable, so every quantity carries a normalized value AND
// a unit, and matching requires both.

export type QuantityUnit =
  | 'percent'
  | 'percentage_points'
  | 'bps'
  | 'inr'
  | 'usd'
  | 'year'
  | 'duration_years'
  | 'duration_months'
  | 'duration_days'
  | 'plain';

export interface Quantity {
  raw: string;
  value: number;
  unit: QuantityUnit;
  index: number;
}

const SCALE: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  million: 1e6,
  mn: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
  tn: 1e12,
};

const QUANTITY_PATTERN =
  /(₹|rs\.?\s?|inr\s?|us\$|\$|usd\s?)?(\d[\d,]*(?:\.\d+)?)\s?(thousand|lakhs?|lac|crores?|cr|million|mn|billion|bn|trillion|tn|k|m|b)?\b\s?(%|per\s?cent\b|percent\b|percentage points?\b|pp\b|bps\b|basis points?\b|bp\b|years?\b|months?\b|days?\b)?/gi;

function unitFor(currency: string | undefined, suffix: string | undefined, digits: string): QuantityUnit {
  const cur = currency?.toLowerCase().replace(/[\s.]/g, '');
  if (cur === '₹' || cur === 'rs' || cur === 'inr') return 'inr';
  if (cur === '$' || cur === 'us$' || cur === 'usd') return 'usd';
  const suf = suffix?.toLowerCase().replace(/\s+/g, ' ');
  if (suf) {
    if (suf === '%' || suf.startsWith('per')) return suf.startsWith('percentage') ? 'percentage_points' : 'percent';
    if (suf === 'pp') return 'percentage_points';
    if (suf === 'bps' || suf === 'bp' || suf.startsWith('basis')) return 'bps';
    if (suf.startsWith('year')) return 'duration_years';
    if (suf.startsWith('month')) return 'duration_months';
    if (suf.startsWith('day')) return 'duration_days';
  }
  if (/^(19|20)\d{2}$/.test(digits)) return 'year';
  return 'plain';
}

export function extractQuantities(text: string): Quantity[] {
  const quantities: Quantity[] = [];
  for (const match of text.matchAll(QUANTITY_PATTERN)) {
    const [raw, currency, digits, scaleWord, suffix] = match;
    if (!digits) continue;
    const base = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    // Bare single letters (m/b/k) only count as a scale right after a currency, so
    // "5 m" in prose isn't read as five million.
    const scaleKey = scaleWord?.toLowerCase();
    const scale = scaleKey && (scaleKey.length > 1 || currency) ? (SCALE[scaleKey] ?? 1) : 1;
    quantities.push({
      raw: raw.trim(),
      value: base * scale,
      unit: unitFor(currency, suffix, digits),
      index: match.index,
    });
  }
  return quantities;
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-9;
}

export function quantitiesMatch(a: Quantity, b: Quantity): boolean {
  return a.unit === b.unit && sameValue(a.value, b.value);
}

// A draft quantity is "material" when it's a real figure worth sourcing: anything
// with a unit, or a bare number of 2+ digits (skips "3 reasons").
export function isMaterialQuantity(q: Quantity): boolean {
  return q.unit !== 'plain' || q.value >= 10;
}

export type QuantitySupport = 'supported' | 'unit_mismatch' | 'unsupported';

export function supportFor(q: Quantity, evidence: readonly Quantity[]): QuantitySupport {
  if (evidence.some((e) => quantitiesMatch(q, e))) return 'supported';
  // A bare number is fine if the same value appears with any unit ("by 25" after
  // "25 basis points" was established).
  if (q.unit === 'plain' && evidence.some((e) => sameValue(q.value, e.value))) return 'supported';
  if (evidence.some((e) => sameValue(q.value, e.value) && e.unit !== 'plain')) return 'unit_mismatch';
  return 'unsupported';
}
