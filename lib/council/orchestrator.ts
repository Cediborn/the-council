import {
  AGENTS,
  ANALYTICAL_AGENTS,
  buildClassificationContext,
  classifyQuestion,
  labelForStance,
  selectQuickAgents,
} from "./agents";
import { parseJsonObject, unwrapNestedObject, validate } from "./parse";
import {
  agentAnalysisSchema,
  comparisonSchema,
  devilsAdvocateSchema,
  reassessmentSchema,
  verdictSchema,
} from "./schemas";
import { resolveProviderForStage } from "./providers";
import type { ModelProvider, ProviderChatInput, ProviderStage } from "./providers";
import { recordUsage } from "./usage";
import type {
  AgentAnalysis,
  AgentKey,
  CouncilComparison,
  CouncilEvent,
  CouncilMode,
  CouncilUsage,
  CouncilVerdict,
  DevilAdvocateAnalysis,
  QuestionClassification,
  ReassessmentAnalysis,
} from "./types";

/**
 * COUNCIL V0.2 orchestrator.
 *
 * Pipeline by mode:
 *   QUICK: 3 analytical agents (selected by question) → Judge
 *   FULL:  all 4 analytical agents → comparison → Judge
 *   DEEP:  all 4 analytical agents → comparison → Devil's Advocate
 *          → Reassessment → Judge
 *
 * Every question is classified first (type + capabilities). That
 * classification is injected into every agent prompt so the agents know what
 * kind of question they are answering (Part 6/7/8).
 *
 * Independence: analytical agents receive ONLY the question + classification +
 * their role — never each other's answers. Comparison happens after all are
 * complete. Agents run concurrently. A single agent failure does NOT crash the
 * Council: the Judge is told an agent failed and must reduce confidence.
 *
 * The Judge NEVER votes. If the Judge fails, the Council does NOT count
 * stances — it returns an explicitly degraded INSUFFICIENT_INFORMATION
 * verdict (Part 11).
 *
 * Implementation note: the pipeline runs inside a "pump" task that pushes
 * events into a shared queue; the async generator drains the queue. This keeps
 * agents concurrent (so events arrive as agents finish, not sequentially)
 * while remaining a plain generator with no nested `yield`s.
 */

const MAX_ANALYSIS_TOKENS = 1100;
const MAX_VERDICT_TOKENS = 1600;
const MAX_RETRIES = 1;

/** Known keys of each structured output, used to unwrap double-encoded JSON. */
const ANALYSIS_KEYS = [
  "summary",
  "stance",
  "keyPoints",
  "assumptions",
  "risks",
  "missingInformation",
  "confidence",
];
const COMPARISON_KEYS = [
  "agreements",
  "disagreements",
  "contradictions",
  "sharedAssumptions",
  "missingInformation",
  "risks",
  "uniqueInsights",
  "stanceCounts",
];
const DEVILS_ADVOCATE_KEYS = [
  "summary",
  "strongestArgument",
  "attemptToBreakIt",
  "unsupportedAssumptions",
  "convergenceWarning",
  "minorityPoint",
  "evidenceThatWouldResolve",
];
const REASSESSMENT_KEYS = [
  "summary",
  "hardened",
  "weakened",
  "positionChanges",
  "judgeGuidance",
];
const VERDICT_KEYS = [
  "verdict",
  "score",
  "confidence",
  "summary",
  "strongestArgumentFor",
  "strongestArgumentAgainst",
  "keyAgreements",
  "keyDisagreements",
  "criticalAssumptions",
  "criticalRisks",
  "recommendedAction",
  "whatWouldChangeTheVerdict",
  "reasoning",
  "whyThisVerdictWon",
];

export interface CouncilRunOptions {
  mode: CouncilMode;
  question: string;
  provider?: ModelProvider;
  signal?: AbortSignal;
  /** V0.2: stable session id (Part 18). Generated when omitted. */
  sessionId?: string;
}

