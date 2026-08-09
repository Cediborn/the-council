/**
 * Model provider abstraction.
 *
 *   agent  →  model router  →  configured provider (ollama | openai-compatible | …)
 *
 * Providers are plain fetch clients. Nothing in the orchestration layer knows
 * about a specific vendor, so future support for free/paid/local models and
 * per-agent routing slots in without touching the engine.
 *
 * Security rule: providers are SERVER-ONLY. Never import these into client
 * components, and never ship keys to the browser.
 */

export interface ProviderChatInput {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderChatResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  chat(input: ProviderChatInput): Promise<ProviderChatResult>;
}
