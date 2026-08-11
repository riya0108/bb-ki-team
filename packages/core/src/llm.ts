import OpenAI from 'openai';
import { z } from 'zod';

export interface LlmProviderConfig {
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface GenerateStructuredParams<S extends z.ZodTypeAny> {
  /** Tried in order — see loadLlmProviders() for the default Gemini -> Groq -> OpenRouter chain. */
  providers: LlmProviderConfig[];
  system: string;
  prompt: string;
  schema: S;
  toolName: string;
  maxTokens?: number;
}

const MAX_ATTEMPTS_PER_PROVIDER = 2;

async function attemptOnProvider<S extends z.ZodTypeAny>(
  provider: LlmProviderConfig,
  params: Omit<GenerateStructuredParams<S>, 'providers'>,
): Promise<z.infer<S>> {
  const { system, prompt, schema, toolName, maxTokens = 2048 } = params;
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
  const parameters = z.toJSONSchema(schema, { target: 'draft-7' });

  const response = await client.chat.completions.create({
    model: provider.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: toolName,
          description: `Return structured output for ${toolName}.`,
          parameters,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: toolName } },
  });

  const toolCall = response.choices[0]?.message.tool_calls?.find(
    (call): call is OpenAI.ChatCompletionMessageFunctionToolCall =>
      call.type === 'function' && call.function.name === toolName,
  );
  if (!toolCall) {
    throw new Error(`LLM did not return a tool call for "${toolName}" (provider: ${provider.label})`);
  }

  return schema.parse(JSON.parse(toolCall.function.arguments));
}

/**
 * Forces the model to respond via a single tool call whose input schema is
 * derived from `schema`, then validates the tool arguments against that same
 * schema. This is the structured-output path for every LLM-assisted pipeline
 * step across agents — no agent ever trusts free-text JSON parsing.
 *
 * Tries each configured provider in order, retrying transient failures a
 * couple of times on the same provider before falling through to the next
 * one. This is the fix for repeated "one provider's daily/per-minute quota
 * ran out mid-session" failures observed in development — an exhausted or
 * flaky provider no longer blocks the whole pipeline, since Gemini, Groq,
 * and OpenRouter all expose an OpenAI-compatible /chat/completions endpoint
 * and this is the one client implementation for all of them.
 */
export async function generateStructured<S extends z.ZodTypeAny>(
  params: GenerateStructuredParams<S>,
): Promise<z.infer<S>> {
  if (params.providers.length === 0) {
    throw new Error(`generateStructured("${params.toolName}"): no LLM providers configured`);
  }

  const errors: string[] = [];
  for (const provider of params.providers) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
      try {
        return await attemptOnProvider(provider, params);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.label} attempt ${String(attempt)}: ${message}`);
      }
    }
  }

  throw new Error(
    `generateStructured("${params.toolName}") failed across all providers:\n${errors.join('\n')}`,
  );
}
