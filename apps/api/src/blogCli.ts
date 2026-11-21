// Command-line entry to the Blog agent, for running it locally with Claude Code
// (CLAUDE_CODE_MODEL) without the dashboard:
//
//   npm run blog:draft -- "Why do Indians still love fixed deposits?" [--type Explainer] [--out article.html]
//     Researches + drafts one article into the human review queue (never publishes),
//     and writes the rendered HTML to --out for a local look.
//
//   npm run blog:reference -- path/to/approved-article.html --label "Four Walls, No Alarm"
//     Registers an editor-approved reference article as a Blog Style Profile sample
//     (measured and abstracted; the text itself is never stored or copied).

import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { ingestStyleReference, runBlogArticle } from '@bb/agent-blog';
import { getContentItem } from '@bb/workflows';

import { closeAppDeps, createAppDeps } from './deps.js';

// Approved reference HTML -> blank-line separated blocks (headings on their own),
// the shape styleMetrics.shapeFromPlainText measures.
function htmlToBlocks(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h1|h2|h3|li|summary|figcaption|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { type: { type: 'string' }, out: { type: 'string' }, label: { type: 'string' }, constraints: { type: 'string' } },
  });
  const deps = createAppDeps();
  const runId = randomUUID();
  try {
    if (command === 'draft') {
      const topic = positionals.join(' ').trim();
      if (!topic) throw new Error('usage: blog:draft -- "<topic>" [--type <article type>] [--out <file.html>]');
      if (!deps.env.claudeCode) deps.logger.warn('CLAUDE_CODE_MODEL is not set: drafting with the free-tier provider chain and feed research only');
      const pkg = await runBlogArticle({
        pool: deps.pool,
        llm: deps.blog?.llm ?? deps.llm,
        fetchTool: deps.fetchTool,
        logger: deps.logger,
        topic,
        userMessage: topic,
        articleType: values.type ?? 'New article',
        constraints: values.constraints ?? null,
        discoveryResearcher: deps.blog?.discoveryResearcher,
        contextBudget: deps.blog?.contextBudget,
        runId,
      });
      const item = await getContentItem(deps.pool, pkg.contentId);
      if (!item) throw new Error(`content item ${pkg.contentId} not found after drafting`);
      const out = values.out ?? `${pkg.slug}.html`;
      await writeFile(out, item.currentText, 'utf8');
      process.stdout.write(
        `${JSON.stringify({ runId, contentId: pkg.contentId, title: pkg.title, status: item.status, qa: pkg.qaStatus, html: out }, null, 2)}\n`,
      );
      return;
    }
    if (command === 'reference') {
      const path = positionals[0];
      if (!path || !values.label) throw new Error('usage: blog:reference -- <file.html|file.txt> --label "<label>"');
      const raw = await readFile(path, 'utf8');
      const text = /<\/(p|h2|html)>/i.test(raw) ? htmlToBlocks(raw) : raw;
      const sample = await ingestStyleReference({
        db: deps.pool,
        llm: deps.blog?.llm ?? deps.llm,
        fetchTool: deps.fetchTool,
        logger: deps.logger,
        runId,
        kind: 'approved_reference',
        label: values.label,
        source: { kind: 'text', text },
      });
      process.stdout.write(`${JSON.stringify({ runId, sampleId: sample.id, label: sample.label, words: sample.metrics.wordCount }, null, 2)}\n`);
      return;
    }
    throw new Error('usage: blogCli <draft|reference> ...');
  } finally {
    await closeAppDeps(deps);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
