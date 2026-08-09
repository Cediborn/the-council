import { OllamaProvider } from "./ollama";
import { OpenAiProvider } from "./openai";
import type { ModelProvider } from "./types";

/**
 * Model router — resolves the active provider from environment variables.
 *
 * Priority (respecting COUNCIL_PROVIDER when set):
 *   1. COUNCIL_PROVIDER env override
 *   2. A cloud key that is actually present (openrouter / openai / deepseek / groq)
 *   3. Local Ollama (always available — free, no key)
 *
 * Keys are read server-side only. If nothing is configured we still fall back
 * to Ollama so the app is usable out of the box.
 */

const DEFAULTS = {
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5:3b",
};

function envUrl(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function buildOllama(): ModelProvider {
  return new OllamaProvider({
    url: DEFAULTS.ollamaUrl,
    model: DEFAULTS.ollamaModel,
  });
}

function buildOpenAi(id: string, baseUrl: string, key: string | undefined, model: string | undefined): ModelProvider | null {
  if (!key || !model) return null;
  return new OpenAiProvider(id, { baseUrl, apiKey: key, model });
}

export function resolveProvider(): ModelProvider {
  const preference = process.env.COUNCIL_PROVIDER?.toLowerCase();

  const openrouter = buildOpenAi(
    "openrouter",
    envUrl("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_MODEL,
  );
  const openai = buildOpenAi(
    "openai",
    envUrl("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_MODEL,
  );

  if (preference) {
    if (preference === "ollama") return buildOllama();
    if (preference === "openrouter" && openrouter) return openrouter;
    if (preference === "openai" && openai) return openai;
    // Fall through: preference named a provider that isn't configured.
  }

  // Auto-detect: prefer a configured cloud key, else Ollama.
  if (openrouter) return openrouter;
  if (openai) return openai;

  return buildOllama();
}

export function describeProvider(provider: ModelProvider): { provider: string; model: string } {
  return { provider: provider.id, model: provider.model };
}

export type { ModelProvider, ProviderChatInput, ProviderChatResult } from "./types";
