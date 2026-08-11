import { describe, expect, it } from "vitest";
import { runCouncil } from "@/lib/council/orchestrator";
import type { ModelProvider, ProviderChatInput, ProviderChatResult } from "@/lib/council/providers";
import type { AgentAnalysis, CouncilEvent, CouncilVerdict } from "@/lib/council/types";

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
  informationSufficiency: "HIGH",
  summary: "A solid proposal.",
  keyReasons: ["market fit"],
  agreements: ["a"],
  disagreements: ["b"],
  criticalUnknowns: ["c"],
  assumptions: ["d"],
  risks: ["e"],
  recommendedAction: "Proceed with a pilot.",
  whatWouldChangeVerdict: ["new data"],
  reasoning: "Weighing evidence, the case is strong.",
  whyThisVerdictWon: "The market-fit argument survived scrutiny.",
  strongestArgumentFor: "market fit",
  strongestArgumentAgainst: "competition",
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
      // 3 analysts + understander (the injected mock provider is not Ollama,
      // so the V0.3 understanding stage runs) + judge.
      expect(verdict.usage.agentCalls).toBe(5);
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
    if (verdict?.type === "verdict") expect(verdict.usage.agentCalls).toBe(7); // 4 + understander + comparer + judge
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
    if (verdict?.type === "verdict") expect(verdict.usage.agentCalls).toBe(9); // 4 + understander + comparer + da + reassessor + judge
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

  it("never counts votes when the judge returns prose — synthesizes a PROVISIONAL verdict", async () => {
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
      // V0.2.2.2: a broken Judge is NOT replaced by stance counting. The result
      // is explicitly degraded + provisional and never a full BUILD even though
      // every analyst supported the idea.
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.provisional).toBe(true);
      expect(verdict.verdict.verdict).not.toBe("BUILD");
      expect(verdict.verdict.reasoning).toMatch(/degraded|provisional/i);
    }
  });

  it("returns a PROVISIONAL synthesized verdict when the judge throws", async () => {
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
      expect(verdict.verdict.provisional).toBe(true);
      expect(verdict.verdict.summary).toMatch(/provisional/i);
    }
  });

  // ── V0.2.2.3 (Parts 2-3): a *working* Judge that returns INSUFFICIENT_INFORMATION
  // must NOT be accepted as a normal dead-end verdict. It is no longer in any
  // type's allowed set, so the orchestrator routes it to the deterministic
  // synthesizer — the user gets a useful provisional verdict instead. ────────

  it("V0.2.2.3: Judge returning INSUFFICIENT_INFORMATION is routed to a PROVISIONAL verdict — never a dead end, never stance-counted", async () => {
    const insufficient = JSON.stringify({
      verdict: "INSUFFICIENT_INFORMATION",
      score: 0,
      confidence: 20,
      informationSufficiency: "LOW",
      summary: "I do not have enough information to decide.",
      keyReasons: [],
      agreements: [],
      disagreements: [],
      criticalUnknowns: ["market size"],
      assumptions: [],
      risks: [],
      recommendedAction: "Get more information.",
      whatWouldChangeVerdict: ["more data"],
      reasoning: "Not enough information.",
      whyThisVerdictWon: "",
      strongestArgumentFor: "unknown",
      strongestArgumentAgainst: "unknown",
    });
    const provider = makeProvider((input) => {
      // Even though EVERY analyst supports the idea, the Judge copping out with
      // INSUFFICIENT_INFORMATION must not end the session in a dead end — and
      // must not be turned into a stance-counted BUILD either.
      if (input.system.includes("JUDGE")) return insufficient;
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson({ stance: "SUPPORT" });
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Should I build this app?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      // The dead-end category must NOT survive as a normal result.
      expect(verdict.verdict.verdict).not.toBe("INSUFFICIENT_INFORMATION");
      // It is an explicit degraded + provisional synthesis, not a vote count.
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.provisional).toBe(true);
      expect(verdict.verdict.verdict).not.toBe("BUILD");
      // The synthesis still reports sufficiency honestly (driven by the actual
      // unknowns across the surviving analyses, not inflated).
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(verdict.verdict.informationSufficiency);
    }
  });

  it("V0.2.2.3: general-set question whose Judge says INSUFFICIENT_INFORMATION still gets a type-appropriate provisional verdict", async () => {
    // "Why is the sky blue?" classifies as EXPLANATION (V0.3 per-type sets),
    // so the provisional verdict must come from the explanation set.
    const insufficient = JSON.stringify({
      verdict: "INSUFFICIENT_INFORMATION",
      score: 0,
      confidence: 15,
      informationSufficiency: "LOW",
      summary: "I cannot decide.",
      keyReasons: [],
      agreements: [],
      disagreements: [],
      criticalUnknowns: [],
      assumptions: [],
      risks: [],
      recommendedAction: "Ask later.",
      whatWouldChangeVerdict: [],
      reasoning: "Not enough.",
      whyThisVerdictWon: "",
      strongestArgumentFor: "unknown",
      strongestArgumentAgainst: "unknown",
    });
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return insufficient;
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Why is the sky blue?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.verdict).not.toBe("INSUFFICIENT_INFORMATION");
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.provisional).toBe(true);
      // Explanation set (V0.3) — the provisional ceiling is UNRESOLVED, never
      // a product-only category like BUILD_MVP/PIVOT/DO_NOT_BUILD.
      expect(["REFUTED", "PARTIALLY_SUPPORTED", "UNRESOLVED"].includes(verdict.verdict.verdict)).toBe(true);
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

    // The V0.3 understander call is NOT an analytical agent — exclude it.
    const analytical = calls.filter(
      (c) =>
        !c.system.includes("JUDGE") &&
        !c.system.includes("COMPARER") &&
        !c.system.includes("question-understander"),
    );
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

  it("synthesizes a PROVISIONAL verdict from malformed judge JSON — never a stance-counted BUILD", async () => {
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
      expect(verdict.verdict.provisional).toBe(true);
      expect(verdict.verdict.reasoning).toMatch(/degraded|provisional/i);
      // Even though every analyst SUPPORTed, the synthesizer reads reasoning
      // content (one risk per analysis) — it must NOT hand out a full BUILD.
      expect(verdict.verdict.verdict).not.toBe("BUILD");
      expect(verdict.verdict.verdict).not.toBe("INSUFFICIENT_INFORMATION");
    }
  });

  it("synthesizes a PROVISIONAL verdict when the judge times out", async () => {
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
      expect(verdict.verdict.provisional).toBe(true);
      expect(verdict.usage.failedAgentCalls).toBeGreaterThanOrEqual(1);
    }
  });

  it("synthesizes a PROVISIONAL verdict when the judge returns an empty response", async () => {
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
      expect(verdict.verdict.provisional).toBe(true);
      expect(verdict.verdict.recommendedAction.length).toBeGreaterThan(0);
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

  // ── V0.2.2.2 (Part 5): resumable sessions — retry ONE failed member. ─────

  it("resumes a session by re-running only the failed member", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        calls += 1;
        if (input.system.includes("REASONER")) throw new Error("boom");
        if (input.system.includes("JUDGE")) return { content: verdictJson, usage: { inputTokens: 1, outputTokens: 1 } };
        if (input.system.includes("COMPARER")) return { content: comparisonJson, usage: { inputTokens: 1, outputTokens: 1 } };
        return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    // First run: the Reasoner fails; the rest complete and the (healthy) Judge
    // still produces a verdict — the failed member is preserved on the run.
    // (Business question so the mocked BUILD verdict is inside the allowed set.)
    const first = await collect(
      runCouncil({ mode: "FULL", question: "Should I start a business?", provider }),
    );
    const firstReasoner = first.find((e) => e.type === "agent:done" && e.analysis.agent === "reasoner");
    expect(firstReasoner?.type).toBe("agent:done");
    if (firstReasoner?.type === "agent:done") expect(firstReasoner.analysis.failed).toBe(true);

    // Now make the Reasoner succeed and resume the SAME session.
    const agentEvents = first.filter((e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done");
    const analyses = agentEvents.map((e) => e.analysis);
    const agents = first.find((e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened")?.agents ?? [];

    const reasonerOk: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        if (input.system.includes("REASONER")) return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
        if (input.system.includes("JUDGE")) return { content: verdictJson, usage: { inputTokens: 1, outputTokens: 1 } };
        if (input.system.includes("COMPARER")) return { content: comparisonJson, usage: { inputTokens: 1, outputTokens: 1 } };
        return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    const resumed = await collect(
      runCouncil({
        mode: "FULL",
        question: "Should I start a business?",
        provider: reasonerOk,
        sessionId: "sess-1",
        resume: { agents, analyses, retryAgent: "reasoner" },
      }),
    );

    // Only the retried member was re-called (1 analyst + comparer + judge).
    const reasonerDone = resumed.filter((e) => e.type === "agent:done" && e.analysis.agent === "reasoner");
    expect(reasonerDone).toHaveLength(1);
    const reasonerAnalysis = reasonerDone[0].type === "agent:done" ? reasonerDone[0].analysis : null;
    expect(reasonerAnalysis?.failed).not.toBe(true);
    // The other members are NOT re-emitted as done events (they were carried over).
    const totalDone = resumed.filter((e) => e.type === "agent:done").length;
    expect(totalDone).toBe(1);
    // The resumed run still completes with a normal (non-degraded) verdict.
    const resumedVerdict = resumed.find((e) => e.type === "verdict");
    expect(resumedVerdict?.type).toBe("verdict");
    if (resumedVerdict?.type === "verdict") {
      expect(resumedVerdict.verdict.degraded).toBe(false);
      expect(resumedVerdict.usage.sessionId).toBe("sess-1");
    }
  });

  it("records per-stage durations in usage (Part 9)", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return verdictJson;
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(runCouncil({ mode: "FULL", question: "Q?", provider }));
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.usage.stageDurations).toBeDefined();
      expect(verdict.usage.stageDurations.analysisMs).toBeGreaterThanOrEqual(0);
      expect(verdict.usage.stageDurations.judgeMs).toBeGreaterThanOrEqual(0);
      expect(verdict.usage.agentDurations).toBeDefined();
    }
  });

  it("treats a verdict outside the question type's allowed set as malformed → PROVISIONAL (V0.2.2.2 Part 6)", async () => {
    // "Why is the sky blue?" is an explanation → general verdict set. PIVOT is
    // product-only, so it must NOT be accepted as a normal verdict.
    const outOfSet = JSON.stringify({
      verdict: "PIVOT",
      score: 6,
      confidence: 70,
      informationSufficiency: "MEDIUM",
      summary: "A pivot.",
      keyReasons: ["x"],
      agreements: [],
      disagreements: [],
      criticalUnknowns: [],
      assumptions: [],
      risks: [],
      recommendedAction: "Pivot.",
      whatWouldChangeVerdict: [],
      reasoning: "x",
      whyThisVerdictWon: "x",
      strongestArgumentFor: "x",
      strongestArgumentAgainst: "x",
    });
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return outOfSet;
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(
      runCouncil({ mode: "FULL", question: "Why is the sky blue?", provider }),
    );
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      expect(verdict.verdict.degraded).toBe(true);
      expect(verdict.verdict.provisional).toBe(true);
      expect(verdict.verdict.verdict).not.toBe("PIVOT");
    }
  });

  // ── V0.2.2.4 (Part 9): per-call telemetry + worst-case output caps. ──────

  it("V0.2.2.4: records per-call telemetry for every provider call (Part 9)", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) return verdictJson;
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(runCouncil({ mode: "FULL", question: "Q?", provider }));
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      const calls = verdict.usage.calls ?? [];
      // 4 analysts + understander + comparer + judge (the injected mock
      // provider is not Ollama, so the V0.3 understanding stage runs).
      expect(calls).toHaveLength(7);
      expect(calls.map((c) => c.stage).sort()).toEqual([
        "analysis",
        "analysis",
        "analysis",
        "analysis",
        "comparison",
        "judge",
        "understanding",
      ]);
      expect(calls.every((c) => c.status === "COMPLETED")).toBe(true);
      expect(calls.every((c) => c.model === "mock-model")).toBe(true);
      expect(calls.every((c) => c.retries === 0)).toBe(true);
      expect(calls.every((c) => c.durationMs >= 0)).toBe(true);
      expect(calls.every((c) => c.inputTokens === 10 && c.outputTokens === 20)).toBe(true);
      // Telemetry sums must match the aggregate counters.
      expect(verdict.usage.agentCalls).toBe(7);
      expect(verdict.usage.inputTokens).toBe(70);
      expect(verdict.usage.outputTokens).toBe(140);
    }
  });

  it("V0.2.2.4: telemetry records retries and attributes timeout outcomes", async () => {
    // Transient failure: first Reasoner call fails, the single retry succeeds.
    // The V0.3 understander fires first, so count REASONER calls, not all calls.
    let reasonerCalls = 0;
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        if (input.system.includes("REASONER")) {
          reasonerCalls += 1;
          if (reasonerCalls === 1) throw new Error("transient");
        }
        if (input.system.includes("JUDGE")) return { content: verdictJson, usage: { inputTokens: 1, outputTokens: 1 } };
        if (input.system.includes("COMPARER")) return { content: comparisonJson, usage: { inputTokens: 1, outputTokens: 1 } };
        return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const events = await collect(runCouncil({ mode: "FULL", question: "Q?", provider }));
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") {
      const reasonerCall = (verdict.usage.calls ?? []).find((c) => c.agent === "reasoner");
      expect(reasonerCall?.status).toBe("COMPLETED");
      expect(reasonerCall?.retries).toBe(1);
    }

    // A persistently timing-out Judge is attributed TIMED_OUT — and the run
    // still degrades to a PROVISIONAL verdict instead of dying or faking.
    const timeoutProvider = makeProvider((input) => {
      if (input.system.includes("JUDGE")) throw new Error("timeout after 60s");
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const evs2 = await collect(runCouncil({ mode: "FULL", question: "Q?", provider: timeoutProvider }));
    const v2 = evs2.find((e) => e.type === "verdict");
    expect(v2?.type).toBe("verdict");
    if (v2?.type === "verdict") {
      const judgeCall = (v2.usage.calls ?? []).find((c) => c.agent === "judge");
      expect(judgeCall?.status).toBe("TIMED_OUT");
      expect(v2.verdict.degraded).toBe(true);
      expect(v2.verdict.provisional).toBe(true);
    }
  });

  it("V0.2.2.4: applies stage-specific worst-case output caps", async () => {
    // Derive the expected caps from the same env knobs the orchestrator reads,
    // so the test stays correct even when COUNCIL_*_TOKENS are set.
    const expectedAnalysis = Number(process.env.COUNCIL_ANALYSIS_TOKENS ?? 700);
    const expectedComparison = Number(process.env.COUNCIL_COMPARISON_TOKENS ?? 1100);
    const expectedJudge = Number(process.env.COUNCIL_JUDGE_TOKENS ?? 1200);
    const seen: { kind: string; maxTokens?: number }[] = [];
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        const kind = input.system.includes("JUDGE")
          ? "judge"
          : input.system.includes("COMPARER")
            ? "comparison"
            : input.system.includes("question-understander")
              ? "understanding"
              : "analysis";
        seen.push({ kind, maxTokens: input.maxTokens });
        if (kind === "judge") return { content: verdictJson, usage: { inputTokens: 1, outputTokens: 1 } };
        if (kind === "comparison") return { content: comparisonJson, usage: { inputTokens: 1, outputTokens: 1 } };
        if (kind === "understanding") return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
        return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    await collect(runCouncil({ mode: "FULL", question: "Q?", provider }));
    expect(seen.filter((s) => s.kind === "analysis").every((s) => s.maxTokens === expectedAnalysis)).toBe(true);
    expect(seen.find((s) => s.kind === "comparison")?.maxTokens).toBe(expectedComparison);
    expect(seen.find((s) => s.kind === "judge")?.maxTokens).toBe(expectedJudge);
    // V0.3: the understander runs on its own small budget (320 tokens max).
    expect(seen.find((s) => s.kind === "understanding")?.maxTokens).toBe(320);
  });

  it("V0.2.2.4: keeps full analyses for the Judge when the comparison falls back empty (no evidence loss)", async () => {
    const judgeCalls: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        if (input.system.includes("JUDGE")) {
          judgeCalls.push(input.user);
          return { content: verdictJson, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        // Garbage comparison output → runComparison falls back to an EMPTY
        // comparison. The Judge must then still see the analyses' structured
        // lists (full format), not just summaries + key points.
        if (input.system.includes("COMPARER"))
          return { content: "not json at all", usage: { inputTokens: 1, outputTokens: 1 } };
        return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    await collect(runCouncil({ mode: "FULL", question: "Q?", provider }));
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]).toContain("Assumptions:");
    expect(judgeCalls[0]).toContain("Risks:");
    expect(judgeCalls[0]).toContain("Missing info:");
  });

  // ── V0.3 (Part 8.3): targeted re-analysis — affected agents re-run, the
  // rest are reused, and the Judge must NEVER see two versions of one member.

  it("V0.3: reconsider re-runs only the affected agents and does not double-feed the Judge", async () => {
    const judgeUsers: string[] = [];
    let call = 0;
    const provider: ModelProvider = {
      id: "mock",
      model: "mock-model",
      async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
        call += 1;
        if (input.system.includes("JUDGE")) {
          judgeUsers.push(input.user);
          return { content: verdictJson, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        if (input.system.includes("COMPARER"))
          return { content: comparisonJson, usage: { inputTokens: 1, outputTokens: 1 } };
        return { content: agentJson(), usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    const priorAnalyses: AgentAnalysis[] = [
      { ...(JSON.parse(agentJson()) as Omit<AgentAnalysis, "agent" | "name">), agent: "reasoner", name: "Reasoner" },
      { ...(JSON.parse(agentJson()) as Omit<AgentAnalysis, "agent" | "name">), agent: "skeptic", name: "Skeptic" },
      { ...(JSON.parse(agentJson()) as Omit<AgentAnalysis, "agent" | "name">), agent: "practicalist", name: "Practicalist" },
      { ...(JSON.parse(agentJson()) as Omit<AgentAnalysis, "agent" | "name">), agent: "perspective", name: "Perspective" },
    ];
    const priorVerdict = JSON.parse(verdictJson) as CouncilVerdict;

    const events = await collect(
      runCouncil({
        mode: "FULL",
        question: "Should I start a business?",
        provider,
        sessionId: "sess-1",
        reconsider: {
          priorAnalyses,
          priorVerdict,
          affectedAgents: ["skeptic"],
          mergedContext: ["my budget is $5,000"],
        },
      }),
    );

    // Only the affected member re-runs; the others are reused, not re-emitted.
    const done = events.filter((e) => e.type === "agent:done");
    expect(done.map((d) => (d.type === "agent:done" ? d.analysis.agent : ""))).toEqual(["skeptic"]);

    // The Judge prompt must contain the skeptic exactly ONCE (the fresh
    // analysis) — never the old + new version of the same member. Word-boundary
    // match so "Skepticism" (a capability label) does not count.
    expect(judgeUsers).toHaveLength(1);
    const skepticMentions = (judgeUsers[0].match(/\bSkeptic\b/g) ?? []).length;
    expect(skepticMentions).toBe(1);

    // The verdict carries a diff vs the previous verdict.
    const verdict = events.find((e) => e.type === "verdict");
    expect(verdict?.type).toBe("verdict");
    if (verdict?.type === "verdict") expect(verdict.diff).toBeDefined();
  });

  it("attributes a timed-out analyst as TIMED_OUT, not just FAILED (Part 10)", async () => {
    const provider = makeProvider((input) => {
      if (input.system.includes("REASONER")) throw new Error("timeout after 60s");
      if (input.system.includes("JUDGE")) return verdictJson;
      if (input.system.includes("COMPARER")) return comparisonJson;
      return agentJson();
    });
    const events = await collect(runCouncil({ mode: "FULL", question: "Q?", provider }));
    const reasoner = events.find((e) => e.type === "agent:done" && e.analysis.agent === "reasoner");
    expect(reasoner?.type).toBe("agent:done");
    if (reasoner?.type === "agent:done") {
      expect(reasoner.analysis.failed).toBe(true);
      expect(reasoner.analysis.outcome).toBe("TIMED_OUT");
    }
  });
});
