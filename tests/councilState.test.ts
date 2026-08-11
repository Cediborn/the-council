import { describe, expect, it } from "vitest";
import {
  completedAnalyses,
  councilReducer,
  initialCouncilState,
  isSessionActive,
  memberOutcomes,
  type CouncilState,
} from "@/lib/client/councilState";
import type { AgentAnalysis, CouncilEvent, CouncilUsage, CouncilVerdict } from "@/lib/council/types";

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

const verdict: CouncilVerdict = {
  verdict: "BUILD",
  score: 8,
  confidence: 85,
  informationSufficiency: "MEDIUM",
  summary: "A solid proposal.",
  keyReasons: ["market fit"],
  agreements: [],
  disagreements: [],
  criticalUnknowns: [],
  assumptions: [],
  risks: [],
  recommendedAction: "Proceed.",
  whatWouldChangeVerdict: [],
  reasoning: "Weighing evidence.",
  whyThisVerdictWon: "The strongest argument survived scrutiny.",
  strongestArgumentFor: "market fit",
  strongestArgumentAgainst: "competition",
};

const degradedVerdict: CouncilVerdict = {
  ...verdict,
  verdict: "INSUFFICIENT_INFORMATION",
  score: 0,
  confidence: 10,
  degraded: true,
  provisional: true,
};

const convenedEvent: CouncilEvent = {
  type: "convened",
  sessionId: "sess-1",
  mode: "FULL",
  agents: ["reasoner", "skeptic", "practicalist", "perspective"],
  classification: { type: "decision", label: "Decision", capabilities: ["logical_reasoning"] },
  stage: "convened",
};

const agentDone: CouncilEvent = {
  type: "agent:done",
  analysis,
  stage: "analyzing",
};

const agentFailed: CouncilEvent = {
  type: "agent:done",
  analysis: { ...analysis, agent: "skeptic", name: "Skeptic", failed: true, error: "boom", outcome: "FAILED" },
  stage: "analyzing",
};

function usageFor(): CouncilUsage {
  return {
    sessionId: "sess-1",
    mode: "FULL",
    agentCalls: 5,
    failedAgentCalls: 0,
    model: "m",
    provider: "ollama",
    inputTokens: 1,
    outputTokens: 1,
    durationMs: 10,
    success: true,
    questionLength: 10,
    startedAt: "now",
    stageDurations: { analysisMs: 1, comparisonMs: 1, devilsAdvocateMs: 0, reassessmentMs: 0, judgeMs: 1, understandingMs: 0, directAnswerMs: 0 },
    agentDurations: { reasoner: 1 },
  };
}

const verdictEvent: CouncilEvent = {
  type: "verdict",
  verdict,
  usage: usageFor(),
  stage: "complete",
};

const degradedVerdictEvent: CouncilEvent = {
  type: "verdict",
  verdict: degradedVerdict,
  usage: usageFor(),
  stage: "complete",
};

function runningState(): CouncilState {
  let s = councilReducer(initialCouncilState(), { type: "SUBMIT", question: "Q?", mode: "FULL" });
  s = councilReducer(s, { type: "EVENT", event: convenedEvent });
  return s;
}

