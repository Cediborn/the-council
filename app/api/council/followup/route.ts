import { followupRequestSchema } from "@/lib/council/schemas";
import {
  classifyQuestion,
} from "@/lib/council/agents";
import {
  CouncilRunError,
  runCouncil,
} from "@/lib/council/orchestrator";
import { affectedAgentsFor, classifyFollowUp } from "@/lib/council/followup";
import { chatReplyFor, runDirectAnswer } from "@/lib/council/direct";
import { resolveProviderForStage } from "@/lib/council/providers";
import type {
  AgentAnalysis,
  AgentKey,
  CouncilEvent,
  CouncilUsage,
  FollowUpIntent,
} from "@/lib/council/types";

/**
 * COUNCIL V0.3 — POST /api/council/followup (Part 8).
 *
 * A reply after a verdict. Stateless (the client sends the minimal thread
 * context). Emits an SSE stream:
 *
 *   followup:intent   → the classified intent (SMALL_TALK / EXPLANATION_REQUEST /
 *                       CORRECTION / NEW_INFORMATION / CHALLENGE / NEW_QUESTION)
 *   direct:reply      → for chat / explanation / challenge-note / new-question
 *                       replies (no deliberation)
 *   …or the normal deliberation events (targeted re-analysis) ending in a
 *   verdict that carries a `diff` vs the previous verdict.
 *
 * Two-path rule (user decision #3): corrections/new information trigger a
 * TARGETED re-analysis (lighter pipeline, no Devil's Advocate); explanation
 * requests get a direct answer without re-convening the Council.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: CouncilEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function makeUsage(sessionId: string, mode: "QUICK" | "FULL" | "DEEP"): CouncilUsage {
  return {
    sessionId,
    mode,
    agentCalls: 0,
    failedAgentCalls: 0,
    model: "",
    provider: "",
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    success: false,
    questionLength: 0,
    startedAt: new Date().toISOString(),
    stageDurations: {
      analysisMs: 0,
      comparisonMs: 0,
      devilsAdvocateMs: 0,
      reassessmentMs: 0,
      judgeMs: 0,
      understandingMs: 0,
      directAnswerMs: 0,
    },
    agentDurations: {},
    calls: [],
  };
}

export async function POST(req: Request) {
  let parsed;
  try {
    const body = await req.json().catch(() => ({}));
    const result = followupRequestSchema.safeParse(body);
    if (!result.success) {
      const first = result.error.issues[0]?.message ?? "Invalid request";
      return Response.json({ error: first }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { question, mode, reply, sessionId, priorVerdict, priorAnalyses } = parsed;
  const stableSessionId = sessionId ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // ── Step 1: classify the follow-up intent (deterministic, free) ───────────
  const rawIntent = classifyFollowUp(reply);
  const intent: FollowUpIntent = rawIntent === "UNKNOWN" ? "NEW_INFORMATION" : rawIntent;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CouncilEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          // client went away
        }
      };
      const abortController = new AbortController();
      const onAbort = () => abortController.abort();
      req.signal.addEventListener("abort", onAbort);

      try {
        send({ type: "followup:intent", intent, stage: "complete" });

        // ── Step 2a: no-deliberation paths ───────────────────────────────────
        if (intent === "SMALL_TALK") {
          send({ type: "direct:reply", reply: chatReplyFor(reply), intent, stage: "complete" });
          return;
        }

        if (intent === "CHALLENGE") {
          send({
            type: "direct:reply",
            reply:
              "Challenge mode isn't live yet — it's the next Council upgrade. For now, tell me what you think is wrong and the Council will reconsider the verdict directly.",
            intent,
            stage: "complete",
          });
          return;
        }

        if (intent === "NEW_QUESTION") {
          send({ type: "direct:reply", reply, intent, newQuestion: true, stage: "complete" });
          return;
        }

        if (intent === "EXPLANATION_REQUEST") {
          const usage = makeUsage(stableSessionId, mode);
          const provider = resolveProviderForStage("direct_answer");
          usage.model = provider.model;
          usage.provider = provider.id;
          const t0 = Date.now();
          const result = await runDirectAnswer({
            reply,
            priorVerdict,
            provider,
            signal: abortController.signal,
            usage,
          });
          usage.durationMs = Date.now() - t0;
          usage.success = result.ok;
          usage.stageDurations.directAnswerMs = Date.now() - t0;
          if (result.ok) {
            send({ type: "direct:reply", reply: result.answer, intent, stage: "complete" });
          } else {
            send({
              type: "direct:reply",
              reply:
                "The Council couldn't answer that one directly right now. You can still push back on the verdict and it will reconsider — or ask again shortly.",
              intent,
              stage: "complete",
            });
          }
          return;
        }

        // ── Step 2b: targeted re-deliberation (CORRECTION / NEW_INFORMATION) ─
        const classification = classifyQuestion(question);
        const priorAgentKeys = priorAnalyses.map((a) => a.agent as AgentKey);
        const affectedAgents = affectedAgentsFor(reply, classification.type, priorAgentKeys);
        const mergedContext = [
          ...(parsed.mergedContext ?? []),
          reply,
        ];

        for await (const event of runCouncil({
          mode,
          question,
          signal: abortController.signal,
          sessionId: stableSessionId,
          reconsider: {
            priorAnalyses: priorAnalyses as AgentAnalysis[],
            priorVerdict,
            affectedAgents,
            mergedContext,
          },
        })) {
          send(event);
        }
      } catch (err) {
        if (err instanceof CouncilRunError) {
          send({
            type: "error",
            message: err.message,
            stage: "failed",
            analyses: err.analyses,
            devilsAdvocate: err.devilsAdvocate,
          });
        } else {
          send({
            type: "error",
            message: err instanceof Error ? err.message : "The Council failed unexpectedly.",
            stage: "failed",
            analyses: [],
            devilsAdvocate: null,
          });
        }
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
