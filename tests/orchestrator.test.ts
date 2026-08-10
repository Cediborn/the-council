import { describe, expect, it } from "vitest";
import { runCouncil } from "@/lib/council/orchestrator";
import type { ModelProvider, ProviderChatInput, ProviderChatResult } from "@/lib/council/providers";
import type { CouncilEvent } from "@/lib/council/types";

function makeProvider(
  responses: (input: ProviderChatInput) => string,
  failFirstN = 0,
  opts?: { abort?: boolean },
): ModelProvider {
  let calls = 0;
  return {
    id: "mock",
    model: "mock-model",
    async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
      if (opts?.abort && input.signal?.aborted) {
        throw new Error("aborted");
      }
      calls += 1;
      if (calls <= failFirstN) throw new Error("provider down");
      return { content: responses(input), usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
}

const agentJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: "A considered analysis.",
    stance: "SUPPORT",
    keyPoints: ["point one", "point two"],
    assumptions: ["assumption"],
    risks: ["risk"],
    missingInformation: ["unknown"],
    confidence: 70,
    ...overrides,
  });

const comparisonJson = JSON.stringify({
  agreements: [{ topic: "topic", agents: ["Reasoner"], summary: "agree" }],
  disagreements: [],
  sharedAssumptions: ["shared"],
  // V0.2.1: strongest/weakest argument fields.
  strongestArgument: "demand is real",
  weakestArgument: "the brand comparison",
  stanceCounts: { SUPPORT: 3, OPPOSE: 0, CONDITIONAL: 0, NEUTRAL: 0, INSUFFICIENT: 0 },
});

const daJson = JSON.stringify({
  summary: "stress test",
  strongestArgument: "strong",
  attemptToBreakIt: "break",
  unsupportedAssumptions: ["a"],
  convergenceWarning: "",
  minorityPoint: "",
  evidenceThatWouldResolve: ["evidence"],
});

const reassessmentJson = JSON.stringify({
  summary: "the stress test hardened the core argument",
  shift: "WEAKENED",
  hardened: ["core feasibility argument"],
  weakened: ["the demand assumption"],
  positionChanges: [{ agent: "Skeptic", from: "OPPOSE", to: "CONDITIONAL" }],
  judgeGuidance: "weigh feasibility more heavily",
});

const verdictJson = JSON.stringify({
  verdict: "BUILD",
  score: 8,
  confidence: 85,
  summary: "A solid proposal.",
  strongestArgumentFor: "market fit",
  strongestArgumentAgainst: "competition",
  keyAgreements: ["a"],
  keyDisagreements: ["b"],
  criticalAssumptions: ["c"],
  criticalRisks: ["d"],
  recommendedAction: "Proceed with a pilot.",
  whatWouldChangeTheVerdict: ["new data"],
  reasoning: "Weighing evidence, the case is strong.",
  whyThisVerdictWon: "The market-fit argument survived scrutiny.",
});

async function collect(events: AsyncGenerator<CouncilEvent>): Promise<CouncilEvent[]> {
  const out: CouncilEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("runCouncil — QUICK mode", () => {
  it("produces a verdict with 3 analytical agents + judge", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return verdictJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "QUICK", question: "Should I buy this phone?", provider }),
    );

    const convened = events.find((e) => e.type === "convened");
    expect(convened?.type).toBe("convened");
    if (convened?.type === "convened") {
      expect(convened.agents).toHaveLength(3);
    }

    const done = events.filter((e) => e.type === "agent:done");
    expect(done.length).toBe(3); // 3 analysts (the judge arrives via the verdict event)

    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.verdict).toBe("BUILD");
      expect(verdict.verdict.score).toBe(8);
      expect(verdict.usage.mode).toBe("QUICK");
      expect(verdict.usage.success).toBe(true);
      expect(verdict.usage.agentCalls).toBe(4);
    }
  });

  it("does not run comparison or devil's advocate in QUICK", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return verdictJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "QUICK", question: "Is this a good idea?", provider }),
    );
    expect(events.some((e) => e.type === "comparison")).toBe(false);
    expect(events.some((e) => e.type === "da:done")).toBe(false);
  });
});

