/**
 * COUNCIL V0.2.2 — pure deliberation-state derivation.
 *
 * The DeliberationPanel consumes these helpers so the visual pipeline always
 * mirrors the real SSE event stream. No animation is faked: a stage is only
 * shown once the corresponding backend event has arrived.
 */

import type { AgentKey, CouncilEvent, CouncilMode } from "@/lib/council/types";

/** The current position of the Council through its pipeline. */
export type DeliberationStageId =
  | "analyzing"
  | "comparing"
  | "devils_advocate"
  | "reassessing"
  | "judging"
  | "complete";

/** Per-agent visual state (Part 7). */
export type AgentVisualState = "WAITING" | "ACTIVE" | "COMPLETE" | "FAILED";

export interface AgentVisual {
  state: AgentVisualState;
  /** Human text shown under the agent name. */
  statusText: string;
  /** Status chip label. */
  chip: string;
}

/**
 * Current deliberation stage derived purely from received events.
 * QUICK skips comparison; DEEP adds the stress-test + reassessment stages.
 */
export function deriveDeliberationStage(
  events: CouncilEvent[],
  mode: CouncilMode,
): DeliberationStageId {
  if (events.some((e) => e.type === "verdict")) return "complete";
  if (events.some((e) => e.type === "stage" && e.stage === "judging")) return "judging";
  if (events.some((e) => e.type === "stage" && e.stage === "reassessing")) return "reassessing";
  if (events.some((e) => e.type === "stage" && e.stage === "devils_advocate")) return "devils_advocate";
  if (events.some((e) => e.type === "stage" && e.stage === "comparing")) return "comparing";

  const convened = events.find((e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened");
  if (convened && convened.agents.every((a) => hasAnalysis(events, a))) {
    // All analysts done — the next visible stage is on deck.
    return mode === "QUICK" ? "judging" : "comparing";
  }
  return "analyzing";
}

export function hasAnalysis(events: CouncilEvent[], agent: AgentKey): boolean {
  return events.some((e) => e.type === "agent:done" && e.analysis.agent === agent);
}

/** Human labels for the pipeline strip (Part 5). */
export const STAGE_LABELS: Record<DeliberationStageId, string> = {
  analyzing: "Analyzing",
  comparing: "Comparing",
  devils_advocate: "Challenging",
  reassessing: "Reassessing",
  judging: "Judging",
  complete: "Verdict",
};

/** Stages a given mode passes through, in order (for the pipeline strip). */
export function stagesForMode(mode: CouncilMode): DeliberationStageId[] {
  const base: DeliberationStageId[] = ["analyzing", "judging", "complete"];
  if (mode === "FULL") return ["analyzing", "comparing", "judging", "complete"];
  if (mode === "DEEP") {
    return ["analyzing", "comparing", "devils_advocate", "reassessing", "judging", "complete"];
  }
  return base;
}

const AGENT_DOING: Record<string, string> = {
  reasoner: "Analyzing the problem",
  skeptic: "Stress-testing assumptions",
  practicalist: "Analyzing feasibility",
  perspective: "Seeking alternative framings",
  devils_advocate: "Stress-testing the strongest argument",
  comparer: "Comparing perspectives",
  reassessor: "Reassessing after the stress-test",
  judge: "Evaluating the evidence",
};

const AGENT_DONE: Record<string, string> = {
  reasoner: "Analyzed the problem",
  skeptic: "Stress-tested assumptions",
  practicalist: "Assessed real-world feasibility",
  perspective: "Found alternative framings",
  devils_advocate: "Stress-tested the strongest argument",
  comparer: "Compared perspectives",
  reassessor: "Reassessed positions",
  judge: "Reached a verdict",
};

export function agentVisual(events: CouncilEvent[], agent: AgentKey): AgentVisual {
  const doneEvent = events.findLast(
    (e): e is Extract<CouncilEvent, { type: "agent:done" }> =>
      e.type === "agent:done" && e.analysis.agent === agent,
  );

  if (doneEvent?.analysis.failed) {
    // V0.2.2.2 (Part 10): TIMED OUT is attributed distinctly from FAILED.
    const timedOut = doneEvent.analysis.outcome === "TIMED_OUT";
    return {
      state: "FAILED",
      statusText: timedOut
        ? "Timed out — the Council continued without it"
        : "Failed — the Council continued without it",
      chip: timedOut ? "TIMED OUT" : "FAILED",
    };
  }
  if (doneEvent) {
    const degraded = doneEvent.analysis.degraded;
    return {
      state: "COMPLETE",
      statusText: `${AGENT_DONE[agent] ?? "Analysis complete"}${degraded ? " (partial)" : ""}`,
      chip: "DONE",
    };
  }
  if (events.some((e) => e.type === "agent:start" && e.agent === agent)) {
    return { state: "ACTIVE", statusText: `${AGENT_DOING[agent] ?? "Analyzing"}…`, chip: "ANALYZING" };
  }
  // V0.2.2.2: if the run has already ended, a member that never started is
  // NOT_STARTED (e.g. cancelled mid-run) — never invented as a result.
  if (events.some((e) => e.type === "verdict" || e.type === "error")) {
    return { state: "WAITING", statusText: "Never started", chip: "NOT STARTED" };
  }
  return { state: "WAITING", statusText: "Awaiting assignment", chip: "WAITING" };
}

/**
 * COUNCIL V0.2.2.1 — the central Council node's visual state (Part 6).
 *
 * IDLE       — nothing underway yet (dim).
 * ACTIVE     — analysts are working (soft gold pulse).
 * PROMINENT  — comparison / stress-test / judge stages (the Council converges).
 * SETTLED    — a verdict has arrived (stable).
 */
export type ChamberNodeState = "IDLE" | "ACTIVE" | "PROMINENT" | "SETTLED";

/**
 * COUNCIL V0.2.2.1 — the agent→node connection lines' visual state (Part 7).
 *
 * OFF    — no chamber geometry (QUICK, or nothing convened yet).
 * FAINT  — thin warm-grey lines during independent analysis (agents isolated).
 * ACTIVE — gold + animated once comparison / deliberation begins (convergence).
 */
export type ChamberLineState = "OFF" | "FAINT" | "ACTIVE";

export interface ChamberState {
  node: ChamberNodeState;
  lines: ChamberLineState;
}

/**
 * Derived purely from received events + mode — never from animation timers.
 * QUICK has no chamber geometry at all (Part 5: the geometry is FULL/DEEP).
 */
export function chamberState(events: CouncilEvent[], mode: CouncilMode): ChamberState {
  if (mode === "QUICK") return { node: "IDLE", lines: "OFF" };

  if (events.some((e) => e.type === "verdict")) {
    return { node: "SETTLED", lines: "FAINT" };
  }

  const stage = deriveDeliberationStage(events, mode);
  const converging =
    stage === "comparing" ||
    stage === "devils_advocate" ||
    stage === "reassessing" ||
    stage === "judging";

  const lines: ChamberLineState = converging ? "ACTIVE" : "FAINT";

  let node: ChamberNodeState = "IDLE";
  if (converging) {
    node = "PROMINENT";
  } else if (stage === "analyzing") {
    // An analyst is ACTIVE until its own agent:done arrives.
    const anyActive = events.some(
      (e) =>
        e.type === "agent:start" &&
        !events.some((d) => d.type === "agent:done" && d.analysis.agent === e.agent),
    );
    node = anyActive ? "ACTIVE" : "IDLE";
  }

  return { node, lines };
}
