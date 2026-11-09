import Anthropic from "@anthropic-ai/sdk";
import type { ChatSession, Provider, SessionOptions, ToolResult, Turn } from "./types.js";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Models that accept the server-side refusal fallback ("fallbacks: default").
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    private readonly effort: Effort = "high",
    client?: Anthropic,
  ) {
    // Credentials come from ANTHROPIC_API_KEY (or the other sources the SDK supports).
    this.client = client ?? new Anthropic({ maxRetries: 4 });
  }

  startSession(opts: SessionOptions): ChatSession {
    const client = this.client;
    const model = this.model;
    const effort = this.effort;
    const tools: Anthropic.Beta.Messages.BetaTool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      strict: true,
    }));
    // Mark the last tool so the stable prefix (tools + system) is cached across turns.
    const last = tools[tools.length - 1];
    if (last) last.cache_control = { type: "ephemeral" };

    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
    const useFallback = FALLBACK_MODELS.has(model);

    return {
      async next(results?: ToolResult[]): Promise<Turn> {
        if (results?.length) {
          // All results for one turn go back in a single user message.
          messages.push({
            role: "user",
            content: results.map((r) => ({
              type: "tool_result" as const,
              tool_use_id: r.id,
              content: r.content,
              is_error: r.isError ?? false,
            })),
          });
        }

        const response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
          tools,
          messages,
          thinking: { type: "adaptive" },
          output_config: { effort },
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        });

        // Keep the full content (including thinking blocks) so the next request is valid.
        messages.push({ role: "assistant", content: response.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });

        const text = response.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const toolCalls = response.content
          .filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

        const stop: Turn["stop"] =
          response.stop_reason === "tool_use"
            ? "tool_use"
            : response.stop_reason === "end_turn"
              ? "end"
              : response.stop_reason === "max_tokens"
                ? "max_tokens"
                : response.stop_reason === "refusal"
                  ? "refusal"
                  : "other";

        return {
          text,
          toolCalls: stop === "tool_use" ? toolCalls : [],
          done: stop !== "tool_use",
          stop,
          usage: {
            inputTokens:
              response.usage.input_tokens +
              (response.usage.cache_read_input_tokens ?? 0) +
              (response.usage.cache_creation_input_tokens ?? 0),
            outputTokens: response.usage.output_tokens,
          },
        };
      },
    };
  }
}
