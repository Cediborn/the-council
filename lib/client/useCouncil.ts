"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AgentKey, CouncilEvent, CouncilMode } from "@/lib/council/types";
import {
  councilReducer,
  initialCouncilState,
  isSessionActive,
  type CouncilPhase,
} from "./councilState";
import { clearSessions, loadSessions, saveSession, type StoredSession } from "./persistence";

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

const TERMINAL_PHASES: CouncilPhase[] = ["complete", "degraded", "failed", "cancelled"];

/**
 * Runs the Council by POSTing to /api/council and consuming the SSE stream.
 *
 * V0.2.2.2 additions over V0.2/V0.2.2:
 *  - `retryAgent()` resumes the SAME session, re-running only the failed
 *    member (stateless resume payload — safe on serverless).
 *  - `restoreSession()` reopens a persisted session after a refresh.
 *  - terminal sessions are auto-persisted to localStorage (TEST 6).
 *
 * Reliability guarantees (V0.2) are unchanged: any failure lands in the
 * `failed` phase with completed analyses preserved — never a dead UI, never
 * a required refresh. Duplicate submissions are ignored while a session is
 * active; abort + stream readers are cleaned up on unmount.
 */
export function useCouncil() {
  const [state, dispatch] = useReducer(councilReducer, undefined, initialCouncilState);
  const abortRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<{ controller: AbortController; runId: string } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // SYNCHRONOUS running flag (Part 17): the reducer guard alone is not enough
  // because two clicks within the same render tick both read a stale phase.
  const runningRef = useRef(false);
  const [previousSessions, setPreviousSessions] = useState<StoredSession[]>([]);

  // Load persisted sessions once on mount (TEST 6 — restore after refresh).
  useEffect(() => {
    setPreviousSessions(loadSessions());
  }, []);

  // Auto-persist terminal sessions (COMPLETE / DEGRADED / FAILED / CANCELLED
  // with preserved work) as soon as the phase settles.
  useEffect(() => {
    const s = stateRef.current;
    if (!TERMINAL_PHASES.includes(s.phase) || s.events.length === 0) return;
    const verdict = s.events.findLast(
      (e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict",
    );
    const stored: StoredSession = {
      version: 1,
      sessionId: s.sessionId ?? `client-${s.startedAt ?? Date.now()}`,
      question: s.question,
      mode: s.mode ?? "QUICK",
      startedAt: s.startedAt ?? Date.now(),
      status: s.phase === "cancelled" ? "cancelled" : s.phase === "failed" ? "failed" : verdict?.verdict.degraded ? "degraded" : "complete",
      error: s.error ?? undefined,
      verdict: verdict?.verdict,
      usage: verdict?.usage,
      events: s.events,
    };
    setPreviousSessions(saveSession(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  /**
   * Shared SSE consumer for both fresh runs and resumed runs. Dispatches each
   * frame, tolerates malformed frames, and reports an interrupted stream.
   */
  const consumeStream = useCallback(
    async (controller: AbortController, res: Response) => {
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = (body as { error?: string }).error ?? `Request failed (${res.status}).`;
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
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
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
    },
    [],
  );

  const run = useCallback(
    (q: string, m: CouncilMode) => {
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
          await consumeStream(controller, res);
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
    },
    [consumeStream],
  );

  /**
   * V0.2.2.2 (Part 5): retry ONE failed member within the same session.
   * The completed analyses are sent back with the request (stateless resume —
   * no server-side session store, safe on serverless).
   */
  const retryAgent = useCallback(
    (agent: AgentKey) => {
      if (runningRef.current || isSessionActive(stateRef.current.phase)) return;
      const s = stateRef.current;
      if (!s.question || !s.mode || !s.sessionId) return;
      const convened = s.events.find(
        (e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened",
      );
      if (!convened) return;
      const analyses = s.events
        .filter((e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done")
        .map((e) => e.analysis);

      runningRef.current = true;
      dispatch({ type: "RESUME", retryAgent: agent });

      const controller = new AbortController();
      const runId = makeClientId();
      abortRef.current = controller;
      activeRunRef.current = { controller, runId };

      void (async () => {
        try {
          const res = await fetch("/api/council", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: s.question,
              mode: s.mode,
              sessionId: s.sessionId,
              resume: { agents: convened.agents, analyses, retryAgent: agent },
            }),
            signal: controller.signal,
          });
          await consumeStream(controller, res);
        } catch (err) {
          if (controller.signal.aborted) return;
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
    },
    [consumeStream],
  );

  const restoreSession = useCallback((session: StoredSession) => {
    dispatch({ type: "RESTORE", session });
  }, []);

  const clearHistory = useCallback(() => {
    clearSessions();
    setPreviousSessions([]);
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
    previousSessions,
    isActive: isSessionActive(state.phase),
    run,
    retryAgent,
    restoreSession,
    clearHistory,
    cancel,
    reset,
  };
}
