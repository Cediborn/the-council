import { clarifyRequestSchema } from "@/lib/council/schemas";
import { classifyQuestion } from "@/lib/council/agents";
import { buildClarificationRequest } from "@/lib/council/clarification";
import { detectSmallTalk } from "@/lib/council/understand";

/**
 * COUNCIL V0.3 — POST /api/council/clarify (Part 7).
 *
 * Asked before convening. Decides whether the question needs a short
 * clarification round (up to 2 questions, bank-first) and returns the explicit
 * assumptions the Council will work under. Fully deterministic and instant —
 * NO model call on this path (user decisions #5/#6/#13: hybrid gate, bank
 * first, answer-or-abandon).
 *
 * Response:
 *   { intent: "CLARIFY" | "CONVENE" | "CHAT",
 *     questions: ClarificationQuestion[], assumptions: string[],
 *     chatReply?: string }
 *
 * The client shows the questions and waits for answers (answer-or-abandon);
 * the answers come back with the convene request as context.clarifications.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let parsed: { question: string; mode: "QUICK" | "FULL" | "DEEP" };
  try {
    const body = await req.json().catch(() => ({}));
    const result = clarifyRequestSchema.safeParse(body);
    if (!result.success) {
      const first = result.error.issues[0]?.message ?? "Invalid request";
      return Response.json({ error: first }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { question } = parsed;

  // Casual input never triggers the Council (user decision #12).
  if (detectSmallTalk(question)) {
    return Response.json({
      intent: "CHAT",
      questions: [],
      assumptions: [],
      chatReply:
        "Hello. Ask the Council anything — a decision, an explanation, a problem — and it will convene several perspectives on it.",
    });
  }

  const classification = classifyQuestion(question);
  const { critical, questions, assumptions } = buildClarificationRequest(
    question,
    classification.type,
  );

  return Response.json({
    intent: critical ? "CLARIFY" : "CONVENE",
    questions,
    assumptions,
    classification: {
      type: classification.type,
      label: classification.label,
    },
  });
}
