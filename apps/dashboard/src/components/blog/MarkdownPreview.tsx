import type { ReactNode } from 'react';

const INLINE_PATTERN = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) nodes.push(text.slice(lastIndex, matchIndex));

    const [, linkText, linkHref, bold, italic] = match;
    if (linkText !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-${String(index)}`}
          href={linkHref}
          target="_blank"
          rel="noreferrer"
          className="text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-500 dark:text-violet-400 dark:decoration-violet-800"
        >
          {linkText}
        </a>,
      );
    } else if (bold !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${String(index)}`}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${String(index)}`}>{italic}</em>);
    }

    lastIndex = matchIndex + match[0].length;
    index += 1;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * The writer agent's SYSTEM_PROMPT (packages/agents/writer/src/pipeline/writeDraft.ts)
 * fixes the heading text for every section but the hook and CONTEXT — list
 * them so a heading run into its own body text on one line (e.g. "##
 * Background The rise...") can be split into "## Background" plus a
 * separate body paragraph. A generic "capitalized words = heading" guess
 * doesn't work here: body sentences routinely open with a capitalized word
 * too ("The causal chain...", "Zepto's advertising...").
 */
const KNOWN_SECTION_HEADINGS = [
  'What People Are Missing',
  'What Happens Next',
  'What Happened',
  'Real-World Impact',
  'The Bottom Line',
  'Background',
  'Stakeholders',
  'Takeaway',
  'Numbers',
  'Why',
];
const KNOWN_HEADING_PATTERN = new RegExp(
  `(#{2,3} (?:${KNOWN_SECTION_HEADINGS.join('|')}))(?=[ \\t])`,
  'g',
);

/**
 * Some providers return the writer agent's `content` field with headings
 * run into the surrounding paragraph instead of on their own blank-line
 * block (e.g. "...in 2024. ## Background The rise..."), so a straight
 * split on blank lines leaves "## Background" sitting as literal text
 * inside one giant paragraph. Force every "## "/"### " marker that isn't
 * already on its own block onto one by inserting a blank line before it,
 * then split the heading label itself off from the body text that follows
 * it on the same line.
 */
function normalizeHeadingBreaks(content: string): string {
  return content
    .replace(/[ \t]?(#{2,3} )/g, '\n\n$1')
    .replace(KNOWN_HEADING_PATTERN, '$1\n\n');
}

/** Drops the writer's MDX import lines (`import PostPoll from "...";`) — nothing to render. */
function stripImportLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*import\s+\w+\s+from\s+["'][^"']+["'];?\s*$/.test(line))
    .join('\n');
}

/** Best-effort tag stripper for raw HTML this preview doesn't specially render (tables, images, wrapper divs). */
function stripHtmlKeepText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unescapeQuotes(value: string): string {
  return value.replace(/\\"/g, '"');
}

/** Parses `key="value"` pairs out of a JSX-ish attribute string (skips `key={...}` expression props). */
function parseStringAttrs(attrs: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of attrs.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
    result[m[1]] = unescapeQuotes(m[2]);
  }
  return result;
}

function parseStringArrayAttr(attrs: string, name: string): string[] {
  const match = new RegExp(`${name}=\\{(\\[[\\s\\S]*?\\])\\}`).exec(attrs);
  if (!match) return [];
  return [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unescapeQuotes(m[1]));
}

function parseObjectArrayAttr(attrs: string, name: string): Record<string, string>[] {
  const match = new RegExp(`${name}=\\{(\\[[\\s\\S]*?\\])\\}`).exec(attrs);
  if (!match) return [];
  const objects = match[1].match(/\{[^{}]*\}/g) ?? [];
  return objects.map((obj) => {
    const entry: Record<string, string> = {};
    for (const m of obj.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)) {
      entry[m[1]] = unescapeQuotes(m[2]);
    }
    return entry;
  });
}

function PollPreview({ attrs, keyPrefix }: { attrs: string; keyPrefix: string }) {
  const { label = 'Quick poll', question = '' } = parseStringAttrs(attrs);
  const options = parseStringArrayAttr(attrs, 'options');
  return (
    <div key={keyPrefix} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
      <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
        {label}
      </p>
      <p className="mt-2 font-semibold text-neutral-900 dark:text-white">{question}</p>
      <div className="mt-3 grid gap-1.5">
        {options.map((opt, i) => (
          <div
            key={`${keyPrefix}-opt-${String(i)}`}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {opt}
          </div>
        ))}
      </div>
    </div>
  );
}

