import { parseJsonObject, unwrapNestedObject, validate } from "./parse";
import { understanderSchema } from "./schemas";
import { isTimeoutError, type ModelProvider } from "./providers";
import type { CouncilUsage, QuestionType } from "./types";

/**
 * COUNCIL V0.3 — the LLM question-understander (Part 6.3).
 *
 * Runs ONLY when the deterministic gate flags the question as ambiguous
 * (short / elliptical / pronoun-heavy) — never on the fast path. Its job is
 * to take responsibility for understanding the user (Part 1): restate the
 * intent plainly, surface inferred assumptions, name anything critical that
 * is missing, and offer a better framing. It must NOT blame the user.
 *
 * Failure is graceful by design: the caller proceeds with the deterministic
 * heuristic context instead. The Council never blocks on this call.
 */

const UNDERSTANDER_SYSTEM = `You are the Council's question-understander. A user has asked the Council a question. The question may be informal, short, or ambiguous — it is NOT the user's fault. Your job is to understand the intent and say what is still needed, kindly.

Respond with ONLY a valid JSON object, no prose, no markdown:
{
  "restatedQuestion": "the most reasonable, plain restatement of what they are asking, 1 sentence",
  "intent": "what outcome or decision the user actually wants, 1 short phrase",
  "inferredAssumptions": ["reasonable assumptions we can safely make from the question"],
  "missingCritical": ["only information that would materially change the answer — maximum 2 items"],
  "reframing": "an optional better way to frame the question, or empty string"
}`;

const UNDERSTANDER_KEYS = [
  "restatedQuestion",
  "intent",
  "inferredAssumptions",
  "missingCritical",
  "reframing",
];

export interface UnderstanderResult {
  restatedQuestion: string;
  intent: string;
  inferredAssumptions: string[];
  missingCritical: string[];
  reframing: string;
}

export async function runUnderstander(opts: {
  question: string;
  type: QuestionType;
  provider: ModelProvider;
  signal?: AbortSignal;
  usage: CouncilUsage;
}): Promise<{ ok: true; data: UnderstanderResult } | { ok: false; message: string }> {
  const { question, provider, signal, usage } = opts;
  const t0 = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const result = await provider.chat({
        system: UNDERSTANDER_SYSTEM,
        user: `Question: ${question}\n\nClassified type: ${opts.type}`,
        temperature: 0.2,
        maxTokens: 320,
        signal,
      });
      usage.calls?.push({
        stage: "understanding",
        agent: "understander",
        model: provider.model,
        status: "COMPLETED",
        retries: attempt,
        durationMs: Date.now() - t0,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.agentCalls += 1;

      const parsed = validate(
        understanderSchema,
        unwrapNestedObject(parseJsonObject(result.content), "restatedQuestion", UNDERSTANDER_KEYS),
      );
      if (!parsed.ok) {
        return {
          ok: false,
          message: "understander output failed validation",
        };
      }
      return { ok: true, data: parsed.data };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) break;
      // one retry for transient failures
    }
  }

  usage.calls?.push({
    stage: "understanding",
    agent: "understander",
    model: provider.model,
    status: isTimeoutError(lastError) ? "TIMED_OUT" : "FAILED",
    retries: 1,
    durationMs: Date.now() - t0,
    inputTokens: 0,
    outputTokens: 0,
  });
  usage.failedAgentCalls += 1;
  return { ok: false, message: lastError instanceof Error ? lastError.message : "understander failed" };
}

/**
 * Context block injected into every agent prompt when the understander ran,
 * so the Council reasons about the intended question rather than the raw
 * wording (Part 6 — explicit assumptions, visible and correctable).
 */
export function buildUnderstandingContext(result: UnderstanderResult): string {
  const parts: string[] = [];
  if (result.restatedQuestion) {
    parts.push(`Understood question: ${result.restatedQuestion}`);
  }
  if (result.intent) {
    parts.push(`User intent: ${result.intent}`);
  }
  if (result.inferredAssumptions.length > 0) {
    parts.push(`Inferred assumptions: ${result.inferredAssumptions.join("; ")}`);
  }
  if (result.missingCritical.length > 0) {
    parts.push(
      `Information that would materially change the answer (unknown): ${result.missingCritical.join("; ")}`,
    );
  }
  if (result.reframing) {
    parts.push(`Possible better framing: ${result.reframing}`);
  }
  if (parts.length === 0) return "";
  return `\n\nQuestion understanding:\n${parts.map((p) => `- ${p}`).join("\n")}`;
}
