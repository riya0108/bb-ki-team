import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Neither agent's MCP subprocess wiring can resolve `tsx`/server entry
 * paths from inside its own module (see packages/agents/research/src/
 * mcpClient.ts and packages/agents/trend-research/src/mcpClient.ts) — the
 * host process must do it. apps/worker is a plain, never-bundled tsx
 * process, so — like apps/dashboard/next.config.ts — it resolves and
 * injects these paths once at startup. Env var names must match each
 * agent's mcpClient.ts exactly.
 *
 * .env itself is loaded via `tsx --env-file=.env` (see root package.json's
 * "worker" script) rather than here: this module is reached only after
 * `@ai-company/db`'s top-level env validation already ran (ESM imports are
 * hoisted above this file's own code), so loading .env from inside this
 * process would already be too late.
 */
export function configureAgentEnv(): void {
  process.env.RESEARCH_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.RESEARCH_AGENT_SEARCH_SERVERS_JSON = JSON.stringify({
    wikipedia: require.resolve('@ai-company/mcp-search-wikipedia'),
    news: require.resolve('@ai-company/mcp-search-news'),
    youtube: require.resolve('@ai-company/mcp-search-youtube'),
  });

  process.env.TREND_RESEARCH_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.TREND_RESEARCH_AGENT_SEARCH_SERVERS_JSON = JSON.stringify({
    wikipedia: require.resolve('@ai-company/mcp-search-wikipedia'),
    news: require.resolve('@ai-company/mcp-search-news'),
    trends: require.resolve('@ai-company/mcp-search-trends'),
    competitor: require.resolve('@ai-company/mcp-search-competitors'),
  });

  process.env.RESEARCH_PACK_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.RESEARCH_PACK_AGENT_SEARCH_SERVERS_JSON = JSON.stringify({
    wikipedia: require.resolve('@ai-company/mcp-search-wikipedia'),
    news: require.resolve('@ai-company/mcp-search-news'),
    youtube: require.resolve('@ai-company/mcp-search-youtube'),
    competitor: require.resolve('@ai-company/mcp-search-competitors'),
    hackernews: require.resolve('@ai-company/mcp-search-hackernews'),
  });

  process.env.BLOG_PUBLISHER_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.BLOG_PUBLISHER_AGENT_SERVER_PATH = require.resolve('@ai-company/mcp-publish-blog-git');

  // Writer connects to the same publish-blog-git server as blog-publisher, but its mcpClient.ts
  // allowlists only the read-only get_style_samples tool — it can never publish.
  process.env.WRITER_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.WRITER_AGENT_SERVER_PATH = require.resolve('@ai-company/mcp-publish-blog-git');

  process.env.BLOG_TOPIC_FINDER_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.BLOG_TOPIC_FINDER_AGENT_SEARCH_SERVERS_JSON = JSON.stringify({
    wikipedia: require.resolve('@ai-company/mcp-search-wikipedia'),
    news: require.resolve('@ai-company/mcp-search-news'),
    youtube: require.resolve('@ai-company/mcp-search-youtube'),
    competitor: require.resolve('@ai-company/mcp-search-competitors'),
    hackernews: require.resolve('@ai-company/mcp-search-hackernews'),
  });
  // blog-topic-finder also connects to publish-blog-git, but its mcpClient.ts allowlists only
  // the read-only list_archive_posts tool — it can never publish.
  process.env.BLOG_TOPIC_FINDER_AGENT_ARCHIVE_SERVER_PATH = require.resolve('@ai-company/mcp-publish-blog-git');

  process.env.YOUTUBE_VIRAL_FINDER_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.YOUTUBE_VIRAL_FINDER_AGENT_SERVER_PATH = require.resolve('@ai-company/mcp-search-youtube');

  process.env.INSTAGRAM_VIRAL_FINDER_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
  process.env.INSTAGRAM_VIRAL_FINDER_AGENT_SERVER_PATH = require.resolve('@ai-company/mcp-search-instagram');

  // content-strategy has no MCP client — see its src/index.ts.
}
