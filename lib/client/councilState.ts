/**
 * COUNCIL V0.2 — client-side session state machine.
 *
 * Pure reducer, no React, so it is directly unit-testable. It guarantees the
 * UI can never become permanently stuck (Part 2): every phase resolves to
 * success, failure, or cancellation, and after ANY failure the user can retry
 * or start a new session without refreshing the page (Part 1).
 *
 * Lifecycle:
 *   idle → submitting → running → complete
 *                     ↘ error → (retry → submitting | reset → idle)
 *                     ↘ cancelled → idle
 *
 * Rules enforced here:
 *   - duplicate submissions are ignored while a session is active (Part 17)
 *   - completed agent analyses are preserved on error/interrupt (Part 4/5)
 *   - every session is recorded in `history` with a unique id (Part 18)
 */

import type {
  AgentAnalysis,
  CouncilEvent,
  CouncilMode,
  CouncilUsage,
  CouncilVerdict,
  QuestionClassification,
} from "@/lib/council/types";

export type CouncilPhase = "idle" | "submitting" | "running" | "complete" | "error" | "cancelled";

export type SessionStatus = "running" | "complete" | "error" | "cancelled";

/** A single Council run's record — the foundation for future history (Part 18). */
export interface CouncilSession {
  id: string;
  question: string;
  mode: CouncilMode;
  startedAt: number;
  status: SessionStatus;
  verdict?: CouncilVerdict;
  usage?: CouncilUsage;
  error?: string;
  /** Completed (non-failed) analytical agents, by name. */
  completedAgents: string[];
  failedAgents: string[];
  classification?: QuestionClassification;
}

export interface CouncilState {
  phase: CouncilPhase;
  error: string | null;
  question: string;
  mode: CouncilMode | null;
  /** All SSE events of the CURRENT session (preserved on error, cleared on reset). */
  events: CouncilEvent[];
  sessionId: string | null;
  classification: QuestionClassification | null;
  startedAt: number | null;
  /** Completed sessions — capped to keep memory bounded. */
  history: CouncilSession[];
}

export const HISTORY_LIMIT = 20;

export type CouncilAction =
  | { type: "SUBMIT"; question: string; mode: CouncilMode }
  | { type: "EVENT"; event: CouncilEvent }
  | { type: "STREAM_ERROR"; message: string }
  | { type: "CANCEL" }
  | { type: "RESET" };

export function initialCouncilState(): CouncilState {
  return {
    phase: "idle",
    error: null,
    question: "",
    mode: null,
    events: [],
    sessionId: null,
    classification: null,
    startedAt: null,
    history: [],
  };
}

export function isSessionActive(phase: CouncilPhase): boolean {
  return phase === "submitting" || phase === "running";
}

/** Completed analyses from the current events — used on error to preserve work. */
export function completedAnalyses(events: CouncilEvent[]): AgentAnalysis[] {
  const out: AgentAnalysis[] = [];
  for (const e of events) {
    if (e.type === "agent:done" && !e.analysis.failed) out.push(e.analysis);
  }
  return out;
}

function buildSession(state: CouncilState): CouncilSession {
  const agentEvents = state.events.filter((e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done");
  return {
    id: state.sessionId ?? `client-${Date.now()}`,
    question: state.question,
    mode: state.mode ?? "QUICK",
    startedAt: state.startedAt ?? Date.now(),
    status: "running",
    completedAgents: agentEvents.filter((e) => !e.analysis.failed).map((e) => e.analysis.name),
    failedAgents: agentEvents.filter((e) => e.analysis.failed).map((e) => e.analysis.name),
    classification: state.classification ?? undefined,
  };
}

export function councilReducer(state: CouncilState, action: CouncilAction): CouncilState {
  switch (action.type) {
    case "SUBMIT": {
      // Duplicate-submission guard (Part 17): ignore while a session is active.
      if (isSessionActive(state.phase)) return state;
      return {
        ...state,
        phase: "submitting",
        error: null,
        question: action.question,
        mode: action.mode,
        events: [],
        sessionId: null,
        classification: null,
        startedAt: Date.now(),
      };
    }

    case "EVENT": {
      const event = action.event;
      const events = [...state.events, event];

      if (event.type === "convened") {
        return {
          ...state,
          events,
          sessionId: event.sessionId,
          classification: event.classification,
          phase: "running",
        };
      }

      if (event.type === "verdict") {
        const session = buildSession({ ...state, events });
        return {
          ...state,
          events,
          phase: "complete",
          error: null,
          history: [
            ...state.history.slice(-(HISTORY_LIMIT - 1)),
            { ...session, status: "complete", verdict: event.verdict, usage: event.usage },
          ],
        };
      }

      if (event.type === "error") {
        const session = buildSession({ ...state, events });
        return {
          ...state,
          events,
          phase: "error",
          error: event.message,
          history: [
            ...state.history.slice(-(HISTORY_LIMIT - 1)),
            { ...session, status: "error", error: event.message },
          ],
        };
      }

      return { ...state, events };
    }

    case "STREAM_ERROR": {
      // Preserve completed analyses (Part 4/5) — events are NOT cleared.
      const session = buildSession(state);
      return {
        ...state,
        phase: "error",
        error: action.message,
        history: [
          ...state.history.slice(-(HISTORY_LIMIT - 1)),
          { ...session, status: "error", error: action.message },
        ],
      };
    }

    case "CANCEL": {
      if (state.phase !== "submitting" && state.phase !== "running") return state;
      const session = buildSession(state);
      return {
        ...state,
        phase: "cancelled",
        error: null,
        history: [
          ...state.history.slice(-(HISTORY_LIMIT - 1)),
          { ...session, status: "cancelled" },
        ],
      };
    }

    case "RESET": {
      return initialCouncilState();
    }

    default:
      return state;
  }
}