export class CouncilRunError extends Error {
  constructor(
    message: string,
    public readonly analyses: AgentAnalysis[],
    public readonly devilsAdvocate: DevilAdvocateAnalysis | null,
    public readonly reassessment: ReassessmentAnalysis | null,
  ) {
    super(message);
    this.name = "CouncilRunError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function* runCouncil(opts: CouncilRunOptions): AsyncGenerator<CouncilEvent> {
  const { mode, question, signal } = opts;
  const sessionId = opts.sessionId ?? makeSessionId();
  const startedAt = Date.now();
  const classification: QuestionClassification = classifyQuestion(question);

  // Per-stage routing (Part 21) only applies when the caller did NOT inject a
  // provider. An injected provider (tests, callers with a fixed model) wins
  // for every stage.
  const providerFor = (stage: ProviderStage): ModelProvider =>
    opts.provider ?? resolveProviderForStage(stage);
  const provider = providerFor("analysis");
  const usage: CouncilUsage = {
    sessionId,
    mode,
    agentCalls: 0,
    failedAgentCalls: 0,
    model: provider.model,
    provider: provider.id,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    success: false,
    questionLength: question.length,
    startedAt: new Date().toISOString(),
  };

  const analyticalAgents: AgentKey[] =
    mode === "QUICK" ? selectQuickAgents(question) : ANALYTICAL_AGENTS;

  const queue: CouncilEvent[] = [];
  let pipelineDone = false;
  let pipelineError: unknown = null;

  const pump = (async () => {
    try {
      queue.push({
        type: "convened",
        sessionId,
        mode,
        agents: analyticalAgents,
        classification,
        stage: "convened",
      });

      // ── Stage 1: independent parallel analysis ────────────────────────────
      // Resolve each stage's provider once (per-stage routing, Part 21) so the
      // four concurrent analysts share one instance and usage stays accurate.
      const analysisProvider = providerFor("analysis");
      const analyses = new Map<AgentKey, AgentAnalysis>();
      const classificationContext = buildClassificationContext(classification);
      const userPrompt = `Question: ${question}${classificationContext}`;

      const runAnalyst = async (agent: AgentKey): Promise<void> => {
        const def = AGENTS[agent];
        const analysis: AgentAnalysis = {
          agent,
          name: def.name,
          summary: "",
          stance: "NEUTRAL",
          keyPoints: [],
          assumptions: [],
          risks: [],
          missingInformation: [],
          confidence: 50,
        };
        queue.push({ type: "agent:start", agent, name: def.name, stage: "analyzing" });

        try {
          const result = await callWithRetry(
            {
              system: `${def.system}\n\n${def.outputContract}`,
              user: userPrompt,
              temperature: 0.5,
              maxTokens: MAX_ANALYSIS_TOKENS,
            },
            analysisProvider,
            signal,
          );
          usage.inputTokens += result.usage.inputTokens;
          usage.outputTokens += result.usage.outputTokens;
          usage.agentCalls += 1;

          const parsed = validate(
            agentAnalysisSchema,
            unwrapNestedObject(parseJsonObject(result.content), "summary", ANALYSIS_KEYS),
          );
          if (!parsed.ok) {
            // Malformed output: keep raw text, degrade gracefully.
            analysis.summary = result.content.trim();
            analysis.degraded = true;
            analysis.retries = result.retries;
          } else {
            analysis.summary = parsed.data.summary;
            analysis.stance = parsed.data.stance;
            analysis.keyPoints = parsed.data.keyPoints;
            analysis.assumptions = parsed.data.assumptions;
            analysis.risks = parsed.data.risks;
            analysis.missingInformation = parsed.data.missingInformation;
            analysis.confidence = parsed.data.confidence;
            analysis.retries = result.retries;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          analysis.failed = true;
          analysis.error = message;
          usage.failedAgentCalls += 1;
        }

        analyses.set(agent, analysis);
        queue.push({ type: "agent:done", analysis, stage: "analyzing" });
      };

      // All analysts run concurrently; events arrive as each one finishes.
      await Promise.all(analyticalAgents.map((agent) => runAnalyst(agent)));

      const completedAnalyses = analyticalAgents
        .map((agent) => analyses.get(agent))
        .filter((a): a is AgentAnalysis => Boolean(a));

      // If EVERY analytical agent failed, the Council has nothing to judge.
      const successfulAnalyses = completedAnalyses.filter((a) => !a.failed);
      if (successfulAnalyses.length === 0) {
        usage.durationMs = Date.now() - startedAt;
        usage.success = false;
        recordUsage(usage);
        throw new CouncilRunError(
          "Every analytical agent failed. The model provider may be unreachable.",
          completedAnalyses,
          null,
          null,
        );
      }

      // If the client disconnected, stop before making further model calls.
      const bailIfAborted = (
        da: DevilAdvocateAnalysis | null,
        reassessment: ReassessmentAnalysis | null,
      ) => {
        if (signal?.aborted) {
          throw new CouncilRunError("Council cancelled.", completedAnalyses, da, reassessment);
        }
      };
      bailIfAborted(null, null);

      // ── Stage 2: comparison (FULL + DEEP only) ────────────────────────────
      let comparison: CouncilComparison | null = null;
      if (mode !== "QUICK") {
        const comparisonProvider = providerFor("comparison");
        queue.push({ type: "stage", stage: "comparing" });
        comparison = await runComparison(
          completedAnalyses,
          question,
          classification,
          comparisonProvider,
          signal,
          usage,
        );
        queue.push({ type: "comparison", comparison, stage: "comparing" });
        bailIfAborted(null, null);
      }

      // ── Stage 3: Devil's Advocate (DEEP only) ─────────────────────────────
      let devilsAdvocate: DevilAdvocateAnalysis | null = null;
      if (mode === "DEEP") {
        const daProvider = providerFor("devils_advocate");
        queue.push({ type: "stage", stage: "devils_advocate" });
        devilsAdvocate = await runDevilsAdvocate(
          completedAnalyses,
          comparison,
          question,
          classification,
          daProvider,
          signal,
          usage,
        );
        queue.push({ type: "da:done", analysis: devilsAdvocate, stage: "devils_advocate" });
        bailIfAborted(devilsAdvocate, null);
      }

      // ── Stage 4: Reassessment (DEEP only) — V0.2 (Part 12) ───────────────
      let reassessment: ReassessmentAnalysis | null = null;
      if (mode === "DEEP" && devilsAdvocate && !devilsAdvocate.failed) {
        const reassessmentProvider = providerFor("reassessment");
        queue.push({ type: "stage", stage: "reassessing" });
        reassessment = await runReassessment(
          completedAnalyses,
          comparison,
          devilsAdvocate,
          question,
          classification,
          reassessmentProvider,
          signal,
          usage,
        );
        queue.push({ type: "reassessment:done", analysis: reassessment, stage: "reassessing" });
        bailIfAborted(devilsAdvocate, reassessment);
      }

      // ── Stage 5: the Judge ────────────────────────────────────────────────
      const judgeProvider = providerFor("judge");
      queue.push({ type: "stage", stage: "judging" });
      const verdict = await runJudge(
        completedAnalyses,
        comparison,
        devilsAdvocate,
        reassessment,
        question,
        classification,
        judgeProvider,
        signal,
        usage,
      );

      usage.durationMs = Date.now() - startedAt;
      usage.success = true;
      recordUsage(usage);

      queue.push({ type: "verdict", verdict, usage, stage: "complete" });
    } catch (err) {
      pipelineError = err;
    } finally {
      pipelineDone = true;
    }
  })();

  // Drain the queue; the pump runs concurrently.
  // If the client aborts, stop draining immediately — the pump's own bail
  // checks stop further model calls, so the abandoned run ends quickly.
  while (!pipelineDone || queue.length > 0) {
    while (queue.length > 0) {
      const event = queue.shift();
      if (event) yield event;
    }
    if (signal?.aborted) break;
    if (!pipelineDone) await sleep(20);
  }

  if (pipelineError) throw pipelineError;
}

// ── helpers ─────────────────────────────────────────────────────────────────

interface RetriedResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  retries: number;
}

async function callWithRetry(
  input: Omit<ProviderChatInput, "signal">,
  provider: ModelProvider,
  signal?: AbortSignal,
): Promise<RetriedResult> {
  let retries = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await provider.chat({ ...input, signal });
      return { ...result, retries };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err; // don't retry aborted requests
      retries = attempt + 1;
    }
  }
  throw lastError;
}

