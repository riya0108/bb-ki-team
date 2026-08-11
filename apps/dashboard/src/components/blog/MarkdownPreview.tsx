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

function renderBlock(block: string, blockIndex: number): ReactNode {
  const key = `block-${String(blockIndex)}`;

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
 * Renders the writer agent's Markdown output (## / ### headings, **bold**,
 * *italic*, [text](url) links, paragraphs, - bullet lists) as styled prose —
 * the closest a human reviewer gets, without needing the live Astro site
 * running, to seeing the post the way it'll actually look on bullorbear.in.
 */
export function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return <div className={`space-y-4 ${className ?? ''}`}>{blocks.map((block, index) => renderBlock(block, index))}</div>;
}
