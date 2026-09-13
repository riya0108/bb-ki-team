import type { z } from 'zod';

import type { LlmClient, LlmCompletionInput, LlmCompletionResult } from '../llm.js';

// Test-only utility — never imported by production code. Lets tests script exactly
// what the "model" says without any network call, so agent/QA pipelines are testable
// in isolation per CLAUDE.md.
export type FakeLlmScript = (input: LlmCompletionInput, callIndex: number) => string;

export function createFakeLlmClient(script: FakeLlmScript): LlmClient {
  let callIndex = 0;

  async function complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const text = script(input, callIndex);
    callIndex += 1;
    return Promise.resolve({ text, provider: 'gemini', model: 'fake-model' });
  }

  async function completeStructured<T>(input: LlmCompletionInput, schema: z.ZodType<T>): Promise<T> {
    const result = await complete(input);
    return schema.parse(JSON.parse(result.text));
  }

  return { complete, completeStructured };
}