function formatAnalysesForJudge(analyses: AgentAnalysis[]): string {
  return analyses
    .map((a) => {
      if (a.failed) return `## ${a.name} — FAILED\n(no response received)`;
      const lines = [
        `## ${a.name} (stance: ${labelForStance(a.stance)}, confidence: ${a.confidence})`,
        a.summary,
      ];
      if (a.keyPoints.length) lines.push(`Key points: ${a.keyPoints.map((k) => `"${k}"`).join("; ")}`);
      if (a.assumptions.length) lines.push(`Assumptions: ${a.assumptions.join("; ")}`);
      if (a.risks.length) lines.push(`Risks: ${a.risks.join("; ")}`);
      if (a.missingInformation.length) lines.push(`Missing info: ${a.missingInformation.join("; ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatComparison(comparison: CouncilComparison | null): string {
  if (!comparison) return "(no comparison available)";
  const parts: string[] = [];
  if (comparison.agreements.length) {
    parts.push(
      "AGREEMENTS: " +
        comparison.agreements
          .map((a) => `${a.topic} (${a.agents.join(", ")}): ${a.summary}`)
          .join("\n"),
    );
  }
  if (comparison.disagreements.length) {
    parts.push(
      "DISAGREEMENTS: " +
        comparison.disagreements
          .map((d) => `${d.topic}: ${d.positions.map((p) => `${p.agent} → ${p.position}`).join(" | ")} (${d.summary})`)
          .join("\n"),
    );
  }
  if (comparison.contradictions.length) {
    parts.push(
      "CONTRADICTIONS: " +
        comparison.contradictions
          .map((c) => `${c.topic}: ${c.summary}`)
          .join("\n"),
    );
  }
  if (comparison.sharedAssumptions.length) {
    parts.push("SHARED ASSUMPTIONS: " + comparison.sharedAssumptions.join("; "));
  }
  if (comparison.missingInformation.length) {
    parts.push("MISSING INFORMATION: " + comparison.missingInformation.join("; "));
  }
  if (comparison.risks.length) {
    parts.push("RISKS: " + comparison.risks.join("; "));
  }
  if (comparison.uniqueInsights.length) {
    parts.push("UNIQUE INSIGHTS: " + comparison.uniqueInsights.join("; "));
  }
  return parts.join("\n") || "(no explicit agreements or disagreements identified)";
}

function formatReassessment(reassessment: ReassessmentAnalysis | null): string {
  if (!reassessment) return "";
  if (reassessment.failed) return "\nReassessment FAILED (no response).\n";
  const parts = [
    `\nReassessment after stress-test:\n${reassessment.summary}`,
  ];
  if (reassessment.hardened.length) parts.push(`Hardened: ${reassessment.hardened.join("; ")}`);
  if (reassessment.weakened.length) parts.push(`Weakened: ${reassessment.weakened.join("; ")}`);
  if (reassessment.positionChanges.length) {
    parts.push(
      "Position changes: " +
        reassessment.positionChanges
          .map((p) => `${p.agent}: ${p.from} → ${p.to}`)
          .join(" | "),
    );
  }
  if (reassessment.judgeGuidance) parts.push(`Judge guidance: ${reassessment.judgeGuidance}`);
  return parts.join("\n");
}

function stanceCounts(analyses: AgentAnalysis[]): CouncilComparison["stanceCounts"] {
  const counts: CouncilComparison["stanceCounts"] = {
    SUPPORT: 0,
    OPPOSE: 0,
    CONDITIONAL: 0,
    NEUTRAL: 0,
    INSUFFICIENT: 0,
  };
  for (const a of analyses) {
    if (a.failed) continue;
    counts[a.stance] = (counts[a.stance] ?? 0) + 1;
  }
  return counts;
}

async function runComparison(
  analyses: AgentAnalysis[],
  question: string,
  classification: QuestionClassification,
  provider: ModelProvider,
  signal: AbortSignal | undefined,
  usage: CouncilUsage,
): Promise<CouncilComparison> {
  const def = AGENTS.comparer;
  const fallback = (): CouncilComparison => ({
    agreements: [],
    disagreements: [],
    contradictions: [],
    sharedAssumptions: [],
    missingInformation: [],
    risks: [],
    uniqueInsights: [],
    stanceCounts: stanceCounts(analyses),
  });

  try {
    const result = await callWithRetry(
      {
        system: `${def.system}\n\n${def.outputContract}`,
        user: `Question: ${question}${buildClassificationContext(classification)}\n\nIndependent analyses:\n${formatAnalysesForJudge(analyses)}`,
        temperature: 0.3,
        maxTokens: MAX_ANALYSIS_TOKENS,
      },
      provider,
      signal,
    );
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.agentCalls += 1;

    const parsed = validate(
      comparisonSchema,
      unwrapNestedObject(parseJsonObject(result.content), "summary", COMPARISON_KEYS),
    );
    if (!parsed.ok) return fallback();
    return {
      agreements: parsed.data.agreements,
      disagreements: parsed.data.disagreements,
      contradictions: parsed.data.contradictions,
      sharedAssumptions: parsed.data.sharedAssumptions,
      missingInformation: parsed.data.missingInformation,
      risks: parsed.data.risks,
      uniqueInsights: parsed.data.uniqueInsights,
      stanceCounts: {
        SUPPORT: 0,
        OPPOSE: 0,
        CONDITIONAL: 0,
        NEUTRAL: 0,
        INSUFFICIENT: 0,
        ...parsed.data.stanceCounts,
      },
    };
  } catch (err) {
    usage.failedAgentCalls += 1;
    return fallback();
  }
}

async function runDevilsAdvocate(
  analyses: AgentAnalysis[],
  comparison: CouncilComparison | null,
  question: string,
  classification: QuestionClassification,
  provider: ModelProvider,
  signal: AbortSignal | undefined,
  usage: CouncilUsage,
): Promise<DevilAdvocateAnalysis> {
  const def = AGENTS.devils_advocate;
  const base: DevilAdvocateAnalysis = {
    agent: "devils_advocate",
    name: def.name,
    summary: "",
    strongestArgument: "",
    attemptToBreakIt: "",
    unsupportedAssumptions: [],
    convergenceWarning: "",
    minorityPoint: "",
    evidenceThatWouldResolve: [],
  };

  try {
    const result = await callWithRetry(
      {
        system: `${def.system}\n\n${def.outputContract}`,
        user: `Question: ${question}${buildClassificationContext(classification)}\n\nIndependent analyses:\n${formatAnalysesForJudge(analyses)}\n\nComparison:\n${formatComparison(comparison)}`,
        temperature: 0.4,
        maxTokens: MAX_ANALYSIS_TOKENS,
      },
      provider,
      signal,
    );
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.agentCalls += 1;

    const parsed = validate(
      devilsAdvocateSchema,
      unwrapNestedObject(parseJsonObject(result.content), "summary", DEVILS_ADVOCATE_KEYS),
    );
    if (!parsed.ok) {
      return { ...base, summary: result.content.trim(), degraded: true, retries: result.retries };
    }
    return {
      ...base,
      summary: parsed.data.summary,
      strongestArgument: parsed.data.strongestArgument,
      attemptToBreakIt: parsed.data.attemptToBreakIt,
      unsupportedAssumptions: parsed.data.unsupportedAssumptions,
      convergenceWarning: parsed.data.convergenceWarning,
      minorityPoint: parsed.data.minorityPoint,
      evidenceThatWouldResolve: parsed.data.evidenceThatWouldResolve,
      retries: result.retries,
    };
  } catch (err) {
    usage.failedAgentCalls += 1;
    return { ...base, failed: true, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runReassessment(
  analyses: AgentAnalysis[],
  comparison: CouncilComparison | null,
  devilsAdvocate: DevilAdvocateAnalysis,
  question: string,
  classification: QuestionClassification,
  provider: ModelProvider,
  signal: AbortSignal | undefined,
  usage: CouncilUsage,
): Promise<ReassessmentAnalysis> {
  const def = AGENTS.reassessor;
  const base: ReassessmentAnalysis = {
    summary: "",
    hardened: [],
    weakened: [],
    positionChanges: [],
    judgeGuidance: "",
  };

  try {
    const result = await callWithRetry(
      {
        system: `${def.system}\n\n${def.outputContract}`,
        user: `Question: ${question}${buildClassificationContext(classification)}\n\nIndependent analyses:\n${formatAnalysesForJudge(analyses)}\n\nComparison:\n${formatComparison(comparison)}\n\nDevil's Advocate stress-test:\n${formatDevilsAdvocateForJudge(devilsAdvocate)}`,
        temperature: 0.4,
        maxTokens: MAX_ANALYSIS_TOKENS,
      },
      provider,
      signal,
    );
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.agentCalls += 1;

    const parsed = validate(
      reassessmentSchema,
      unwrapNestedObject(parseJsonObject(result.content), "summary", REASSESSMENT_KEYS),
    );
    if (!parsed.ok) {
      return { ...base, summary: result.content.trim(), degraded: true, retries: result.retries };
    }
    return {
      summary: parsed.data.summary,
      hardened: parsed.data.hardened,
      weakened: parsed.data.weakened,
      positionChanges: parsed.data.positionChanges,
      judgeGuidance: parsed.data.judgeGuidance,
      retries: result.retries,
    };
  } catch (err) {
    usage.failedAgentCalls += 1;
    return { ...base, failed: true, error: err instanceof Error ? err.message : String(err) };
  }
}

