import { z } from 'zod';

// Output of the MCP fetch_url tool (packages/mcp-servers/fetch). A fetch that fails
// (network error, timeout, unsupported content type, non-2xx) never fabricates
// content here — the caller must handle FetchResult being absent/errored explicitly.
export const FetchResultSchema = z.object({
  sourceUrl: z.string().url(),
  contentType: z.string(),
  title: z.string().nullable(),
  text: z.string(),
  truncated: z.boolean(),
  fetchedAt: z.string().datetime(),
});
export type FetchResult = z.infer<typeof FetchResultSchema>;

export const FetchErrorSchema = z.object({
  sourceUrl: z.string().url(),
  reason: z.enum(['network_error', 'timeout', 'unsupported_content_type', 'non_2xx', 'too_large']),
  message: z.string(),
});
export type FetchError = z.infer<typeof FetchErrorSchema>;
