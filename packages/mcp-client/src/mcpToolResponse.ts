export interface ToolTextContent {
  type: 'text';
  text: string;
}

export function isToolTextContent(value: unknown): value is ToolTextContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

// MCP protocol-level errors (bad tool arguments, unknown tool, etc — raised by the
// SDK's own request validation before a tool's handler ever runs, e.g.
// server/mcp.js's validateToolInput) come back as an ordinary CallToolResult with
// isError: true, but its content text is a raw message string ("MCP error -32602:
// ..."), not the `{"message": "..."}` JSON our own tool handlers deliberately emit
// on a caught error (see e.g. packages/mcp-servers/buffer/src/server.ts's
// errorPayload). Callers must check `isError` and route to this BEFORE attempting to
// JSON.parse the text as a success payload — parsing it unconditionally throws an
// opaque "Unexpected token 'M', \"MCP error \"... is not valid JSON" SyntaxError that
// hides the real (and often actionable, e.g. a 280-character limit) failure reason.
export function toolErrorMessage(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { message?: unknown }).message === 'string'
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    // Not JSON — the raw text (a protocol-level MCP error) IS the message.
  }
  return text;
}
