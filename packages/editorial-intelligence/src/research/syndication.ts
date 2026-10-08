import type { ResearchDocument } from './researchStory.js';

// Spec 28: five outlets running the same wire story are one confirmation, not five.
// Two full documents are treated as the same report when most of the shorter one's
// word 8-grams also occur in the other (syndicated/copied text), or when one credits a
// wire agency whose own report is also in the dossier and their text overlaps
// substantially. Deterministic and deliberately conservative: it only merges, so it
// can lower a claim's independent-source count, never raise it.

const SHINGLE_SIZE = 8;
const MIN_WORDS = 40;
const COPY_CONTAINMENT = 0.5;
const WIRE_CONTAINMENT = 0.25;

const WIRE_CREDITS: { pattern: RegExp; publisher: RegExp }[] = [
  { pattern: /\(reuters\)|\breuters\s*[-–—]|\bby reuters\b|\bsource:\s*reuters\b/i, publisher: /reuters/i },
  { pattern: /\(ap\)|\bassociated press\b/i, publisher: /associated press|ap news|apnews/i },
  { pattern: /\(pti\)|\bpti\s*[-–—]|\bpress trust of india\b/i, publisher: /press trust of india|\bpti\b/i },
  { pattern: /\(ians\)|\bians\s*[-–—]/i, publisher: /\bians\b/i },
  { pattern: /\(ani\)|\bani\s*[-–—]/i, publisher: /\bani\b/i },
  { pattern: /\(bloomberg\)|\bbloomberg news\b/i, publisher: /bloomberg/i },
];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9₹$%.\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function shingles(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= w.length; i += 1) out.add(w.slice(i, i + SHINGLE_SIZE).join(' '));
  return out;
}

// Share of the smaller document's shingles that also appear in the larger one.
export function shingleContainment(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const s of small) if (large.has(s)) shared += 1;
  return shared / small.size;
}

function creditedWire(doc: ResearchDocument): RegExp | null {
  return WIRE_CREDITS.find((w) => w.pattern.test(doc.text.slice(0, 4000)))?.publisher ?? null;
}

function isFullDocument(doc: ResearchDocument): boolean {
  return doc.source.kind !== 'news_search_result' && words(doc.text).length >= MIN_WORDS;
}

// Returns groups (size >= 2) of document IDs that are the same underlying report.
export function detectSyndicatedGroups(documents: readonly ResearchDocument[]): string[][] {
  const full = documents.filter(isFullDocument);
  const parent = new Map(full.map((d) => [d.source.id, d.source.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < full.length; i += 1) {
    for (let j = i + 1; j < full.length; j += 1) {
      const a = full[i];
      const b = full[j];
      if (!a || !b) continue;
      const containment = shingleContainment(a.text, b.text);
      if (containment >= COPY_CONTAINMENT) {
        union(a.source.id, b.source.id);
        continue;
      }
      const wireA = creditedWire(a);
      const wireB = creditedWire(b);
      const aIsWire = wireB?.test(a.source.publisher ?? a.source.url ?? '');
      const bIsWire = wireA?.test(b.source.publisher ?? b.source.url ?? '');
      if ((aIsWire === true || bIsWire === true) && containment >= WIRE_CONTAINMENT) union(a.source.id, b.source.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const d of full) {
    const root = find(d.source.id);
    groups.set(root, [...(groups.get(root) ?? []), d.source.id]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// Maps every document ID to an "independent report" key: its syndication group's
// first member, else its publisher (else URL/ID). Used to count confirmations.
export function independenceKeys(documents: readonly ResearchDocument[]): Map<string, string> {
  const groups = detectSyndicatedGroups(documents);
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g) groupOf.set(id, `group:${g[0] ?? id}`);
  return new Map(
    documents.map((d) => [d.source.id, groupOf.get(d.source.id) ?? d.source.publisher ?? d.source.url ?? d.source.id]),
  );
}
