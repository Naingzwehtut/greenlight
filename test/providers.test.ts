import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { createProvider } from "../src/providers/index.js";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.js";
import type { ToolSpec } from "../src/providers/types.js";

const tool: ToolSpec = {
  name: "read_file",
  description: "Read a file",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
};

describe("AnthropicProvider", () => {
  it("keeps the full assistant content and sends tool results in one message", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "Reading." },
          { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "a.ts" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Done." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    const session = new AnthropicProvider("claude-opus-5-5", "high", client).startSession({
      system: "sys",
      prompt: "fix it",
      tools: [tool],
    });

    const t1 = await session.next();
    expect(t1).toMatchObject({ text: "Reading.", stop: "tool_use", done: false, usage: { inputTokens: 150, outputTokens: 20 } });
    expect(t1.toolCalls).toEqual([{ id: "tu_1", name: "read_file", input: { path: "a.ts" } }]);

    const firstRequest = create.mock.calls[0]![0];
    expect(firstRequest).toMatchObject({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      fallbacks: "default",
    });
    expect(firstRequest.tools[0]).toMatchObject({ name: "read_file", strict: true, cache_control: { type: "ephemeral" } });

    const t2 = await session.next({ results: [{ id: "tu_1", content: "file body" }], text: "Remember to finish." });
    expect(t2).toMatchObject({ text: "Done.", done: true, stop: "end" });

    // The provider keeps one history array, so it also holds the latest assistant turn now.
    const messages = create.mock.calls[1]![0].messages;
    expect(messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[1].content[0]).toMatchObject({ type: "thinking", signature: "sig" });
    expect(messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: "file body", is_error: false },
      { type: "text", text: "Remember to finish." },
    ]);
  });

  it("reports refusals", async () => {
    const create = vi.fn().mockResolvedValue({ content: [], stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 0 } });
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    const t = await new AnthropicProvider("claude-opus-5-5", "high", client).startSession({ system: "", prompt: "x", tools: [tool] }).next();
    expect(t).toMatchObject({ stop: "refusal", done: true });
  });
});

describe("OpenAICompatibleProvider", () => {
  it("maps function calls and tool messages", async () => {
    const bodies: any[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      const message =
        bodies.length === 1
          ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] }
          : { role: "assistant", content: "All good." };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: bodies.length === 1 ? "tool_calls" : "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
    }) as unknown as typeof fetch;

    const p = new OpenAICompatibleProvider({ name: "ollama", model: "qwen3-coder", baseUrl: "http://localhost:11434/v1/", fetchImpl });
    const s = p.startSession({ system: "sys", prompt: "go", tools: [tool] });
    const t1 = await s.next();
    expect(t1.toolCalls).toEqual([{ id: "c1", name: "read_file", input: { path: "a.ts" } }]);
    const t2 = await s.next({ results: [{ id: "c1", content: "oops", isError: true }] });
    expect(t2).toMatchObject({ text: "All good.", done: true, usage: { inputTokens: 7, outputTokens: 3 } });
    expect((fetchImpl as any).mock.calls[0][0]).toBe("http://localhost:11434/v1/chat/completions");
    expect(bodies[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: "ERROR: oops" });
    expect(bodies[0].tools[0].function.name).toBe("read_file");
  });
});

describe("createProvider", () => {
  const cfg = loadConfig("/nonexistent-dir");
  it("requires an API key for hosted providers", () => {
    expect(() => createProvider(cfg, {})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createProvider({ ...cfg, provider: "openai" }, {})).toThrow(/OPENAI_API_KEY/);
  });
  it("needs no key for ollama", () => {
    expect(createProvider({ ...cfg, provider: "ollama" }, {}).model).toBe("qwen3-coder");
  });
});