describe("councilReducer — lifecycle (Part 2/5)", () => {
  it("idle → analyzing → complete", () => {
    let s = councilReducer(initialCouncilState(), { type: "SUBMIT", question: "Q?", mode: "FULL" });
    expect(s.phase).toBe("analyzing");
    s = councilReducer(s, { type: "EVENT", event: convenedEvent });
    expect(s.phase).toBe("analyzing");
    expect(s.sessionId).toBe("sess-1");
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    expect(s.phase).toBe("analyzing");
    s = councilReducer(s, { type: "EVENT", event: verdictEvent });
    expect(s.phase).toBe("complete");
    expect(s.history).toHaveLength(1);
    expect(s.history[0].status).toBe("complete");
  });

  it("reaches council_complete once every member settled, then judging", () => {
    let s = runningState();
    for (const a of convenedEvent.agents) {
      s = councilReducer(s, {
        type: "EVENT",
        event: { type: "agent:done", analysis: { ...analysis, agent: a, name: a }, stage: "analyzing" },
      });
    }
    expect(s.phase).toBe("council_complete");
    s = councilReducer(s, { type: "EVENT", event: { type: "stage", stage: "judging" } });
    expect(s.phase).toBe("judging");
  });

  it("reaches partial_results when one member fails while another completed", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    s = councilReducer(s, { type: "EVENT", event: agentFailed });
    expect(s.phase).toBe("partial_results");
  });

  it("records the session in history (Part 18)", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    s = councilReducer(s, { type: "EVENT", event: verdictEvent });
    expect(s.history[0]).toMatchObject({
      id: "sess-1",
      question: "Q?",
      mode: "FULL",
      status: "complete",
    });
    expect(s.history[0].completedAgents).toEqual(["Reasoner"]);
    expect(s.history[0].memberOutcomes.reasoner).toBe("COMPLETED");
  });

  it("enters the DEGRADED phase for a degraded verdict — never a pretend success", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    s = councilReducer(s, { type: "EVENT", event: degradedVerdictEvent });
    expect(s.phase).toBe("degraded");
    expect(s.history[0].status).toBe("degraded");
  });
});

describe("councilReducer — duplicate submissions (Part 17)", () => {
  it("ignores a SUBMIT while a session is active", () => {
    const s = runningState();
    const next = councilReducer(s, { type: "SUBMIT", question: "Another?", mode: "QUICK" });
    expect(next).toBe(s); // unchanged reference — duplicate blocked
    expect(next.phase).toBe("analyzing");
  });

  it("allows a new submit after completion", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: verdictEvent });
    const next = councilReducer(s, { type: "SUBMIT", question: "Next?", mode: "QUICK" });
    expect(next.phase).toBe("analyzing");
    expect(next.question).toBe("Next?");
  });
});

describe("councilReducer — failure recovery (Part 1: no refresh required)", () => {
  it("handles a stream error with ZERO events (network failure before any SSE frame)", () => {
    const s = councilReducer(initialCouncilState(), { type: "SUBMIT", question: "Q?", mode: "QUICK" });
    const next = councilReducer(s, {
      type: "STREAM_ERROR",
      message: "Unable to connect to the local model. Make sure Ollama is running.",
    });
    expect(next.phase).toBe("failed");
    expect(next.error).toContain("Ollama");
    // The user can immediately retry — no refresh needed.
    const retried = councilReducer(next, { type: "SUBMIT", question: "Q?", mode: "QUICK" });
    expect(retried.phase).toBe("analyzing");
  });

  it("preserves completed analyses on stream interruption (Part 4/5)", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    s = councilReducer(s, { type: "EVENT", event: agentFailed });
    const next = councilReducer(s, {
      type: "STREAM_ERROR",
      message: "The Council stream ended before a verdict was reached.",
    });
    expect(next.phase).toBe("failed");
    expect(next.events).toHaveLength(3); // convened + done + failed — nothing erased
    expect(completedAnalyses(next.events).map((a) => a.agent)).toEqual(["reasoner"]);
  });

  it("handles an explicit error event from the server", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    const errEvent: CouncilEvent = {
      type: "error",
      message: "Every analytical agent failed.",
      stage: "failed",
      analyses: [],
    };
    const next = councilReducer(s, { type: "EVENT", event: errEvent });
    expect(next.phase).toBe("failed");
    expect(next.history[0].status).toBe("failed");
  });
});

describe("councilReducer — cancellation (Part 3)", () => {
  it("moves to cancelled and records the session", () => {
    const s = runningState();
    const next = councilReducer(s, { type: "CANCEL" });
    expect(next.phase).toBe("cancelled");
    expect(next.history[0].status).toBe("cancelled");
  });

  it("allows a new question immediately after cancel", () => {
    const s = runningState();
    const cancelled = councilReducer(s, { type: "CANCEL" });
    const next = councilReducer(cancelled, { type: "SUBMIT", question: "Fresh?", mode: "DEEP" });
    expect(next.phase).toBe("analyzing");
    expect(next.question).toBe("Fresh?");
  });

  it("does not cancel an idle state", () => {
    const next = councilReducer(initialCouncilState(), { type: "CANCEL" });
    expect(next.phase).toBe("idle");
  });
});

