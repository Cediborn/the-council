import type {
  AgentKey,
  CouncilVerdict,
  FollowUpIntent,
  QuestionType,
  VerdictDiff,
} from "./types";
import { detectSmallTalk } from "./understand";

/**
 * COUNCIL V0.3 — follow-up layer (Part 8).
 *
 * 1. classifyFollowUp — deterministic intent classification of a reply after a
 *    verdict. Deterministic signals first; the API layer may escalate to the
 *    LLM understander when nothing fires (the classifier here returns
 *    `UNKNOWN` for that case).
 * 2. affectedAgentsFor — which agent lenses the new information touches, so a
 *    targeted re-analysis re-runs only those members (user decision #4).
 * 3. computeVerdictDiff — deterministic "what changed" summary between two
 *    verdicts (user decision #1 — revision diff).
 *
 * All three are pure and unit-testable.
 */

/** Regex signals, ordered by priority (check in this order). */
const EXPLANATION =
  /\b(explain|elaborate|go deeper|more detail|what did you mean|why did you (say|write|conclude)|why is|why does|what do you mean|can you (tell|walk) me|point \d|first point|second point|third point|the (second|third|first) one|unpack|clarif(y|ication)|break down)\b/i;

const CORRECTION =
  /\b(that'?s not what i meant|you misunderstood|you'?re missing|you are missing|i don'?t agree|i disagree|actually,? (no|that'?s)|no,? that'?s (not|wrong|incorrect)|you assumed|that'?s not (right|true|correct)|i'm not (trying to|looking to|doing|planning)|i don'?t care about|i already have|you got it wrong|wrong assumption)\b/i;

// "try to break it down" is an EXPLANATION request, not a challenge — so
// EXPLANATION is checked BEFORE CHALLENGE. "challenge/prove wrong/attack"
// carry no explanation words, so nothing real is misrouted.
const CHALLENGE =
  /\b(challenge|disprove|attack|stress[- ]?test|try to break (this|the|it|that|down)|break (this|the|it|that)|prove (it|this|me|that) wrong|poke holes|counter[- ]?argument|find (the|a) flaw|argue against)\b/i;

const NEW_QUESTION_SIGNAL =
  /\b(what|why|how|when|where|who|should i|is it|are there|would you|can you)\b/i;

const THREAD_REFERENCE =
  /\b(what about|how about|what if|and if|instead|but|actually|also|so then|then|rather than|instead of|what would|what changes|you said|you think|your verdict|the verdict|that point|point \d)\b/i;