function formatDevilsAdvocateForJudge(da: DevilAdvocateAnalysis): string {
  if (da.failed) return "Devil's Advocate FAILED (no response).";
  return [
    da.summary,
    `Strongest argument: ${da.strongestArgument}`,
    `Attempt to break it: ${da.attemptToBreakIt}`,
    `Unsupported assumptions: ${da.unsupportedAssumptions.join("; ") || "none"}`,
    `Convergence warning: ${da.convergenceWarning || "none"}`,
    `Minority point: ${da.minorityPoint || "none"}`,
    `Evidence that would resolve: ${da.evidenceThatWouldResolve.join("; ") || "none"}`,
  ].join("\n");
}

/**
 * Safe fallback verdict — used ONLY when the model cannot produce a valid
 * verdict even after retries, or the Judge call itself fails. It is honest
 * about being degraded and NEVER counts stances (Part 11): the Council does
 * not vote, and a broken Judge is not a reason to fabricate a verdict.
 */
function fallbackVerdict(analyses: AgentAnalysis[]): CouncilVerdict {
  const failedCount = analyses.filter((a) => a.failed).length;
  return {
    verdict: "INSUFFICIENT_INFORMATION",
    score: 0,
    confidence: Math.max(0, 30 - failedCount * 10),
    summary: `The Council could not complete its final evaluation — the Judge failed to produce a structured verdict${
      failedCount > 0 ? ` and ${failedCount} analytical agent(s) also failed` : ""
    }. No verdict is fabricated from the surviving stances.`,
    strongestArgumentFor: analyses.find((a) => !a.failed)?.keyPoints[0] ?? "Unknown.",
    strongestArgumentAgainst: "Unknown — the Council could not weigh the arguments.",
    keyAgreements: [],
    keyDisagreements: [],
    criticalAssumptions: [],
    criticalRisks: [],
    recommendedAction: "Retry the Council, or check that the model provider is healthy.",
    whatWouldChangeTheVerdict: ["A working Judge response."],
    reasoning: "Degraded fallback — the Judge did not respond with a valid verdict.",
    whyThisVerdictWon: "No argument won: this is an explicitly degraded result, not a judgment.",
    degraded: true,
  };
}

