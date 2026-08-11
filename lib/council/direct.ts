import { parseJsonObject, unwrapNestedObject, validate } from "./parse";
import { directAnswerSchema } from "./schemas";
import { isTimeoutError, type ModelProvider } from "./providers";
import type { CouncilUsage, CouncilVerdict } from "./types";

/**
 * COUNCIL V0.3 — direct answer for EXPLANATION_REQUEST follow-ups (Part 8.2).
 *
 * When the user asks "can you explain point 2?" or "why did you say that?",
 * the Council answers from the existing verdict with ONE small call instead
 * of re-convening the expensive Council. Never a fabricated re-deliberation.
 */

const DIRECT_SYSTEM = `You are the Council's explainer. The user is asking about the verdict below. Answer their SPECIFIC question plainly and concisely (2-5 sentences), referencing the verdict's actual content. If the requested detail is not in the verdict, say so honestly instead of inventing it.

Respond with ONLY a valid JSON object, no prose, no markdown:
{ "answer": "your answer" }`;

function formatVerdictForExplain(v: CouncilVerdict): string {
  return [
    `Verdict: ${v.verdict}`,
    `Score: ${v.score}/10 · Confidence: ${v.confidence}% · Information sufficiency: ${v.informationSufficiency}`,
    `Summary: ${v.summary}`,
    v.keyReasons.length ? `Key reasons: ${v.keyReasons.join("; ")}` : "",
    v.strongestArgumentFor ? `Strongest argument for: ${v.strongestArgumentFor}` : "",
    v.strongestArgumentAgainst ? `Strongest argument against: ${v.strongestArgumentAgainst}` : "",
    v.whyThisVerdictWon ? `Why this verdict won: ${v.whyThisVerdictWon}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runDirectAnswer(opts: {
  reply: string;
  priorVerdict: CouncilVerdict;
  provider: ModelProvider;
  signal?: AbortSignal;
  usage: CouncilUsage;
}): Promise<{ ok: true; answer: string } | { ok: false; message: string }> {
  const { reply, priorVerdict, provider, signal, usage } = opts;
  const t0 = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const result = await provider.chat({
        system: DIRECT_SYSTEM,
        user: `The user's question:\n"${reply}"\n\nThe Council verdict they are asking about:\n${formatVerdictForExplain(priorVerdict)}`,
        temperature: 0.3,
        maxTokens: 420,
        signal,
      });
      usage.calls?.push({
        stage: "direct_answer",
        agent: "explainer",
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
        directAnswerSchema,
        unwrapNestedObject(parseJsonObject(result.content), "answer", ["answer"]),
      );
      if (!parsed.ok) {
        return { ok: false, message: "direct answer failed validation" };
      }
      return { ok: true, answer: parsed.data.answer };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) break;
    }
  }

  usage.calls?.push({
    stage: "direct_answer",
    agent: "explainer",
    model: provider.model,
    status: isTimeoutError(lastError) ? "TIMED_OUT" : "FAILED",
    retries: 1,
    durationMs: Date.now() - t0,
    inputTokens: 0,
    outputTokens: 0,
  });
  usage.failedAgentCalls += 1;
  return { ok: false, message: lastError instanceof Error ? lastError.message : "direct answer failed" };
}

/** Deterministic small-talk reply — no model call (user decision #12). */
export function chatReplyFor(reply: string): string {
  const r = reply.trim().toLowerCase();
  if (/^(thanks?|thank you|thx|ty)\b/.test(r)) {
    return "You're welcome — glad the Council could help. Ask anything else whenever you need another deliberation.";
  }
  if (/^(ok|okay|k|kk|alright|sure)\b/.test(r)) {
    return "Ready when you are — a new question, or anything you'd like the Council to reconsider.";
  }
  if (/^(hi|hello|hey|yo)\b/.test(r)) {
    return "Hello. Ask the Council anything — or tell me what you'd like to dig into from the verdict above.";
  }
  return "Got it. Ask me anything else, or push back on the verdict and the Council will reconsider.";
}