function SwipeCardsPreview({ attrs, keyPrefix }: { attrs: string; keyPrefix: string }) {
  const { heading = '1 min read' } = parseStringAttrs(attrs);
  const items = parseObjectArrayAttr(attrs, 'items');
  return (
    <div key={keyPrefix} className="space-y-2">
      <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
        {heading}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item, i) => (
          <div
            key={`${keyPrefix}-card-${String(i)}`}
            className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
          >
            <span className="inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:bg-neutral-900 dark:text-violet-400">
              {item.label}
            </span>
            <p className="mt-2 text-sm font-semibold text-neutral-900 dark:text-white">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const TONE_DOT: Record<string, string> = {
  peak: 'bg-emerald-500',
  low: 'bg-red-500',
  now: 'bg-violet-500',
  default: 'bg-neutral-400',
};

function TimelinePreview({ attrs, keyPrefix }: { attrs: string; keyPrefix: string }) {
  const { heading } = parseStringAttrs(attrs);
  const items = parseObjectArrayAttr(attrs, 'items');
  return (
    <div key={keyPrefix} className="space-y-3">
      {heading && (
        <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
          {heading}
        </p>
      )}
      <div className="space-y-3 border-l-2 border-neutral-200 pl-4 dark:border-neutral-800">
        {items.map((item, i) => (
          <div key={`${keyPrefix}-tl-${String(i)}`} className="relative">
            <span
              className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${TONE_DOT[item.tone ?? 'default'] ?? TONE_DOT.default}`}
            />
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{item.period}</p>
            {item.label && <p className="text-sm font-bold text-neutral-900 dark:text-white">{item.label}</p>}
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">{item.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatGridPreview({ attrs, keyPrefix }: { attrs: string; keyPrefix: string }) {
  const { heading } = parseStringAttrs(attrs);
  const stats = parseObjectArrayAttr(attrs, 'stats');
  return (
    <div key={keyPrefix} className="space-y-2">
      {heading && (
        <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
          {heading}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat, i) => (
          <div
            key={`${keyPrefix}-stat-${String(i)}`}
            className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40"
          >
            <p className="text-lg font-extrabold text-neutral-900 dark:text-white">{stat.value}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const CALLOUT_BORDER: Record<string, string> = {
  info: 'border-neutral-300 dark:border-neutral-700',
  success: 'border-emerald-500',
  warning: 'border-amber-500',
  danger: 'border-red-500',
  quote: 'border-violet-500',
};

function CalloutPreview({
  attrs,
  innerHtml,
  keyPrefix,
}: {
  attrs: string;
  innerHtml: string;
  keyPrefix: string;
}) {
  const { variant = 'info', title, source } = parseStringAttrs(attrs);
  const border = CALLOUT_BORDER[variant] ?? CALLOUT_BORDER.info;
  const text = stripHtmlKeepText(innerHtml);
  return (
    <div key={keyPrefix} className={`rounded-xl border-l-4 bg-neutral-50 p-4 dark:bg-neutral-900/40 ${border}`}>
      {title && <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{title}</p>}
      <p className={`text-sm text-neutral-700 dark:text-neutral-300 ${variant === 'quote' ? 'italic' : title ? 'mt-1.5' : ''}`}>
        {text}
      </p>
      {source && <p className="mt-2 text-xs font-bold text-violet-600 dark:text-violet-400">— {source}</p>}
    </div>
  );
}

function CtaPreview({ attrs, keyPrefix }: { attrs: string; keyPrefix: string }) {
  const {
    heading = 'Enjoyed this one?',
    text = 'Read more from the archive.',
    buttonText = 'Read My Previous Blogs',
  } = parseStringAttrs(attrs);
  return (
    <div key={keyPrefix} className="rounded-2xl bg-neutral-900 p-6 text-center dark:bg-neutral-950">
      <p className="font-bold text-white">{heading}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-400">{text}</p>
      <span className="mt-4 inline-block rounded-full bg-violet-600 px-5 py-2 text-xs font-bold text-white">
        {buttonText} →
      </span>
    </div>
  );
}

/**
 * Matches the writer's known rich MDX components (packages/agents/writer's
 * RICH COMPONENTS prompt section / apps' src/components/Post*.astro) —
 * PostCallout has children so it needs an open/close match; the rest are
 * self-closing.
 */
const COMPONENT_PATTERN =
  /<PostCallout\b([^>]*)>([\s\S]*?)<\/PostCallout>|<Post(Poll|SwipeCards|Timeline|StatGrid|CTA)\b([^>]*?)\/>/g;

function renderRichBlock(block: string, blockIndex: number): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of block.matchAll(COMPONENT_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      const gapText = stripHtmlKeepText(block.slice(lastIndex, start));
      if (gapText) {
        nodes.push(
          <p key={`block-${String(blockIndex)}-gap-${String(matchIndex)}`} className="leading-relaxed text-neutral-700 dark:text-neutral-300">
            {gapText}
          </p>,
        );
      }
    }

    const keyPrefix = `block-${String(blockIndex)}-comp-${String(matchIndex)}`;
    const [, calloutAttrs, calloutChildren, selfClosingName, selfClosingAttrs] = match;
    if (calloutAttrs !== undefined) {
      nodes.push(<CalloutPreview key={keyPrefix} attrs={calloutAttrs} innerHtml={calloutChildren ?? ''} keyPrefix={keyPrefix} />);
    } else if (selfClosingName === 'Poll') {
      nodes.push(<PollPreview key={keyPrefix} attrs={selfClosingAttrs ?? ''} keyPrefix={keyPrefix} />);
    } else if (selfClosingName === 'SwipeCards') {
      nodes.push(<SwipeCardsPreview key={keyPrefix} attrs={selfClosingAttrs ?? ''} keyPrefix={keyPrefix} />);
    } else if (selfClosingName === 'Timeline') {
      nodes.push(<TimelinePreview key={keyPrefix} attrs={selfClosingAttrs ?? ''} keyPrefix={keyPrefix} />);
    } else if (selfClosingName === 'StatGrid') {
      nodes.push(<StatGridPreview key={keyPrefix} attrs={selfClosingAttrs ?? ''} keyPrefix={keyPrefix} />);
    } else if (selfClosingName === 'CTA') {
      nodes.push(<CtaPreview key={keyPrefix} attrs={selfClosingAttrs ?? ''} keyPrefix={keyPrefix} />);
    }

    lastIndex = start + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < block.length) {
    const tailText = stripHtmlKeepText(block.slice(lastIndex));
    if (tailText) {
      nodes.push(
        <p key={`block-${String(blockIndex)}-tail`} className="leading-relaxed text-neutral-700 dark:text-neutral-300">
          {tailText}
        </p>,
      );
    }
  }

  return (
    <div key={`block-${String(blockIndex)}`} className="space-y-3">
      {nodes}
    </div>
  );
}

function renderBlock(block: string, blockIndex: number): ReactNode {
  const key = `block-${String(blockIndex)}`;

  if (COMPONENT_PATTERN.test(block)) {
    COMPONENT_PATTERN.lastIndex = 0;
    return renderRichBlock(block, blockIndex);
  }

  if (block.startsWith('### ')) {
    return (
      <h3 key={key} className="mt-6 text-lg font-semibold text-neutral-900 dark:text-white">
        {renderInline(block.slice(4), key)}
      </h3>
    );
  }
  if (block.startsWith('## ')) {
    return (
      <h2 key={key} className="mt-8 text-xl font-semibold text-neutral-900 dark:text-white">
        {renderInline(block.slice(3), key)}
      </h2>
    );
  }

  // Raw HTML this preview doesn't specially render (tables, images, wrapper divs) — keep the
  // visible text readable rather than showing literal angle-bracket markup.
  if (/^<[a-z]/i.test(block)) {
    const text = stripHtmlKeepText(block);
    return text ? (
      <p key={key} className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-500">
        {text}
      </p>
    ) : null;
  }

  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const isList = lines.length > 0 && lines.every((line) => line.startsWith('- ') || line.startsWith('* '));
  if (isList) {
    return (
      <ul key={key} className="list-disc space-y-1.5 pl-5 text-neutral-700 dark:text-neutral-300">
        {lines.map((line, lineIndex) => (
          <li key={`${key}-${String(lineIndex)}`}>{renderInline(line.slice(2), `${key}-${String(lineIndex)}`)}</li>
        ))}
      </ul>
    );
  }

  return (
    <p key={key} className="leading-relaxed text-neutral-700 dark:text-neutral-300">
      {renderInline(lines.join(' '), key)}
    </p>
  );
}

/**
 * Renders the writer agent's MDX output (## / ### headings, **bold**, *italic*,
 * [text](url) links, paragraphs, - bullet lists, plus the six PostPoll/
 * PostSwipeCards/PostTimeline/PostStatGrid/PostCallout/PostCTA rich
 * components) as styled prose — the closest a human reviewer gets, without
 * needing the live Astro site running, to seeing the post the way it'll
 * actually look on bullorbear.in.
 */
export function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  const blocks = normalizeHeadingBreaks(stripImportLines(content))
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return <div className={`space-y-4 ${className ?? ''}`}>{blocks.map((block, index) => renderBlock(block, index))}</div>;
}
