"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { CouncilEvent, CouncilMode } from "@/lib/council/types";
import {
  councilReducer,
  initialCouncilState,
  isSessionActive,
  type CouncilPhase,
} from "./councilState";

export type { CouncilPhase } from "./councilState";

function isEvent(e: unknown): e is CouncilEvent {
  return (
    typeof e === "object" &&
    e !== null &&
    "type" in e &&
    typeof (e as { type: unknown }).type === "string"
  );
}

/** A stable client id used until the server confirms its own session id. */
function makeClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Runs the Council by POSTing to /api/council and consuming the SSE stream.
 *
 * V0.2 reliability guarantees (Parts 1-5):
 *  - Any failure (network, provider down, stream interrupted, server error,
 *    malformed data) lands in the `error` phase with completed analyses
 *    preserved — never a dead UI.
 *  - `cancel()` aborts the request, stops streaming, and lets the user
 *    immediately start another session.
 *  - Duplicate submissions are ignored while a session is active.
 *  - Abort + stream readers are cleaned up on unmount.
 */
export function useCouncil() {
  const [state, dispatch] = useReducer(councilReducer, undefined, initialCouncilState);
  const abortRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<{ controller: AbortController; runId: string } | null>(null);
  // Keep a ref of state so `run` can check the phase without re-binding.
  const stateRef = useRef(state);
  stateRef.current = state;
  // SYNCHRONOUS running flag (Part 17): the reducer guard alone is not enough
  // because two clicks within the same render tick both read a stale phase.
  // Set BEFORE dispatch, cleared only in the run's finally (keyed by runId).
  const runningRef = useRef(false);

  const run = useCallback((q: string, m: CouncilMode) => {
    // Duplicate-submission guard (Part 17): synchronous ref + reducer state.
    if (runningRef.current || isSessionActive(stateRef.current.phase)) return;
    runningRef.current = true;

    dispatch({ type: "SUBMIT", question: q, mode: m });

    const controller = new AbortController();
    const runId = makeClientId();
    abortRef.current = controller;
    activeRunRef.current = { controller, runId };

    void (async () => {
      try {
        const res = await fetch("/api/council", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, mode: m }),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const message =
            (body as { error?: string }).error ?? `Request failed (${res.status}).`;
          dispatch({ type: "STREAM_ERROR", message });
          return;
        }
        if (!res.body) {
          dispatch({ type: "STREAM_ERROR", message: "No response stream." });
          return;
        }

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
                dispatch({ type: "EVENT", event: parsed });
                if (parsed.type === "verdict" || parsed.type === "error") {
                  terminal = true;
                }
              }
            } catch {
              // ignore malformed frame — never let one bad frame kill the run
            }
          }
        }

        // Stream ended cleanly without a terminal event → interrupted.
        if (!terminal && !controller.signal.aborted) {
          dispatch({
            type: "STREAM_ERROR",
            message: "The Council stream ended before a verdict was reached.",
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return; // cancelled — reducer already handled it
        const message =
          err instanceof Error && err.name !== "AbortError"
            ? err.message
            : "The connection to the Council was lost.";
        dispatch({ type: "STREAM_ERROR", message });
      } finally {
        if (activeRunRef.current?.runId === runId) {
          activeRunRef.current = null;
          abortRef.current = null;
          runningRef.current = false;
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "CANCEL" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeRunRef.current = null;
    runningRef.current = false;
    dispatch({ type: "RESET" });
  }, []);

  // Abort any in-flight request on unmount (Part 3: clean up listeners).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      activeRunRef.current = null;
      runningRef.current = false;
    };
  }, []);

  const lastVerdict = useMemo(
    () =>
      state.events.findLast((e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict"),
    [state.events],
  );

  return {
    phase: state.phase,
    error: state.error,
    question: state.question,
    mode: state.mode,
    events: state.events,
    sessionId: state.sessionId,
    classification: state.classification,
    history: state.history,
    lastVerdict,
    isActive: isSessionActive(state.phase),
    run,
    cancel,
    reset,
  };
}
