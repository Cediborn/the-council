import { describe, expect, it } from "vitest";
import {
  agentVisual,
  chamberState,
  deriveDeliberationStage,
  hasAnalysis,
  stagesForMode,
} from "@/lib/client/deliberation";
import type { AgentAnalysis, AgentKey, CouncilEvent, CouncilMode } from "@/lib/council/types";

const FOUR: AgentKey[] = ["reasoner", "skeptic", "practicalist", "perspective"];
const THREE: AgentKey[] = ["reasoner", "skeptic", "practicalist"];

const analysis: AgentAnalysis = {
  agent: "reasoner",
  name: "Reasoner",
  summary: "A considered analysis.",
  stance: "SUPPORT",
  keyPoints: ["point"],
  assumptions: [],
  risks: [],
  missingInformation: [],
  confidence: 70,
};

function convened(agents: AgentKey[], mode: CouncilMode): CouncilEvent {
  return {
    type: "convened",
    sessionId: "s-1",
    mode,
    agents,
    classification: { type: "decision", label: "Decision", capabilities: ["logical_reasoning"] },
    stage: "convened",
  };
}

function done(agent: AgentKey): CouncilEvent {
  return { type: "agent:done", analysis: { ...analysis, agent, name: agent }, stage: "analyzing" };
}

describe("deriveDeliberationStage — QUICK", () => {
  it("analyzing until all analysts are done", () => {
    const events: CouncilEvent[] = [
      convened(THREE, "QUICK"),
      { type: "agent:start", agent: "reasoner", name: "Reasoner", stage: "analyzing" },
    ];
    expect(deriveDeliberationStage(events, "QUICK")).toBe("analyzing");
  });

  it("jumps straight to judging when all analysts complete (no comparison stage)", () => {
    const events: CouncilEvent[] = [
      convened(THREE, "QUICK"),
      ...THREE.map(done),
    ];
    expect(deriveDeliberationStage(events, "QUICK")).toBe("judging");
  });

  it("stays judging until the verdict event", () => {
    const events: CouncilEvent[] = [
      convened(THREE, "QUICK"),
      ...THREE.map(done),
      { type: "stage", stage: "judging" },
    ];
    expect(deriveDeliberationStage(events, "QUICK")).toBe("judging");
  });
});

describe("deriveDeliberationStage — FULL", () => {
  it("analyzing → comparing once analysts are done", () => {
    const events: CouncilEvent[] = [convened(FOUR, "FULL"), ...FOUR.map(done)];
    expect(deriveDeliberationStage(events, "FULL")).toBe("comparing");
  });

  it("comparing when the comparing stage begins, even before the comparison result", () => {
    const events: CouncilEvent[] = [convened(FOUR, "FULL"), { type: "stage", stage: "comparing" }];
    expect(deriveDeliberationStage(events, "FULL")).toBe("comparing");
  });

  it("judging after the stage event", () => {
    const events: CouncilEvent[] = [
      convened(FOUR, "FULL"),
      { type: "stage", stage: "comparing" },
      {
        type: "comparison",
        comparison: {
          agreements: [],
          disagreements: [],
          contradictions: [],
          sharedAssumptions: [],
          missingInformation: [],
          risks: [],
          uniqueInsights: [],
          strongestArgument: "",
          weakestArgument: "",
          stanceCounts: { SUPPORT: 1, OPPOSE: 1, CONDITIONAL: 0, NEUTRAL: 2, INSUFFICIENT: 0 },
        },
        stage: "comparing",
      },
      { type: "stage", stage: "judging" },
    ];
    expect(deriveDeliberationStage(events, "FULL")).toBe("judging");
  });
});

describe("deriveDeliberationStage — DEEP", () => {
  it("walks the full deep pipeline: comparing → devils_advocate → reassessing → judging", () => {
    const events: CouncilEvent[] = [convened(FOUR, "DEEP"), ...FOUR.map(done)];
    expect(deriveDeliberationStage(events, "DEEP")).toBe("comparing");

    events.push({ type: "stage", stage: "devils_advocate" });
    expect(deriveDeliberationStage(events, "DEEP")).toBe("devils_advocate");

    events.push({
      type: "da:done",
      analysis: {
        agent: "devils_advocate",
        name: "Devil's Advocate",
        summary: "x",
        strongestArgument: "a",
        attemptToBreakIt: "b",
        unsupportedAssumptions: [],
        convergenceWarning: "",
        minorityPoint: "",
        evidenceThatWouldResolve: [],
      },
      stage: "devils_advocate",
    });
    expect(deriveDeliberationStage(events, "DEEP")).toBe("devils_advocate");

    events.push({ type: "stage", stage: "reassessing" });
    expect(deriveDeliberationStage(events, "DEEP")).toBe("reassessing");

    events.push({ type: "stage", stage: "judging" });
    expect(deriveDeliberationStage(events, "DEEP")).toBe("judging");
  });
});

describe("stagesForMode", () => {
  it("QUICK has no comparison", () => {
    expect(stagesForMode("QUICK")).toEqual(["analyzing", "judging", "complete"]);
  });
  it("FULL adds comparison", () => {
    expect(stagesForMode("FULL")).toEqual(["analyzing", "comparing", "judging", "complete"]);
  });
  it("DEEP adds challenge + reassessment", () => {
    expect(stagesForMode("DEEP")).toEqual([
      "analyzing",
      "comparing",
      "devils_advocate",
      "reassessing",
      "judging",
      "complete",
    ]);
  });
});