describe("runCouncil — FULL mode", () => {
  it("runs 4 analysts + comparison + judge", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return verdictJson;
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Should I start a business?", provider }),
    );

    const done = events.filter((e) => e.type === "agent:done");
    expect(done.length).toBe(4);

    const comparison = events.find((e) => e.type === "comparison");
    expect(comparison?.type).toBe("comparison");
    if (comparison?.type === "comparison") {
      expect(comparison.comparison.agreements).toHaveLength(1);
      // V0.2.1: strongest/weakest argument flow through the comparison event.
      expect(comparison.comparison.strongestArgument).toBe("demand is real");
      expect(comparison.comparison.weakestArgument).toBe("the brand comparison");
    }

    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") expect(verdict.usage.agentCalls).toBe(6); // 4 + comparer + judge
  });
});

describe("runCouncil — DEEP mode", () => {
  it("runs 4 analysts + comparison + devil's advocate + reassessment + judge", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return verdictJson;
      if (input.system.includes("COMPARER")) return comparisonJson;
      if (input.system.includes("DEVIL'S ADVOCATE")) return daJson;
      if (input.system.includes("REASSESSOR")) return reassessmentJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "DEEP", question: "Should I change careers?", provider }),
    );

    const da = events.find((e) => e.type === "da:done");
    expect(da?.type).toBe("da:done");
    if (da?.type === "da:done") {
      expect(da.analysis.strongestArgument).toBe("strong");
      expect(da.analysis.attemptToBreakIt).toBe("break");
    }

    const reassessment = events.find((e) => e.type === "reassessment:done");
    expect(reassessment?.type).toBe("reassessment:done");
    if (reassessment?.type === "reassessment:done") {
      expect(reassessment.analysis.hardened).toContain("core feasibility argument");
      expect(reassessment.analysis.positionChanges[0].to).toBe("CONDITIONAL");
      // V0.2.1: the stress-test shift flows through (Part 21).
      expect(reassessment.analysis.shift).toBe("WEAKENED");
    }

    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") expect(verdict.usage.agentCalls).toBe(8); // 4 + comparer + da + reassessor + judge
  });

  it("skips reassessment when the devil's advocate fails", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return verdictJson;
      if (input.system.includes("COMPARER")) return comparisonJson;
      if (input.system.includes("DEVIL'S ADVOCATE")) throw new Error("da down");
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "DEEP", question: "Should I change careers?", provider }),
    );
    expect(events.some((e) => e.type === "da:done" && e.analysis.failed)).toBe(true);
    expect(events.some((e) => e.type === "reassessment:done")).toBe(false);
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
  });
});

