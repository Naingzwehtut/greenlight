// A small, provider-neutral view of a tool-using chat. Each provider keeps its own
// native message history internally, so nothing provider-specific (such as thinking
// blocks) is lost when the conversation is sent back.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Turn {
  /** Text the model wrote this turn (its explanation or final answer). */
  text: string;
  toolCalls: ToolCall[];
  /** True when the model finished without asking for tools. */
  done: boolean;
  /** Normalised reason the turn ended. */
  stop: "end" | "tool_use" | "max_tokens" | "refusal" | "other";
  usage: Usage;
}

export interface TurnInput {
  /** Results for every tool call of the previous turn. */
  results?: ToolResult[];
  /** A plain user message, e.g. a reminder when the model stopped without a report. */
  text?: string;
}

export interface ChatSession {
  /** Send the input for this turn (nothing on the first call) and get the model's next turn. */
  next(input?: TurnInput): Promise<Turn>;
}

export interface SessionOptions {
  system: string;
  prompt: string;
  tools: ToolSpec[];
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  startSession(opts: SessionOptions): ChatSession;
}