// A bare "what do you think?" after a verdict continues the same deliberation
// — it is NOT a new question about a different topic.
const BARE_OPINION =
  /\b(what do you think|what would you (do|recommend|say|suggest)|what'?s your (take|opinion|verdict)|any (advice|thoughts|suggestions)|how (do|would) you (see|rate|judge|recommend))\b/i;

/** V0.3 Part 8.1 — deterministic intent classification. */
export function classifyFollowUp(
  reply: string,
): FollowUpIntent | "UNKNOWN" {
  const r = reply.trim();
  if (!r) return "UNKNOWN";

  if (CORRECTION.test(r)) return "CORRECTION";
  if (EXPLANATION.test(r)) return "EXPLANATION_REQUEST";
  if (CHALLENGE.test(r)) return "CHALLENGE";
  if (detectSmallTalk(r)) return "SMALL_TALK";

  // "what about Ghana?" references the thread → new information for the same
  // deliberation. A fresh "Should I do X?" with no thread reference is a new
  // question. Heuristic: thread-referencing starters and bare opinion asks
  // always continue; a bare question about a DIFFERENT topic starts fresh
  // only when it clearly is one.
  if (THREAD_REFERENCE.test(r)) return "NEW_INFORMATION";
  if (BARE_OPINION.test(r)) return "NEW_INFORMATION";
  if (NEW_QUESTION_SIGNAL.test(r)) return "NEW_QUESTION";

  // Anything else (a fact, a constraint, a number, a correction without the
  // exact phrasing above) is treated as new information for the deliberation.
  return "NEW_INFORMATION";
}

/** Which lens a piece of new information touches (Part 8.3 — targeted). */
export function affectedAgentsFor(
  reply: string,
  type: QuestionType,
  previousAgents: AgentKey[],
): AgentKey[] {
  const r = reply.toLowerCase();
  let preferred: AgentKey[];

  if (/\b(budget|cost|price|\$|money|fund(ing|ed)?|capital|expensive|cheap|afford|salary|income)\b/.test(r)) {
    preferred = ["practicalist", "skeptic"];
  } else if (/\b(customer|users|market|demand|audience|competitor|clients|buyers|revenue|sales|traction)\b/.test(r)) {
    preferred = ["skeptic", "perspective"];
  } else if (/\b(timeline|time|deadline|month|week|year|schedule|soon|asap|quarter)\b/.test(r)) {
    preferred = ["practicalist"];
  } else if (/\b(code|bug|error|vulnerab|security|sql|compile|server|api|database|deploy|test)\b/.test(r)) {
    preferred = ["reasoner", "skeptic"];
  } else if (/\b(math|derivative|integral|equation|formula|algebra|calculus|proof|theorem)\b/.test(r)) {
    preferred = ["reasoner"];
  } else if (/\b(option|alternative|other way|differently|perspective|fram|instead|middle ground)\b/.test(r)) {
    preferred = ["perspective"];
  } else {
    preferred = ["reasoner", "skeptic"];
  }

  // Only re-run members the previous Council actually used; fall back to the
  // two most general lenses when the preferred set has no overlap.
  const available = preferred.filter((a) => previousAgents.includes(a));
  if (available.length > 0) return [...new Set(available)];
  const fallback: AgentKey[] = (["reasoner", "skeptic"] as AgentKey[]).filter((a) =>
    previousAgents.includes(a),
  );
  return fallback.length > 0 ? fallback : previousAgents.slice(0, 2);
}

/**
 * V0.3 (Part 3 / §5) — what changed between two verdicts, computed
 * deterministically so the UI can show a compact revision diff.
 */
export function computeVerdictDiff(
  previous: CouncilVerdict | null,
  next: CouncilVerdict,
): VerdictDiff {
  if (!previous) {
    return {
      changed: false,
      verdictChanged: false,
      scoreDelta: 0,
      confidenceDelta: 0,
      reasonsAdded: [],
      reasonsRemoved: [],
      summaryNote: "",
    };
  }

  const prevReasons = new Set(previous.keyReasons.map((r) => r.trim().toLowerCase()));
  const reasonsAdded = next.keyReasons.filter((r) => !prevReasons.has(r.trim().toLowerCase()));
  const nextReasons = new Set(next.keyReasons.map((r) => r.trim().toLowerCase()));
  const reasonsRemoved = previous.keyReasons.filter((r) => !nextReasons.has(r.trim().toLowerCase()));

  const verdictChanged = previous.verdict !== next.verdict;
  const scoreDelta = Number((next.score - previous.score).toFixed(1));
  const confidenceDelta = next.confidence - previous.confidence;

  const parts: string[] = [];
  if (verdictChanged) {
    parts.push(`verdict changed from ${previous.verdict} to ${next.verdict}`);
  } else if (Math.abs(scoreDelta) >= 0.1) {
    parts.push(`score ${scoreDelta > 0 ? "up" : "down"} ${Math.abs(scoreDelta).toFixed(1)} points`);
  }
  if (Math.abs(confidenceDelta) >= 5) {
    parts.push(
      `confidence ${confidenceDelta > 0 ? "up" : "down"} ${Math.abs(confidenceDelta)}%`,
    );
  }
  if (reasonsAdded.length > 0) {
    parts.push(`new factors: ${reasonsAdded.slice(0, 2).join("; ")}`);
  }
  if (reasonsRemoved.length > 0) {
    parts.push(`dropped factors: ${reasonsRemoved.slice(0, 2).join("; ")}`);
  }

  return {
    changed: parts.length > 0,
    verdictChanged,
    scoreDelta,
    confidenceDelta,
    reasonsAdded,
    reasonsRemoved,
    summaryNote:
      parts.length > 0
        ? parts.join(" · ")
        : "The Council reconsidered and reached the same conclusion.",
  };
}
