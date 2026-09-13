import type { LlmClient, LlmMessage } from '@bb/core';
import type { ChatMessage } from '@bb/shared-types';
import type { z } from 'zod';

export interface ClassifyChatIntentInput<T> {
  llm: LlmClient;
  platform: string;
  // Human-readable list of supported actions and their parameters, inserted into
  // the system prompt verbatim. Every actionsSchema this is paired with MUST include
  // an `{ action: 'unsupported', reason: string }` member — the classifier is
  // instructed to use it for anything outside this catalog, so an ambiguous or
  // out-of-scope request degrades to an honest "can't do that yet" rather than the
  // model guessing at parameters for the nearest-sounding action (CLAUDE.md: never
  // fabricate; spec 17.3's context isolation means the agent only acts within its
  // declared capabilities).
  catalogDescription: string;
  actionsSchema: z.ZodType<T>;
  message: string;
  recentHistory: ChatMessage[];
  runId: string;
}

function toLlmMessages(recentHistory: ChatMessage[], message: string): LlmMessage[] {
  const history: LlmMessage[] = recentHistory.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));
  return [...history, { role: 'user', content: message }];
}

export async function classifyChatIntent<T>(input: ClassifyChatIntentInput<T>): Promise<T> {
  const system = [
    `You are the intent classifier for Bull or Bear's ${input.platform} content agent's chat interface.`,
    'A human is typing free-text requests. Map the LATEST user message (using the conversation above it only for reference/context) to exactly one of the following supported actions, and extract its parameters from the message and conversation history.',
    '',
    input.catalogDescription,
    '',
    "If the request doesn't clearly match any of the actions above, or is missing information you cannot infer from the conversation, respond with the 'unsupported' action and a short, honest reason (e.g. naming what capability is missing) — never guess at parameters or invent an action that isn't listed.",
  ].join('\n');

  return input.llm.completeStructured(
    {
      system,
      messages: toLlmMessages(input.recentHistory, input.message),
      runId: input.runId,
      stepId: 'chat-classify-intent',
      temperature: 0,
    },
    input.actionsSchema,
  );
}