async function runJudge(
  analyses: AgentAnalysis[],
  comparison: CouncilComparison | null,
  devilsAdvocate: DevilAdvocateAnalysis | null,
  reassessment: ReassessmentAnalysis | null,
  question: string,
  classification: QuestionClassification,
  provider: ModelProvider,
  signal: AbortSignal | undefined,
  usage: CouncilUsage,
): Promise<CouncilVerdict> {
  const def = AGENTS.judge;
  const failedCount = analyses.filter((a) => a.failed).length;
  const daSection = devilsAdvocate
    ? `\nDevil's Advocate:\n${formatDevilsAdvocateForJudge(devilsAdvocate)}\n`
    : "";
  const reassessmentSection = reassessment ? formatReassessment(reassessment) : "";

  const failedNote =
    failedCount > 0
      ? `\nNOTE: ${failedCount} of ${analyses.length} analytical agent(s) FAILED and provided no analysis. Factor this into your confidence — you have less evidence than a full Council. Do not fabricate what the failed agents would have said.`
      : "";

  try {
    const result = await callWithRetry(
      {
        system: `${def.system}\n\n${def.outputContract}`,
        user: `Question: ${question}${buildClassificationContext(classification)}\n\nIndependent analyses:\n${formatAnalysesForJudge(analyses)}\n\nComparison:\n${formatComparison(comparison)}${daSection}${reassessmentSection}${failedNote}`,
        temperature: 0.3,
        maxTokens: MAX_VERDICT_TOKENS,
      },
      provider,
      signal,
    );
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.agentCalls += 1;

    const parsed = validate(
      verdictSchema,
      unwrapNestedObject(parseJsonObject(result.content), "summary", VERDICT_KEYS),
    );
    if (!parsed.ok) {
      return fallbackVerdict(analyses);
    }
    return {
      ...parsed.data,
      whyThisVerdictWon:
        parsed.data.whyThisVerdictWon.trim() !== ""
          ? parsed.data.whyThisVerdictWon
          : parsed.data.reasoning,
      degraded: false,
    };
  } catch (err) {
    usage.failedAgentCalls += 1;
    if (signal?.aborted) {
      throw new CouncilRunError("Council cancelled.", analyses, devilsAdvocate, reassessment);
    }
    return fallbackVerdict(analyses);
  }
}

export { ANALYTICAL_AGENTS, AGENTS };
