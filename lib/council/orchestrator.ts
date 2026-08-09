import {
  AGENTS,
  ANALYTICAL_AGENTS,
  selectQuickAgents,
  labelForStance,
} from "./agents";
import { parseJsonObject, unwrapNestedObject, validate } from "./parse";
import {
  agentAnalysisSchema,
  comparisonSchema,
  devilsAdvocateSchema,
  verdictSchema,
} from "./schemas";
import { resolveProvider } from "./providers";
import type { ModelProvider, ProviderChatInput } from "./providers";
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
} from "./types";

/**
 * COUNCIL orchestrator.
 *
 * Pipeline by mode:
 *   QUICK: 3 analytical agents (selected by question) → Judge
 *   FULL:  all 4 analytical agents → comparison → Judge
 *   DEEP:  all 4 analytical agents → comparison → Devil's Advocate → Judge
 *
 * Independence: analytical agents receive ONLY the question + their role —
 * never each other's answers. Comparison happens after all are complete.
 * Agents run concurrently. A single agent failure does NOT crash the Council:
 * the Judge is told an agent failed and must reduce confidence accordingly.
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
const COMPARISON_KEYS = ["agreements", "disagreements", "sharedAssumptions", "stanceCounts"];
const DEVILS_ADVOCATE_KEYS = [
  "summary",
  "strongestArgument",
  "attemptToBreakIt",
  "unsupportedAssumptions",
  "convergenceWarning",
  "minorityPoint",
  "evidenceThatWouldResolve",
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
];

export interface CouncilRunOptions {
  mode: CouncilMode;
  question: string;
  provider?: ModelProvider;
  signal?: AbortSignal;
}

export class CouncilRunError extends Error {
  constructor(
    message: string,
    public readonly analyses: AgentAnalysis[],
    public readonly devilsAdvocate: DevilAdvocateAnalysis | null,
  ) {
    super(message);
    this.name = "CouncilRunError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function* runCouncil(opts: CouncilRunOptions): AsyncGenerator<CouncilEvent> {
  const { mode, question, signal } = opts;
  const provider = opts.provider ?? resolveProvider();
  const startedAt = Date.now();
  const usage: CouncilUsage = {
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
      queue.push({ type: "convened", mode, agents: analyticalAgents, stage: "convened" });

      // ── Stage 1: independent parallel analysis ────────────────────────────
      const analyses = new Map<AgentKey, AgentAnalysis>();

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
              user: `Question: ${question}`,
              temperature: 0.5,
              maxTokens: MAX_ANALYSIS_TOKENS,
            },
            provider,
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
        );
      }

      // If the client disconnected, stop before making further model calls.
      const bailIfAborted = (da: DevilAdvocateAnalysis | null) => {
        if (signal?.aborted) {
          throw new CouncilRunError("Council cancelled.", completedAnalyses, da);
        }
      };
      bailIfAborted(null);

      // ── Stage 2: comparison (FULL + DEEP only) ────────────────────────────
      let comparison: CouncilComparison | null = null;
      if (mode !== "QUICK") {
        queue.push({ type: "stage", stage: "comparing" });
        comparison = await runComparison(completedAnalyses, question, provider, signal, usage);
        queue.push({ type: "comparison", comparison, stage: "comparing" });
        bailIfAborted(null);
      }

      // ── Stage 3: Devil's Advocate (DEEP only) ─────────────────────────────
      let devilsAdvocate: DevilAdvocateAnalysis | null = null;
      if (mode === "DEEP") {
        queue.push({ type: "stage", stage: "devils_advocate" });
        devilsAdvocate = await runDevilsAdvocate(
          completedAnalyses,
          comparison,
          question,
          provider,
          signal,
          usage,
        );
        queue.push({ type: "da:done", analysis: devilsAdvocate, stage: "devils_advocate" });
        bailIfAborted(devilsAdvocate);
      }

      // ── Stage 4: the Judge ────────────────────────────────────────────────
      queue.push({ type: "stage", stage: "judging" });
      const verdict = await runJudge(
        completedAnalyses,
        comparison,
        devilsAdvocate,
        question,
        provider,
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
  if (comparison.sharedAssumptions.length) {
    parts.push("SHARED ASSUMPTIONS: " + comparison.sharedAssumptions.join("; "));
  }
  return parts.join("\n") || "(no explicit agreements or disagreements identified)";
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
  provider: ModelProvider,
  signal: AbortSignal | undefined,
  usage: CouncilUsage,
): Promise<CouncilComparison> {
  const def = AGENTS.comparer;
  const fallback = (): CouncilComparison => ({
    agreements: [],
    disagreements: [],
    sharedAssumptions: [],
    stanceCounts: stanceCounts(analyses),
  });

  try {
    const result = await callWithRetry(
      {
        system: `${def.system}\n\n${def.outputContract}`,
        user: `Question: ${question}\n\nIndependent analyses:\n${formatAnalysesForJudge(analyses)}`,
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
      sharedAssumptions: parsed.data.sharedAssumptions,
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
        user: `Question: ${question}\n\nIndependent analyses:\n${formatAnalysesForJudge(analyses)}\n\nComparison:\n${formatComparison(comparison)}`,
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

/**
 * Safe fallback verdict — used ONLY when the model cannot produce a valid
 * verdict even after retries, or the Judge call itself fails. It is honest
 * about being degraded and never fabricates confidence.
 */
