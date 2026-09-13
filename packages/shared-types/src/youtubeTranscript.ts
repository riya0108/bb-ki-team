import { z } from 'zod';

// Error shape for the MCP fetch_youtube_transcript tool (packages/mcp-servers/youtube-transcript).
// A successful transcript reuses FetchResultSchema (see fetchResult.ts) — a transcript is just
// text extracted from a URL, same as an article or PDF. This covers only the ways that
// extraction can fail without fabricating a transcript.
export const YoutubeTranscriptErrorSchema = z.object({
  videoUrl: z.string().url(),
  reason: z.enum([
    'invalid_url',
    'video_unavailable',
    'no_captions_available',
    'network_error',
    'timeout',
    'parse_error',
  ]),
  message: z.string(),
});
export type YoutubeTranscriptError = z.infer<typeof YoutubeTranscriptErrorSchema>;
