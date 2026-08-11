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

export type ProviderStage =
  | "analysis"
  | "comparison"
  | "devils_advocate"
  | "reassessment"
  | "judge"
  | "understanding"
  | "direct_answer";

/**
 * Per-stage model routing (Part 21): a stage can be pinned to a different
 * model via COUNCIL_MODEL_<STAGE> env vars (e.g. a cheap model for analysis,
 * a stronger one for the Judge). Falls back to the default provider when no
 * override is configured. No complex paid routing — just the seam for it.
 */
const STAGE_MODEL_ENV: Record<ProviderStage, string> = {
  analysis: "COUNCIL_MODEL_ANALYSIS",
  comparison: "COUNCIL_MODEL_COMPARISON",
  devils_advocate: "COUNCIL_MODEL_DEVILS_ADVOCATE",
  reassessment: "COUNCIL_MODEL_REASSESSMENT",
  judge: "COUNCIL_MODEL_JUDGE",
  understanding: "COUNCIL_MODEL_UNDERSTANDING",
  direct_answer: "COUNCIL_MODEL_DIRECT",
};

export function resolveProviderForStage(stage: ProviderStage): ModelProvider {
  const base = resolveProvider();
  const modelEnv = STAGE_MODEL_ENV[stage];
  const model = modelEnv ? process.env[modelEnv] : undefined;
  if (model && base.withModel) return base.withModel(model);
  return base;
}

export function describeProvider(provider: ModelProvider): { provider: string; model: string } {
  return { provider: provider.id, model: provider.model };
}

/**
 * V0.2.2.2: classify a provider error as a TIMEOUT vs a generic failure so the
 * session can attribute per-member outcomes (Part 10). Provider calls carry an
 * internal timeout that aborts the fetch — those aborts surface as timeout
 * errors. The caller's own abort signal is checked separately (a user cancel
 * is NOT a timeout).
 */
export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("deadline") ||
    m.includes("abort") ||
    m.includes("the operation was aborted")
  );
}

export type { ModelProvider, ProviderChatInput, ProviderChatResult } from "./types";
