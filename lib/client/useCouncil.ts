"use client";

import { useCallback, useRef, useState } from "react";
import type { CouncilEvent, CouncilMode } from "@/lib/council/types";

export type CouncilPhase = "idle" | "running" | "complete" | "error";

export interface CouncilState {
  phase: CouncilPhase;
  error: string | null;
  question: string;
  mode: CouncilMode | null;
  events: CouncilEvent[];
}

function isEvent(e: unknown): e is CouncilEvent {
  return (
    typeof e === "object" &&
    e !== null &&
    "type" in e &&
    typeof (e as { type: unknown }).type === "string"
  );
}

/**
 * Runs the Council by POSTing to /api/council and consuming the SSE stream.
 * Every stage event updates state as it arrives — the UI reflects the real
 * pipeline, never a fake timer.
 */
export function useCouncil() {
  const [phase, setPhase] = useState<CouncilPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<CouncilMode | null>(null);
  const [events, setEvents] = useState<CouncilEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const lastVerdict = events.findLast((e) => e.type === "verdict") as
    | Extract<CouncilEvent, { type: "verdict" }>
    | undefined;

  const lastErrorEvent = events.findLast((e) => e.type === "error") as
    | Extract<CouncilEvent, { type: "error" }>
    | undefined;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setError(null);
    setEvents([]);
    setMode(null);
  }, []);

  const run = useCallback(
    async (q: string, m: CouncilMode) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setQuestion(q);
      setMode(m);
      setEvents([]);
      setError(null);
      setPhase("running");

      try {
        const res = await fetch("/api/council", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, mode: m }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
        }
        if (!res.body) throw new Error("No response stream.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let terminal = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by blank lines.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const parsed: unknown = JSON.parse(line.slice(6));
              if (isEvent(parsed)) {
                setEvents((prev) => [...prev, parsed]);
                if (parsed.type === "verdict") {
                  terminal = true;
                  setPhase("complete");
                }
                if (parsed.type === "error") {
                  terminal = true;
                  setPhase("error");
                  setError(parsed.message);
                }
              }
            } catch {
              // ignore malformed frame
            }
          }
        }

        // If stream ended without a verdict or error event, surface it.
        // (Tracked via a local flag rather than a state updater so the
        // updater stays pure.)
        if (!terminal) {
          setError("The Council stream ended without a verdict.");
          setPhase("error");
        }
      } catch (err) {
        if (controller.signal.aborted) {
          setPhase("idle");
          return;
        }
        setError(err instanceof Error ? err.message : "The Council failed unexpectedly.");
        setPhase("error");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  return {
    phase,
    error,
    question,
    mode,
    events,
    lastVerdict,
    lastErrorEvent,
    run,
    reset,
  };
}
