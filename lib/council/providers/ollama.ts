import type { ModelProvider, ProviderChatInput, ProviderChatResult } from "./types";

/**
 * Ollama provider — local, free, no API key.
 * Talks to the Ollama HTTP API (/api/chat) over the configured URL.
 */

export interface OllamaConfig {
  url: string;
  model: string;
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly model: string;
  private readonly url: string;
  private readonly numCtx: number;

  constructor(config: OllamaConfig) {
    this.url = config.url.replace(/\/$/, "");
    this.model = config.model;
    // Local models are context-limited; keep enough room for analyses + verdict.
    this.numCtx = Number(process.env.OLLAMA_NUM_CTX ?? 8192);
  }

  withModel(model: string): ModelProvider {
    return new OllamaProvider({ url: this.url, model });
  }

  async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
    const controller = new AbortController();
    // Timeout is env-configurable (default 240s) so a hung model call can
    // never block the Council forever (Part 22).
    //
    // V0.2.2.4 (Part 8): the previous 180s default was TIGHTER than the local
    // CPU model's generation speed (~5 tok/s: a 700-token analysis call needs
    // ~140s of generation alone), so slow-but-legitimate calls were killed at
    // 180s and then retried from scratch — each run wasted a full timeout
    // window per retried stage (measured: practicalist 265s = 180s wasted +
    // 85s success; comparison 354s fits the same pattern). 240s lets capped-
    // output calls finish on the FIRST attempt; retries now only fire for
    // genuine provider failures, not for legitimate slowness.
    const timeoutMs = Number(process.env.COUNCIL_TIMEOUT_MS ?? 240_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onOuterAbort);

    try {
      const res = await fetch(`${this.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          stream: false,
          // Grammar-constrained JSON: forces valid JSON output, which removes
          // the most common malformed-output failure modes of small local
          // models (prose around the JSON, double-encoded objects, etc.).
          format: "json",
          options: {
            temperature: input.temperature ?? 0.6,
            num_predict: input.maxTokens ?? 1500,
            num_ctx: this.numCtx,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      const data = (await res.json()) as OllamaChatResponse;

      if (data.error) {
        throw new Error(`Ollama error: ${data.error}`);
      }
      const content = data.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("Ollama returned an empty response");
      }

      return {
        content,
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
      };
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
}