describe("runCouncil — resilience", () => {
  it("continues when one analyst fails and the judge is told", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        calls += 1;
        // The Reasoner always fails (even after retry); everyone else succeeds.
        if (input.system.includes("REASONER")) throw new Error("boom");
        if (input.system.includes("JUDGE"))
          return { content: verdictJson, usage: { inputTokens: 10, outputTokens: 20 } };
        if (input.system.includes("COMPARER"))
          return { content: comparisonJson, usage: { inputTokens: 10, outputTokens: 20 } };
        return { content: agentJson(), usage: { inputTokens: 10, outputTokens: 20 } };
      },
    };

    const events = await collect(
      runCouncil({ mode: "FULL", question: "A hard question", provider }),
    );

    const done = events.filter((e) => e.type === "agent:done");
    expect(done.some((d) => d.analysis.failed)).toBe(true);

    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.usage.failedAgentCalls).toBeGreaterThanOrEqual(1);
      expect(verdict.usage.success).toBe(true);
    }
  });

  it("throws CouncilRunError when every analyst fails", async () => {
    const provider = makeProvider(() => "irrelevant", 99);
    await expect(async () => {
      for await (const _ of runCouncil({ mode: "FULL", question: "x", provider })) {
        // drain
      }
    }).rejects.toThrow(/Every analytical agent failed/);
  });

  it("never counts votes when the judge returns prose — returns INSUFFICIENT_INFORMATION", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return "I think this is a fine idea overall, yes.";
      if (input.system.includes("COMPARER")) return comparisonJson;
      // All agents support the idea — a vote count would say BUILD.
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Is this a good idea?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.degraded).toBe(true);
      // Part 11: the Council does not vote. A broken Judge cannot be replaced
      // by stance counting — it yields INSUFFICIENT_INFORMATION, honestly.
      expect(verdict.verdict.verdict).toBe("INSUFFICIENT_INFORMATION");
      expect(verdict.verdict.reasoning).toMatch(/degraded/i);
    }
  });

  it("returns an explicitly degraded INSUFFICIENT_INFORMATION verdict when the judge throws", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) throw new Error("judge crash");
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Is this a good idea?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.verdict).toBe("INSUFFICIENT_INFORMATION");
    }
  });

  it("injects per-agent capability emphasis into every analytical prompt (V0.2.1 Part 5)", async () => {
    const calls: { system: string; user: string }[] = [];
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        calls.push({ system: input.system, user: input.user });
        if (input.system.includes("JUDGE")) return { content: verdictJson, usage: { inputTokens: 10, outputTokens: 20 } };
        if (input.system.includes("COMPARER")) return { content: comparisonJson, usage: { inputTokens: 10, outputTokens: 20 } };
        return { content: agentJson(), usage: { inputTokens: 10, outputTokens: 20 } };
      },
    };

    await collect(runCouncil({ mode: "FULL", question: "Should I buy this phone?", provider }));

    const analytical = calls.filter((c) => !c.system.includes("JUDGE") && !c.system.includes("COMPARER"));
    expect(analytical).toHaveLength(4);
    // Every analyst sees the classification label and its own emphasis.
    for (const c of analytical) {
      expect(c.user).toContain("Decision");
      expect(c.user).toMatch(/Your capabilities most relevant here/);
    }
    // The skeptic is told its assumption-testing lens matters for a decision.
    const skeptic = analytical.find((c) => c.system.includes("SKEPTIC"));
    expect(skeptic?.user).toContain("Assumption testing");
    // The perspective agent is told its alternative-perspectives lens is relevant.
    const perspective = analytical.find((c) => c.system.includes("PERSPECTIVE"));
    expect(perspective?.user).toContain("Alternative perspectives");

    // A purely mathematical question has no overlap with the perspective lens,
    // so it gets the honest "keep it brief" emphasis instead.
    calls.length = 0;
    await collect(runCouncil({ mode: "FULL", question: "Why is the derivative of sqrt(x) equal to 1/(2sqrt(x))?", provider }));
    const mathPerspective = calls.find((c) => c.system.includes("PERSPECTIVE"));
    expect(mathPerspective?.user).toMatch(/not the central one/i);
  });

  it("honors aborted signals", async () => {
    const controller = new AbortController();
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        if (input.signal?.aborted) throw new Error("aborted");
        controller.abort();
        return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    await expect(async () => {
      for await (const _ of runCouncil({ mode: "QUICK", question: "x", provider, signal: controller.signal })) {
        // drain
      }
    }).rejects.toThrow();
  });

  // ── V0.2.2.1 (Part 2/3): the Judge-failure matrix — every failure mode
  // yields INSUFFICIENT_INFORMATION, never a stance-counted verdict. ──────

  it("returns degraded INSUFFICIENT_INFORMATION when the judge emits malformed JSON — never counts stances", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return '{ verdict: "BUILD", score: "eight" , ';
      if (input.system.includes("COMPARER")) return comparisonJson;
      // All analysts SUPPORT — a vote count would produce BUILD.
      return agentJson({ stance: "SUPPORT" });
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Is this a good idea?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.verdict).toBe("INSUFFICIENT_INFORMATION");
      expect(verdict.verdict.score).toBe(0);
      expect(verdict.verdict.reasoning).toMatch(/degraded/i);
      // The surviving analyses are preserved on the verdict (they are the
      // input to the fallback), and no BUILD is fabricated from the votes.
      expect(verdict.verdict.summary).not.toMatch(/BUILD/i);
    }
  });

  it("returns degraded INSUFFICIENT_INFORMATION when the judge times out", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) throw new Error("timeout after 60s");
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Is this a good idea?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.verdict).toBe("INSUFFICIENT_INFORMATION");
      expect(verdict.usage.failedAgentCalls).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns degraded INSUFFICIENT_INFORMATION when the judge returns an empty response", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return "";
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Is this a good idea?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.verdict).toBe("INSUFFICIENT_INFORMATION");
      expect(verdict.verdict.recommendedAction).toMatch(/Retry|check/i);
    }
  });

  it("preserves completed analyses when the run throws a CouncilRunError", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("REASONER")) throw new Error("reasoner down");
      if (input.system.includes("SKEPTIC")) throw new Error("skeptic down");
      if (input.system.includes("PRACTICALIST")) throw new Error("practicalist down");
      if (input.system.includes("PERSPECTIVE")) throw new Error("perspective down");
      return agentJson();
    });
    let thrown: unknown;
    try {
      for await (const _ of runCouncil({ mode: "FULL", question: "x", provider })) {
        // drain
      }
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const err = thrown as { name?: string; analyses?: unknown[]; message?: string };
    expect(err.name).toBe("CouncilRunError");
    expect(err.analyses).toBeDefined();
  });
});
