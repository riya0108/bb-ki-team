import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { generateImageWithGemini } from './geminiImage.js';
import type { GeminiImageConfig } from './geminiImage.js';
import { signAssetInSupabase, storeVisualAssetInSupabase } from './supabaseStorage.js';
import type { SupabaseStorageConfig } from './supabaseStorage.js';

export interface ImageGenMcpServerDeps {
  gemini?: GeminiImageConfig | undefined;
  supabaseStorage?: SupabaseStorageConfig | undefined;
}

function errorPayload(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}

// Two independent tools rather than one combined "generate and store" call, so a
// caller (packages/agents/visual) can run visual QA against the raw bytes before
// deciding whether to persist them at all — a rejected/failed generation should
// never be uploaded to storage in the first place.
export function createImageGenMcpServer(deps: ImageGenMcpServerDeps): McpServer {
  const server = new McpServer({ name: 'bb-mcp-image-gen', version: '0.1.0' });

  server.registerTool(
    'generate_image',
    {
      description:
        'Generate one image from a text prompt via the configured provider (Gemini image ' +
        'generation). Returns base64 image bytes — this tool never publishes or stores ' +
        'anything, and never fabricates a successful result: if no provider is configured or ' +
        'the provider call fails, it returns an explicit error.',
      inputSchema: {
        prompt: z.string().min(1),
        negativePrompt: z.string().optional(),
        aspectRatio: z.string().min(1),
        contentId: z.string().min(1),
        visualId: z.string().min(1),
      },
    },
    async (request) => {
      if (!deps.gemini) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ message: 'no image provider is configured' }) },
          ],
          isError: true,
        };
      }
      try {
        const outcome = await generateImageWithGemini(deps.gemini, request);
        if (!outcome.ok) {
          return {
            content: [{ type: 'text', text: JSON.stringify(outcome.error) }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(outcome.result) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'store_visual_asset',
    {
      description:
        'Upload previously generated image bytes to the configured Supabase Storage bucket ' +
        'and return a signed URL. Never called for content that failed visual QA.',
      inputSchema: {
        path: z.string().min(1),
        base64Data: z.string().min(1),
        mimeType: z.string().min(1),
      },
    },
    async (request) => {
      if (!deps.supabaseStorage) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ message: 'no asset storage is configured' }) },
          ],
          isError: true,
        };
      }
      try {
        const outcome = await storeVisualAssetInSupabase(deps.supabaseStorage, request);
        if (!outcome.ok) {
          return {
            content: [{ type: 'text', text: JSON.stringify(outcome.error) }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(outcome.result) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'sign_asset',
    {
      description:
        'Re-sign an already-uploaded Supabase Storage path without re-uploading. For assets read ' +
        'long after their original signed URL (from upload time) may have expired — e.g. the ' +
        'reusable visual reference library.',
      inputSchema: {
        path: z.string().min(1),
        expirySeconds: z.number().int().positive().optional(),
      },
    },
    async (request) => {
      if (!deps.supabaseStorage) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ message: 'no asset storage is configured' }) },
          ],
          isError: true,
        };
      }
      try {
        const outcome = await signAssetInSupabase(
          deps.supabaseStorage,
          request.path,
          request.expirySeconds,
        );
        if (!outcome.ok) {
          return {
            content: [{ type: 'text', text: JSON.stringify(outcome.error) }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ assetUrl: outcome.assetUrl }) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
          isError: true,
        };
      }
    },
  );

  return server;
}
