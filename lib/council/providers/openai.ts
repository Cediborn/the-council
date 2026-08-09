import type { ModelProvider, ProviderChatInput, ProviderChatResult } from "./types";

/**
 * OpenAI-compatible chat provider.
 * Works for OpenAI, OpenRouter, Groq, DeepSeek, and others that expose the
 * /v1/chat/completions shape. Enabled only when an API key is configured —
 * the key lives in a server-side env var and is never shipped to the client.
 */

export interface OpenAiConfig {
  /** e.g. "https://api.openai.com/v1" or "https://openrouter.ai/api/v1" */
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class OpenAiProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(id: string, config: OpenAiConfig) {
    this.id = id;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const onOuterAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onOuterAbort);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          temperature: input.temperature ?? 0.6,
          max_tokens: input.maxTokens ?? 1500,
          // Ask the provider for a JSON object response where supported;
          // harmless for providers that ignore it.
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${this.id} HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      const data = (await res.json()) as OpenAiChatResponse;

      if (data.error?.message) {
        throw new Error(`${this.id} error: ${data.error.message}`);
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error(`${this.id} returned an empty response`);
      }

      return {
        content,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
}
