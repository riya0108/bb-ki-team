import type Groq from 'groq-sdk';
import { z } from 'zod';

export interface GenerateStructuredParams<S extends z.ZodTypeAny> {
  groq: Groq;
  model: string;
  system: string;
  prompt: string;
  schema: S;
  toolName: string;
  maxTokens?: number;
}

/**
 * Forces the model to respond via a single tool call whose input schema is
 * derived from `schema`, then validates the tool arguments against that same
 * schema. This is the structured-output path for every LLM-assisted pipeline
 * step (relevance clustering, scoring, verification) — the agent never
 * trusts free-text JSON parsing.
 */
export async function generateStructured<S extends z.ZodTypeAny>(
  params: GenerateStructuredParams<S>,
): Promise<z.infer<S>> {
  const { groq, model, system, prompt, schema, toolName, maxTokens = 2048 } = params;

  const parameters = z.toJSONSchema(schema, { target: 'draft-7' });

  const response = await groq.chat.completions.create({
    model,
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
    (call) => call.function.name === toolName,
  );
  if (!toolCall) {
    throw new Error(`LLM did not return a tool call for "${toolName}"`);
  }

  return schema.parse(JSON.parse(toolCall.function.arguments));
}