function fallbackVerdict(analyses: AgentAnalysis[], failedCount: number): CouncilVerdict {
  const live = analyses.filter((a) => !a.failed);
  const supports = live.filter((a) => a.stance === "SUPPORT").length;
  const opposes = live.filter((a) => a.stance === "OPPOSE").length;
  const conditional = live.filter((a) => a.stance === "CONDITIONAL").length;
  const total = Math.max(1, live.length);
  const supportRatio = supports / total;

  let verdict: CouncilVerdict["verdict"] = "INSUFFICIENT_INFORMATION";
  if (opposes > supports) verdict = "RECONSIDER";
  else if (supportRatio >= 0.66 && conditional === 0) verdict = "BUILD";
  else if (supportRatio >= 0.5) verdict = "REFINE";

  return {
    verdict,
    score: Math.round(supportRatio * 100) / 10,
    confidence: Math.max(0, 40 - failedCount * 15),
    summary: `The Judge could not produce a fully structured verdict after repeated attempts${failedCount > 0 ? ` (${failedCount} agent(s) failed)` : ""}. This is a degraded, automatically derived verdict based only on the surviving agents' stated stances.`,
    strongestArgumentFor:
      live.find((a) => a.stance === "SUPPORT" || a.stance === "CONDITIONAL")?.keyPoints[0] ??
      "None of the surviving agents supported the proposal.",
    strongestArgumentAgainst:
      live.find((a) => a.stance === "OPPOSE")?.keyPoints[0] ??
      "None of the surviving agents opposed the proposal.",
    keyAgreements: [],
    keyDisagreements: [],
    criticalAssumptions: [],
    criticalRisks: [],
    recommendedAction: "Retry the Council, or check that the model provider is healthy.",
    whatWouldChangeTheVerdict: ["A working Judge response."],
    reasoning: "Degraded fallback — see summary.",
    degraded: true,
  };
}

async function runJudge(
  analyses: AgentAnalysis[],
  comparison: CouncilComparison | null,
  devilsAdvocate: DevilAdvocateAnalysis | null,
  question: string,
  provider: ModelProvider,
  signal: AbortSignal | undefined,
  usage: CouncilUsage,
): Promise<CouncilVerdict> {
  const def = AGENTS.judge;
  const failedCount = analyses.filter((a) => a.failed).length;
  const daSection = devilsAdvocate
    ? devilsAdvocate.failed
      ? "Devil's Advocate FAILED (no response).\n"
      : `Devil's Advocate stress-test:\n${devilsAdvocate.summary}\nStrongest argument: ${devilsAdvocate.strongestArgument}\nAttempt to break it: ${devilsAdvocate.attemptToBreakIt}\nUnsupported assumptions: ${devilsAdvocate.unsupportedAssumptions.join("; ") || "none"}\nConvergence warning: ${devilsAdvocate.convergenceWarning || "none"}\nMinority point: ${devilsAdvocate.minorityPoint || "none"}\nEvidence that would resolve: ${devilsAdvocate.evidenceThatWouldResolve.join("; ") || "none"}\n`
    : "";

  const failedNote =
    failedCount > 0
      ? `\nNOTE: ${failedCount} of ${analyses.length} analytical agent(s) FAILED and provided no analysis. Factor this into your confidence — you have less evidence than a full Council. Do not fabricate what the failed agents would have said.`
      : "";

  try {
    const result = await callWithRetry(
      {
        system: `${def.system}\n\n${def.outputContract}`,
        user: `Question: ${question}\n\nIndependent analyses:\n${formatAnalysesForJudge(analyses)}\n\nComparison:\n${formatComparison(comparison)}${daSection}${failedNote}`,
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
      return fallbackVerdict(analyses, failedCount);
    }
    return { ...parsed.data, degraded: false };
  } catch (err) {
    usage.failedAgentCalls += 1;
    if (signal?.aborted) {
      throw new CouncilRunError("Council cancelled.", analyses, devilsAdvocate);
    }
    return fallbackVerdict(analyses, failedCount);
  }
}

export { ANALYTICAL_AGENTS, AGENTS };
