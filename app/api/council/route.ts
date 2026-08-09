import { councilRequestSchema } from "@/lib/council/schemas";
import { CouncilRunError, runCouncil } from "@/lib/council/orchestrator";
import type { CouncilEvent } from "@/lib/council/types";

/**
 * POST /api/council
 * Body: { question: string, mode: "QUICK" | "FULL" | "DEEP" }
 * Response: Server-Sent Events stream of CouncilEvent objects.
 *
 * The stream reflects REAL pipeline progress: agents emit start/done events as
 * they finish (they run concurrently), then comparison / devil's advocate /
 * judge stages. Nothing is faked; every event corresponds to an actual stage.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: CouncilEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  let parsed: { question: string; mode: "QUICK" | "FULL" | "DEEP" };
  try {
    const body = await req.json().catch(() => ({}));
    const result = councilRequestSchema.safeParse(body);
    if (!result.success) {
      const first = result.error.issues[0]?.message ?? "Invalid request";
      return Response.json({ error: first }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

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

      // Abort the whole run if the client disconnects.
      const abortController = new AbortController();
      const onAbort = () => abortController.abort();
      req.signal.addEventListener("abort", onAbort);

      try {
        for await (const event of runCouncil({
          mode: parsed.mode,
          question: parsed.question,
          signal: abortController.signal,
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
