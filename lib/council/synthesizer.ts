import {
  isProductType,
  type AgentAnalysis,
  type CouncilComparison,
  type CouncilVerdict,
  type QuestionType,
  type VerdictCategory,
} from "./types";

/**
 * COUNCIL V0.2.2.2 — deterministic provisional-verdict synthesizer.
 *
 * When the Judge cannot produce a valid verdict (timeout, malformed output,
 * provider failure), the Council does NOT count stances and does NOT pretend
 * the Judge completed. Instead it produces a clearly-labelled PROVISIONAL
 * verdict synthesized from the *reasoning content* of the surviving analyses
 * (key points, risks, missing information, and the comparison's strongest/
 * weakest argument) — never from a yes/no vote tally.
 *
 * The synthesizer is pure and deterministic so it is fully unit-testable.
 * Provisional results never reach a full BUILD: a broken Judge cannot issue a
 * green light. If there is nothing to synthesize, it returns the honest
 * degraded INSUFFICIENT_INFORMATION state.
 */

export interface SynthesisInput {
  question: string;
  questionType: QuestionType;
  analyses: AgentAnalysis[];
  comparison: CouncilComparison | null;
}

/** Internal (type-agnostic) category ladder, worst → best. */
type GenericCategory = "REJECT" | "RECONSIDER" | "VALIDATE" | "BUILD_MVP";

const SCORE_BY_GENERIC: Record<GenericCategory, number> = {
  REJECT: 2.5,
  RECONSIDER: 4.5,
  VALIDATE: 6.0,
  BUILD_MVP: 6.5,
};

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function mapToSet(generic: GenericCategory, product: boolean): VerdictCategory {
  if (product) {
    switch (generic) {
      case "REJECT":
        return "DO_NOT_BUILD";
      case "RECONSIDER":
        return "PIVOT";
      default:
        return "BUILD_MVP";
    }
  }
  switch (generic) {
    case "REJECT":
      return "REJECT";
    case "RECONSIDER":
      return "RECONSIDER";
    default:
      return "VALIDATE";
  }
}

function directionSentence(verdict: VerdictCategory): string {
  switch (verdict) {
    case "DO_NOT_BUILD":
    case "REJECT":
      return "The available reasoning points against proceeding.";
    case "PIVOT":
    case "RECONSIDER":
      return "The available reasoning is mixed — the current approach looks weak relative to the alternatives.";
    case "BUILD_MVP":
    case "VALIDATE":
      return "The available reasoning supports testing the idea further, but key information is still missing.";
    default:
      return "Not enough information exists to responsibly reach even a provisional conclusion.";
  }
}

function actionFor(verdict: VerdictCategory): string {
  switch (verdict) {
    case "DO_NOT_BUILD":
    case "REJECT":
      return "Do not proceed with the current proposal under the available information.";
    case "PIVOT":
    case "RECONSIDER":
      return "Reconsider the current approach before committing further resources.";
    case "BUILD_MVP":
    case "VALIDATE":
      return "Validate the key assumptions with real-world evidence before committing further.";
    default:
      return "Retry the Council, or gather more information before asking again.";
  }
}

