/**
 * COUNCIL V0.2.2.2 — client-side session state machine.
 *
 * Pure reducer, no React, so it is directly unit-testable. It guarantees the
 * UI can never become permanently stuck (Part 2): every phase resolves to
 * success, failure, or cancellation, and after ANY failure the user can retry,
 * retry a single member, or start a new session without refreshing (Part 1).
 *
 * Explicit pipeline phases (Part 5):
 *   idle → analyzing → council_complete → judging → complete
 *                     ↘ partial_results (≥1 analysis, ≥1 failure, not done)
 *   complete ──(degraded verdict)──→ degraded
 *   any active phase → failed | cancelled
 *   complete/degraded/failed/cancelled → analyzing (RESUME — per-member retry)
 *   any terminal → idle (RESET)
 *
 * Rules enforced here:
 *   - duplicate submissions are ignored while a session is active (Part 17)
 *   - completed agent analyses are preserved on error/interrupt (Part 4/5)
 *   - agent:done and verdict events are deduplicated so a resumed run merges
 *     cleanly into the existing event list (Part 11 — race/duplicate handling)
 *   - every session is recorded in `history` with a unique id (Part 18)
 *   - members carry explicit outcomes: COMPLETED / FAILED / TIMED_OUT /
 *     NOT_STARTED (Part 10)
 */

import type {
  AgentAnalysis,
  AgentKey,
  AgentOutcome,
  CouncilEvent,
  CouncilMode,
  CouncilUsage,
  CouncilVerdict,
  QuestionClassification,
} from "@/lib/council/types";
import type { StoredSession } from "./persistence";

export type CouncilPhase =
  | "idle"
  | "analyzing"
  | "partial_results"
  | "council_complete"
  | "judging"
  | "complete"
  | "degraded"
  | "failed"
  | "cancelled";

export type SessionStatus = "running" | "complete" | "degraded" | "failed" | "cancelled";

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
  /** V0.2.2.2: per-member outcome attribution (Part 10). */
  memberOutcomes: Record<string, AgentOutcome>;
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
  | { type: "RESUME"; retryAgent: AgentKey }
  | { type: "RESTORE"; session: StoredSession }
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

const ACTIVE_PHASES: CouncilPhase[] = ["analyzing", "partial_results", "council_complete", "judging"];

