import { resolveModel, type Config } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { Provider } from "./types.js";

export * from "./types.js";

export function createProvider(cfg: Config, env: NodeJS.ProcessEnv = process.env): Provider {
  const model = resolveModel(cfg);
  switch (cfg.provider) {
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
        throw new Error("Set the ANTHROPIC_API_KEY secret to use the anthropic provider.");
      }
      return new AnthropicProvider(model, cfg.effort);
    case "openai":
      if (!env.OPENAI_API_KEY) throw new Error("Set the OPENAI_API_KEY secret to use the openai provider.");
      return new OpenAICompatibleProvider({
        name: "openai",
        model,
        baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: env.OPENAI_API_KEY,
      });
    case "ollama":
      return new OpenAICompatibleProvider({
        name: "ollama",
        model,
        baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      });
  }
}