export function synthesizeProvisionalVerdict(input: SynthesisInput): CouncilVerdict {
  const { analyses, comparison, questionType, question } = input;
  const completed = analyses.filter((a) => !a.failed);

  // Nothing to synthesize — the honest degraded no-verdict state.
  if (completed.length === 0) {
    return {
      verdict: "INSUFFICIENT_INFORMATION",
      score: 0,
      confidence: 10,
      informationSufficiency: "LOW",
      summary:
        "The Council could not complete its final evaluation — the Judge failed and no completed analyses exist to synthesize from. No verdict is fabricated.",
      keyReasons: [],
      agreements: [],
      disagreements: [],
      criticalUnknowns: ["A working Judge response or completed analyses."],
      assumptions: [],
      risks: [],
      recommendedAction: "Retry the Council, or check that the model provider is healthy.",
      whatWouldChangeVerdict: ["A working Judge response."],
      reasoning:
        "Degraded fallback — the Judge did not respond with a valid verdict and there was nothing to synthesize.",
      whyThisVerdictWon:
        "No argument won: this is an explicitly degraded result, not a judgment.",
      strongestArgumentFor: "Unknown.",
      strongestArgumentAgainst: "Unknown.",
      degraded: true,
      provisional: true,
    };
  }

  const totalKeyPoints = completed.reduce((n, a) => n + a.keyPoints.length, 0);
  const totalRisks = completed.reduce((n, a) => n + a.risks.length, 0);
  const unknowns = dedupe([
    ...completed.flatMap((a) => a.missingInformation),
    ...(comparison?.missingInformation ?? []),
  ]);
  const contradictions = comparison?.contradictions.length ?? 0;
  const riskPressure = totalRisks / Math.max(1, totalRisks + totalKeyPoints);
  const successRatio = completed.length / Math.max(1, analyses.length);

  // Category ladder driven by reasoning content, not stances. A provisional
  // result caps at BUILD_MVP/VALIDATE — never a full BUILD.
  let generic: GenericCategory;
  if (riskPressure >= 0.6 || (contradictions > 0 && riskPressure >= 0.35)) {
    generic = "REJECT";
  } else if (riskPressure >= 0.35) {
    generic = "RECONSIDER";
  } else if (riskPressure >= 0.2 || unknowns.length >= 3) {
    generic = "VALIDATE";
  } else {
    generic = "BUILD_MVP";
  }

  const product = isProductType(questionType);
  const verdict = mapToSet(generic, product);

  const keyReasons = dedupe(
    completed.flatMap((a) => a.keyPoints.slice(0, 2)).slice(0, 5),
  );
  const strongestFor =
    comparison?.strongestArgument ||
    completed.find((a) => a.keyPoints[0])?.keyPoints[0] ||
    "The surviving analyses support the position (details below).";
  const strongestAgainst =
    comparison?.weakestArgument ||
    completed.flatMap((a) => a.risks)[0] ||
    "The Judge could not weigh the counterarguments.";

  const confidence = Math.max(
    10,
    Math.min(45, Math.round(25 * successRatio + 15 * (1 - riskPressure))),
  );

  return {
    verdict,
    score: SCORE_BY_GENERIC[generic],
    confidence,
    informationSufficiency: unknowns.length >= 3 ? "LOW" : "MEDIUM",
    summary: `The Council's independent analyses were completed (${completed.length} of ${analyses.length}), but the final Judge could not safely produce a verdict. This result is PROVISIONAL — synthesized from the surviving analyses. ${directionSentence(verdict)}`,
    keyReasons,
    agreements: comparison?.agreements.map((a) => a.summary).slice(0, 5) ?? [],
    disagreements: comparison?.disagreements.map((d) => d.summary).slice(0, 5) ?? [],
    criticalUnknowns: unknowns.slice(0, 6),
    assumptions: dedupe(completed.flatMap((a) => a.assumptions)).slice(0, 6),
    risks: dedupe(completed.flatMap((a) => a.risks)).slice(0, 6),
    recommendedAction: actionFor(verdict),
    whatWouldChangeVerdict: [
      ...unknowns.slice(0, 4),
      "A working Judge evaluation of the surviving analyses.",
    ],
    reasoning: `Degraded path — the Judge failed to return a structured verdict for "${question}". This provisional verdict was synthesized deterministically from the completed analyses (key points, risks, missing information and the comparison) without counting stances.`,
    whyThisVerdictWon:
      "No argument formally won — this is a degraded, provisional result. The direction reflects the balance of risks against supporting points across the surviving analyses.",
    strongestArgumentFor: strongestFor,
    strongestArgumentAgainst: strongestAgainst,
    degraded: true,
    provisional: true,
  };
}
