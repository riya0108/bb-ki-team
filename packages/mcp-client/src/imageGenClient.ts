import type { GeminiImageConfig, Logger, SupabaseStorageConfig } from '@bb/core';
import { createImageGenMcpServer } from '@bb/mcp-image-gen';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { isToolTextContent, toolErrorMessage } from './mcpToolResponse.js';

export class ImageGenToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageGenToolError';
  }
}

export interface GenerateImageRequest {
  prompt: string;
  negativePrompt?: string | undefined;
  aspectRatio: string;
  contentId: string;
  visualId: string;
}

export interface GeneratedImage {
  provider: string;
  model: string;
  generationId: string;
  base64Data: string;
  mimeType: string;
}

export interface StoreVisualAssetRequest {
  path: string;
  base64Data: string;
  mimeType: string;
}

export interface StoredVisualAsset {
  assetPath: string;
  assetUrl: string;
}

export interface ImageGenTool {
  generateImage(request: GenerateImageRequest): Promise<GeneratedImage>;
  storeVisualAsset(request: StoreVisualAssetRequest): Promise<StoredVisualAsset>;
  close(): Promise<void>;
}

// Exposes ONLY generate_image and store_visual_asset — the same per-agent MCP
// tool-scope allowlist principle as createLinkedinMcpClient/createBufferPublishConnector
// (CLAUDE.md). Config is passed directly (not via subprocess env vars) using the
// same in-process InMemoryTransport pattern as bufferClient.ts, so this can be
// constructed with `undefined` config to exercise the "no provider" / "no storage"
// paths without ever touching a real API key.
export function createImageGenMcpClient(
  config: {
    gemini?: GeminiImageConfig | undefined;
    supabaseStorage?: SupabaseStorageConfig | undefined;
  },
  _logger: Logger,
): ImageGenTool {
  const client = new Client({ name: 'bb-agent-visual', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const server = createImageGenMcpServer(config);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      connected = Promise.all([
        client.connect(clientTransport),
        server.connect(serverTransport),
      ]).then(() => undefined);
    }
    return connected;
  }

  async function callTool<T>(name: string, args: object): Promise<T> {
    await ensureConnected();
    const response = await client.callTool({ name, arguments: args as Record<string, unknown> });

    const content = Array.isArray(response.content) ? response.content : [];
    const textContent = content.find(isToolTextContent);
    if (!textContent) {
      throw new ImageGenToolError(`${name} tool returned no text content`);
    }
    if (response.isError) {
      throw new ImageGenToolError(toolErrorMessage(textContent.text));
    }
    return JSON.parse(textContent.text) as T;
  }

  return {
    generateImage: (request) => callTool<GeneratedImage>('generate_image', request),
    storeVisualAsset: (request) => callTool<StoredVisualAsset>('store_visual_asset', request),
    async close(): Promise<void> {
      await client.close();
    },
  };
}