describe("councilReducer — resume (Part 5)", () => {
  it("re-enters analyzing, keeps analyses, strips terminal/downstream events", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    s = councilReducer(s, { type: "EVENT", event: agentFailed });
    s = councilReducer(s, { type: "EVENT", event: { type: "stage", stage: "comparing" } });
    s = councilReducer(s, { type: "EVENT", event: degradedVerdictEvent });

    const next = councilReducer(s, { type: "RESUME", retryAgent: "skeptic" });
    expect(next.phase).toBe("analyzing");
    expect(next.error).toBeNull();
    // Downstream + terminal events removed; analyses kept.
    expect(next.events.some((e) => e.type === "verdict")).toBe(false);
    expect(next.events.some((e) => e.type === "stage")).toBe(false);
    expect(next.events.filter((e) => e.type === "agent:done").length).toBe(2);
  });

  it("does not resume while a session is active", () => {
    const s = runningState();
    const next = councilReducer(s, { type: "RESUME", retryAgent: "skeptic" });
    expect(next).toBe(s);
  });
});

describe("councilReducer — restore (TEST 6)", () => {
  it("reopens a persisted session into the correct phase", () => {
    const stored = {
      version: 1 as const,
      sessionId: "sess-9",
      question: "Old question?",
      mode: "FULL" as const,
      startedAt: 123,
      status: "complete" as const,
      verdict,
      events: [convenedEvent, agentDone, verdictEvent],
    };
    const next = councilReducer(initialCouncilState(), { type: "RESTORE", session: stored });
    expect(next.phase).toBe("complete");
    expect(next.question).toBe("Old question?");
    expect(next.sessionId).toBe("sess-9");
    expect(next.events).toHaveLength(3);

    const degraded = councilReducer(initialCouncilState(), {
      type: "RESTORE",
      session: { ...stored, status: "degraded", verdict: degradedVerdict, events: [convenedEvent, agentDone, degradedVerdictEvent] },
    });
    expect(degraded.phase).toBe("degraded");
  });
});

describe("councilReducer — reset (Part 2)", () => {
  it("resets fully to idle", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: verdictEvent });
    const next = councilReducer(s, { type: "RESET" });
    expect(next).toEqual(initialCouncilState());
  });
});

describe("completedAnalyses", () => {
  it("returns only non-failed analyses", () => {
    const events: CouncilEvent[] = [agentDone, agentFailed];
    const result = completedAnalyses(events);
    expect(result).toHaveLength(1);
    expect(result[0].agent).toBe("reasoner");
  });
});

describe("memberOutcomes (Part 10)", () => {
  it("attributes COMPLETED / FAILED / NOT_STARTED per member", () => {
    const events: CouncilEvent[] = [convenedEvent, agentDone, agentFailed];
    const outcomes = memberOutcomes(events, convenedEvent.agents);
    expect(outcomes.reasoner).toBe("COMPLETED");
    expect(outcomes.skeptic).toBe("FAILED");
    expect(outcomes.practicalist).toBe("NOT_STARTED");
    expect(outcomes.perspective).toBe("NOT_STARTED");
  });

  it("attributes TIMED_OUT from the analysis outcome", () => {
    const timedOut: CouncilEvent = {
      type: "agent:done",
      analysis: { ...analysis, agent: "practicalist", name: "Practicalist", failed: true, outcome: "TIMED_OUT", error: "timeout" },
      stage: "analyzing",
    };
    const outcomes = memberOutcomes([convenedEvent, timedOut], ["practicalist"]);
    expect(outcomes.practicalist).toBe("TIMED_OUT");
  });
});

describe("isSessionActive", () => {
  it("is true only for the active phases", () => {
    expect(isSessionActive("analyzing")).toBe(true);
    expect(isSessionActive("partial_results")).toBe(true);
    expect(isSessionActive("council_complete")).toBe(true);
    expect(isSessionActive("judging")).toBe(true);
    expect(isSessionActive("idle")).toBe(false);
    expect(isSessionActive("complete")).toBe(false);
    expect(isSessionActive("degraded")).toBe(false);
    expect(isSessionActive("failed")).toBe(false);
    expect(isSessionActive("cancelled")).toBe(false);
  });
});