export function isSessionActive(phase: CouncilPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

/** Completed analyses from the current events — used on error to preserve work. */
export function completedAnalyses(events: CouncilEvent[]): AgentAnalysis[] {
  const out: AgentAnalysis[] = [];
  for (const e of events) {
    if (e.type === "agent:done" && !e.analysis.failed) out.push(e.analysis);
  }
  return out;
}

/** V0.2.2.2: per-member outcome attribution from events (Part 10). */
export function memberOutcomes(events: CouncilEvent[], agents: AgentKey[]): Record<string, AgentOutcome> {
  const out: Record<string, AgentOutcome> = {};
  for (const agent of agents) {
    const ev = events.findLast(
      (e): e is Extract<CouncilEvent, { type: "agent:done" }> =>
        e.type === "agent:done" && e.analysis.agent === agent,
    );
    if (!ev) out[agent] = "NOT_STARTED";
    else if (ev.analysis.failed) out[agent] = ev.analysis.outcome ?? "FAILED";
    else out[agent] = "COMPLETED";
  }
  return out;
}

/**
 * V0.2.2.2: derive the explicit phase purely from received events. Terminal
 * states are only entered by their real events — a degraded verdict is a
 * distinct DEGRADED terminal phase (never a pretend success).
 */
function derivePhaseFromEvents(events: CouncilEvent[]): CouncilPhase {
  const verdict = events.findLast((e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict");
  if (verdict) return verdict.verdict.degraded ? "degraded" : "complete";

  const error = events.findLast((e): e is Extract<CouncilEvent, { type: "error" }> => e.type === "error");
  if (error) return "failed";

  const convened = events.find((e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened");
  if (!convened) return "analyzing";

  if (events.some((e) => e.type === "stage" && e.stage === "judging")) return "judging";
  if (
    events.some((e) => e.type === "stage" && (e.stage === "comparing" || e.stage === "devils_advocate" || e.stage === "reassessing"))
  ) {
    return "council_complete";
  }

  const agents = convened.agents;
  const doneFor = (a: AgentKey) =>
    events.some((e) => e.type === "agent:done" && e.analysis.agent === a);

  // All members settled → analysis finished (comparison on deck).
  if (agents.every((a) => doneFor(a))) return "council_complete";

  const anyDone = agents.some((a) => doneFor(a));
  const anyFailed = agents.some((a) => {
    const ev = events.findLast(
      (e): e is Extract<CouncilEvent, { type: "agent:done" }> =>
        e.type === "agent:done" && e.analysis.agent === a,
    );
    return Boolean(ev?.analysis.failed);
  });
  // ≥1 analysis complete AND ≥1 member failed → PARTIAL_RESULTS (recoverable).
  if (anyDone && anyFailed) return "partial_results";
  // Otherwise still analysing (or waiting for the first start event).
  return "analyzing";
}

function buildSession(state: CouncilState, status: SessionStatus): CouncilSession {
  const agentEvents = state.events.filter(
    (e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done",
  );
  const convened = state.events.find(
    (e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened",
  );
  const verdictEvent = state.events.findLast(
    (e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict",
  );
  return {
    id: state.sessionId ?? `client-${Date.now()}`,
    question: state.question,
    mode: state.mode ?? "QUICK",
    startedAt: state.startedAt ?? Date.now(),
    status,
    verdict: verdictEvent?.verdict,
    usage: verdictEvent?.usage,
    error: state.error ?? undefined,
    completedAgents: agentEvents.filter((e) => !e.analysis.failed).map((e) => e.analysis.name),
    failedAgents: agentEvents.filter((e) => e.analysis.failed).map((e) => e.analysis.name),
    memberOutcomes: memberOutcomes(state.events, convened?.agents ?? []),
    classification: state.classification ?? undefined,
  };
}

function pushHistory(state: CouncilState, status: SessionStatus): CouncilState {
  // Avoid duplicate entries for the same session (resume may re-reach terminal).
  if (state.history.some((h) => h.id === (state.sessionId ?? `client-${state.startedAt}`))) {
    return state;
  }
  const session = buildSession(state, status);
  return {
    ...state,
    history: [...state.history.slice(-(HISTORY_LIMIT - 1)), session],
  };
}

/**
 * Append an event, deduplicating agent:done (by member) and verdict events so
 * a resumed run merges cleanly into the existing stream (Part 11).
 */
function appendEvent(events: CouncilEvent[], event: CouncilEvent): CouncilEvent[] {
  if (event.type === "convened" || event.type === "agent:done" || event.type === "verdict") {
    const idx = events.findIndex((e) => e.type === event.type && (e.type !== "agent:done" || e.analysis.agent === (event as Extract<CouncilEvent, { type: "agent:done" }>).analysis.agent));
    if (idx >= 0) {
      const next = [...events];
      next[idx] = event;
      return next;
    }
  }
  return [...events, event];
}

export function councilReducer(state: CouncilState, action: CouncilAction): CouncilState {
  switch (action.type) {
    case "SUBMIT": {
      // Duplicate-submission guard (Part 17): ignore while a session is active.
      if (isSessionActive(state.phase)) return state;
      return {
        ...state,
        phase: "analyzing",
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
      const events = appendEvent(state.events, action.event);
      const phase = derivePhaseFromEvents(events);

      if (action.event.type === "convened") {
        return {
          ...state,
          events,
          sessionId: action.event.sessionId,
          classification: action.event.classification,
          phase,
        };
      }

      const next: CouncilState = { ...state, events, phase, error: null };
      if (phase === "complete" || phase === "degraded" || phase === "failed") {
        return pushHistory(next, phase);
      }
      return next;
    }

    case "STREAM_ERROR": {
      // Preserve completed analyses (Part 4/5) — events are NOT cleared.
      const next: CouncilState = {
        ...state,
        phase: "failed",
        error: action.message,
      };
      return pushHistory(next, "failed");
    }

    case "CANCEL": {
      if (!isSessionActive(state.phase)) return state;
      const next: CouncilState = { ...state, phase: "cancelled", error: null };
      return pushHistory(next, "cancelled");
    }

    case "RESUME": {
      // V0.2.2.2 (Part 5): re-run one failed member within the same session.
      // Only allowed from a settled state (never mid-run). Strip the previous
      // terminal + downstream events (verdict/error/comparison/stress-test —
      // they will be re-emitted) but keep the convened/start/done events so
      // completed analyses are preserved and re-derived cleanly.
      if (isSessionActive(state.phase)) return state;
      const kept = state.events.filter(
        (e) => e.type === "convened" || e.type === "agent:start" || e.type === "agent:done",
      );
      return {
        ...state,
        phase: "analyzing",
        error: null,
        events: kept,
      };
    }

    case "RESTORE": {
      // V0.2.2.2 (TEST 6): reopen a persisted session after a refresh.
      const { session } = action;
      const events = Array.isArray(session.events) ? session.events : [];
      const convened = events.find(
        (e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened",
      );
      const verdict = events.findLast(
        (e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict",
      );
      let phase: CouncilPhase;
      if (verdict) phase = verdict.verdict.degraded ? "degraded" : "complete";
      else if (session.status === "failed") phase = "failed";
      else if (session.status === "cancelled") phase = "cancelled";
      else phase = "complete";
      return {
        ...initialCouncilState(),
        phase,
        error: session.status === "failed" ? (session.error ?? "Session restored from a failed run.") : null,
        question: session.question,
        mode: session.mode,
        events,
        sessionId: session.sessionId,
        classification: convened?.classification ?? null,
        startedAt: session.startedAt,
      };
    }

    case "RESET": {
      return initialCouncilState();
    }

    default:
      return state;
  }
}
