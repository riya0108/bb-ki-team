import { createFakeLlmClient } from '@bb/core/testing';
import type { ChatMessage } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { classifyChatIntent } from './classifyIntent.js';

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draft_topic'), topic: z.string() }),
  z.object({ action: z.literal('unsupported'), reason: z.string() }),
]);

describe('classifyChatIntent', () => {
  it('parses the LLM output against the provided action schema', async () => {
    const llm = createFakeLlmClient(() => JSON.stringify({ action: 'draft_topic', topic: 'UPI adoption' }));

    const result = await classifyChatIntent({
      llm,
      platform: 'linkedin',
      catalogDescription: "- draft_topic { topic: string }: draft a post about a given topic.",
      actionsSchema: ActionSchema,
      message: 'Write me a post about UPI adoption',
      recentHistory: [],
      runId: 'test-run',
    });

    expect(result).toEqual({ action: 'draft_topic', topic: 'UPI adoption' });
  });

  it('falls back to unsupported when the model cannot map the request', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({ action: 'unsupported', reason: 'No matching action for this request.' }),
    );

    const result = await classifyChatIntent({
      llm,
      platform: 'linkedin',
      catalogDescription: "- draft_topic { topic: string }: draft a post about a given topic.",
      actionsSchema: ActionSchema,
      message: 'Turn this carousel into a Reel',
      recentHistory: [],
      runId: 'test-run',
    });

    expect(result).toEqual({ action: 'unsupported', reason: 'No matching action for this request.' });
  });

  it('includes recent chat history as prior conversation turns', async () => {
    let capturedMessages: unknown;
    const llm = createFakeLlmClient((input) => {
      capturedMessages = input.messages;
      return JSON.stringify({ action: 'unsupported', reason: 'n/a' });
    });
    const history: ChatMessage[] = [
      { id: '00000000-0000-0000-0000-000000000001', sessionId: '00000000-0000-0000-0000-0000000000f1', platform: 'linkedin', role: 'user', content: 'hi', action: null, createdAt: new Date().toISOString() },
      { id: '00000000-0000-0000-0000-000000000002', sessionId: '00000000-0000-0000-0000-0000000000f1', platform: 'linkedin', role: 'assistant', content: 'hello', action: null, createdAt: new Date().toISOString() },
    ];

    await classifyChatIntent({
      llm,
      platform: 'linkedin',
      catalogDescription: 'n/a',
      actionsSchema: ActionSchema,
      message: 'follow up message',
      recentHistory: history,
      runId: 'test-run',
    });

    expect(capturedMessages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'follow up message' },
    ]);
  });
});
