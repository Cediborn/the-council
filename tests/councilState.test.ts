import { describe, expect, it } from "vitest";
import {
  completedAnalyses,
  councilReducer,
  initialCouncilState,
  isSessionActive,
  type CouncilState,
} from "@/lib/client/councilState";
import type { AgentAnalysis, CouncilEvent, CouncilVerdict } from "@/lib/council/types";

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
  summary: "A solid proposal.",
  strongestArgumentFor: "market fit",
  strongestArgumentAgainst: "competition",
  keyAgreements: [],
  keyDisagreements: [],
  criticalAssumptions: [],
  criticalRisks: [],
  recommendedAction: "Proceed.",
  whatWouldChangeTheVerdict: [],
  reasoning: "Weighing evidence.",
  whyThisVerdictWon: "The strongest argument survived scrutiny.",
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
  analysis: { ...analysis, agent: "skeptic", name: "Skeptic", failed: true, error: "boom" },
  stage: "analyzing",
};

const verdictEvent: CouncilEvent = {
  type: "verdict",
  verdict,
  usage: {
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
  },
  stage: "complete",
};

function runningState(): CouncilState {
  let s = councilReducer(initialCouncilState(), { type: "SUBMIT", question: "Q?", mode: "FULL" });
  s = councilReducer(s, { type: "EVENT", event: convenedEvent });
  return s;
}

describe("councilReducer — lifecycle (Part 2)", () => {
  it("idle → submitting → running → complete", () => {
    let s = councilReducer(initialCouncilState(), { type: "SUBMIT", question: "Q?", mode: "FULL" });
    expect(s.phase).toBe("submitting");
    s = councilReducer(s, { type: "EVENT", event: convenedEvent });
    expect(s.phase).toBe("running");
    expect(s.sessionId).toBe("sess-1");
    s = councilReducer(s, { type: "EVENT", event: verdictEvent });
    expect(s.phase).toBe("complete");
    expect(s.history).toHaveLength(1);
    expect(s.history[0].status).toBe("complete");
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
  });
});

describe("councilReducer — duplicate submissions (Part 17)", () => {
  it("ignores a SUBMIT while a session is active", () => {
    const s = runningState();
    const next = councilReducer(s, { type: "SUBMIT", question: "Another?", mode: "QUICK" });
    expect(next).toBe(s); // unchanged reference — duplicate blocked
    expect(next.phase).toBe("running");
  });

  it("allows a new submit after completion", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: verdictEvent });
    const next = councilReducer(s, { type: "SUBMIT", question: "Next?", mode: "QUICK" });
    expect(next.phase).toBe("submitting");
    expect(next.question).toBe("Next?");
  });
});

describe("councilReducer — error recovery (Part 1: no refresh required)", () => {
  it("handles an error with ZERO events (network failure before any SSE frame)", () => {
    const s = councilReducer(initialCouncilState(), { type: "SUBMIT", question: "Q?", mode: "QUICK" });
    const next = councilReducer(s, {
      type: "STREAM_ERROR",
      message: "Unable to connect to the local model. Make sure Ollama is running.",
    });
    expect(next.phase).toBe("error");
    expect(next.error).toContain("Ollama");
    // The user can immediately retry — no refresh needed.
    const retried = councilReducer(next, { type: "SUBMIT", question: "Q?", mode: "QUICK" });
    expect(retried.phase).toBe("submitting");
  });

  it("preserves completed analyses on stream interruption (Part 4/5)", () => {
    let s = runningState();
    s = councilReducer(s, { type: "EVENT", event: agentDone });
    s = councilReducer(s, { type: "EVENT", event: agentFailed });
    const next = councilReducer(s, {
      type: "STREAM_ERROR",
      message: "The Council stream ended before a verdict was reached.",
    });
    expect(next.phase).toBe("error");
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
    expect(next.phase).toBe("error");
    expect(next.history[0].status).toBe("error");
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
    expect(next.phase).toBe("submitting");
    expect(next.question).toBe("Fresh?");
  });

  it("does not cancel an idle state", () => {
    const next = councilReducer(initialCouncilState(), { type: "CANCEL" });
    expect(next.phase).toBe("idle");
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

describe("isSessionActive", () => {
  it("is true only for submitting/running", () => {
    expect(isSessionActive("submitting")).toBe(true);
    expect(isSessionActive("running")).toBe(true);
    expect(isSessionActive("idle")).toBe(false);
    expect(isSessionActive("error")).toBe(false);
    expect(isSessionActive("complete")).toBe(false);
    expect(isSessionActive("cancelled")).toBe(false);
  });
});