describe("agentVisual", () => {
  it("waiting → active → complete", () => {
    let events: CouncilEvent[] = [];
    expect(agentVisual(events, "reasoner").state).toBe("WAITING");

    events = [{ type: "agent:start", agent: "reasoner", name: "Reasoner", stage: "analyzing" }];
    expect(agentVisual(events, "reasoner").state).toBe("ACTIVE");
    expect(agentVisual(events, "reasoner").chip).toBe("ANALYZING");

    events = [{ type: "agent:done", analysis, stage: "analyzing" }];
    expect(agentVisual(events, "reasoner").state).toBe("COMPLETE");
    expect(agentVisual(events, "reasoner").chip).toBe("DONE");
  });

  it("failed when the analysis reports failure", () => {
    const events: CouncilEvent[] = [
      { type: "agent:done", analysis: { ...analysis, failed: true, error: "boom" }, stage: "analyzing" },
    ];
    expect(agentVisual(events, "reasoner").state).toBe("FAILED");
  });

  it("marks complete analyses as partial when degraded", () => {
    const events: CouncilEvent[] = [
      { type: "agent:done", analysis: { ...analysis, degraded: true }, stage: "analyzing" },
    ];
    expect(agentVisual(events, "reasoner").state).toBe("COMPLETE");
    expect(agentVisual(events, "reasoner").statusText).toContain("partial");
  });

  it("V0.2.2.2: attributes TIMED OUT distinctly from FAILED", () => {
    const timedOut: CouncilEvent[] = [
      {
        type: "agent:done",
        analysis: { ...analysis, failed: true, outcome: "TIMED_OUT", error: "timeout after 60s" },
        stage: "analyzing",
      },
    ];
    expect(agentVisual(timedOut, "reasoner").state).toBe("FAILED");
    expect(agentVisual(timedOut, "reasoner").chip).toBe("TIMED OUT");
    expect(agentVisual(timedOut, "reasoner").statusText).toMatch(/timed out/i);
  });

  it("V0.2.2.2: a member that never started after the run ended is NOT_STARTED", () => {
    const events: CouncilEvent[] = [
      { type: "agent:done", analysis, stage: "analyzing" },
      { type: "verdict", verdict: { verdict: "BUILD" } as never, usage: {} as never, stage: "complete" },
    ];
    expect(agentVisual(events, "skeptic").chip).toBe("NOT STARTED");
    expect(agentVisual(events, "skeptic").statusText).toMatch(/never started/i);
  });
});

describe("hasAnalysis", () => {
  it("detects a completed analysis", () => {
    expect(hasAnalysis([{ type: "agent:done", analysis, stage: "analyzing" }], "reasoner")).toBe(true);
    expect(hasAnalysis([], "reasoner")).toBe(false);
  });
});

describe("chamberState — V0.2.2.1", () => {
  it("QUICK has no chamber geometry at all", () => {
    expect(chamberState([], "QUICK")).toEqual({ node: "IDLE", lines: "OFF" });
    expect(chamberState([{ type: "stage", stage: "judging" }], "QUICK")).toEqual({
      node: "IDLE",
      lines: "OFF",
    });
  });

  it("FULL: node ACTIVE + lines FAINT while an analyst works", () => {
    const events: CouncilEvent[] = [
      convened(FOUR, "FULL"),
      { type: "agent:start", agent: "reasoner", name: "Reasoner", stage: "analyzing" },
    ];
    expect(chamberState(events, "FULL")).toEqual({ node: "ACTIVE", lines: "FAINT" });
  });

  it("FULL: node IDLE before any analyst starts", () => {
    expect(chamberState([convened(FOUR, "FULL")], "FULL")).toEqual({
      node: "IDLE",
      lines: "FAINT",
    });
  });

  it("FULL: node PROMINENT + lines ACTIVE once comparing begins", () => {
    const events: CouncilEvent[] = [convened(FOUR, "FULL"), ...FOUR.map(done)];
    expect(chamberState(events, "FULL")).toEqual({ node: "PROMINENT", lines: "ACTIVE" });
  });

  it("FULL: stays converged through judging", () => {
    const events: CouncilEvent[] = [
      convened(FOUR, "FULL"),
      ...FOUR.map(done),
      { type: "stage", stage: "comparing" },
      { type: "stage", stage: "judging" },
    ];
    expect(chamberState(events, "FULL")).toEqual({ node: "PROMINENT", lines: "ACTIVE" });
  });

  it("FULL: node SETTLED, lines settle once the verdict arrives", () => {
    const events: CouncilEvent[] = [
      convened(FOUR, "FULL"),
      ...FOUR.map(done),
      { type: "stage", stage: "judging" },
      { type: "verdict", verdict: { verdict: "BUILD" } as never, usage: {} as never, stage: "complete" },
    ];
    expect(chamberState(events, "FULL")).toEqual({ node: "SETTLED", lines: "FAINT" });
  });

  it("DEEP: lines stay ACTIVE through the stress-test and reassessment", () => {
    const events: CouncilEvent[] = [
      convened(FOUR, "DEEP"),
      ...FOUR.map(done),
      { type: "stage", stage: "devils_advocate" },
      { type: "stage", stage: "reassessing" },
    ];
    expect(chamberState(events, "DEEP").node).toBe("PROMINENT");
    expect(chamberState(events, "DEEP").lines).toBe("ACTIVE");
  });
});
