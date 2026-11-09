import type { ChatSession, Provider, SessionOptions, Turn, TurnInput } from "./types.js";

// Talks to any server that implements the OpenAI Chat Completions API with function
// calling: OpenAI itself, Ollama (http://localhost:11434/v1), vLLM, LM Studio and others.

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface ChatResponse {
  choices: { message: ChatMessage; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAICompatibleOptions {
  name: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleProvider implements Provider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    this.model = opts.model;
  }

  startSession(session: SessionOptions): ChatSession {
    const { baseUrl, apiKey, model } = this.opts;
    const doFetch = this.opts.fetchImpl ?? fetch;
    const tools = session.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    const messages: ChatMessage[] = [
      { role: "system", content: session.system },
      { role: "user", content: session.prompt },
    ];

    return {
      async next(input?: TurnInput): Promise<Turn> {
        for (const r of input?.results ?? []) {
          messages.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
        }
        if (input?.text) messages.push({ role: "user", content: input.text });
        const res = await doFetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
        });
        if (!res.ok) {
          throw new Error(`${model} request failed: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
        }
        const data = (await res.json()) as ChatResponse;
        const choice = data.choices[0];
        if (!choice) throw new Error(`${model} returned no choices.`);
        const msg = choice.message;
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

        const toolCalls = (msg.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          input: safeJson(c.function.arguments),
        }));
        const stop: Turn["stop"] =
          toolCalls.length > 0
            ? "tool_use"
            : choice.finish_reason === "length"
              ? "max_tokens"
              : choice.finish_reason === "content_filter"
                ? "refusal"
                : "end";
        return {
          text: (msg.content ?? "").trim(),
          toolCalls,
          done: toolCalls.length === 0,
          stop,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
          },
        };
      },
    };
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    // Returned to the model as a tool error by the agent's input validation.
    return { __invalid_json: s };
  }
}
