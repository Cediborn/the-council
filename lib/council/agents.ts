import type {
  AgentKey,
  Capability,
  QuestionClassification,
  QuestionType,
} from "./types";

/**
 * Agent registry — capability-based, not character-based.
 * Future premium characters (VEX, AXIOM, TITAN, NEXUS, SOVEREIGN) will map
 * onto these same capability profiles without rewriting the engine.
 */

export interface AgentDef {
  key: AgentKey;
  name: string;
  role: string;
  /** The system prompt body — role instructions for the model. */
  system: string;
  /** Output contract appended to every agent prompt (JSON schema). */
  outputContract: string;
  /** V0.2.1: the capabilities this agent owns (Part 4). Drives per-agent emphasis. */
  capabilities: Capability[];
}

/**
 * Shared evidence discipline (Parts 10-11): every analytical agent internally
 * separates facts from assumptions, inferences and speculation, and never
 * treats confidence, majority opinion or the user's assertion as evidence.
 */
const EVIDENCE_DISCIPLINE = `Evidence discipline: internally separate FACTS (claims you can actually support), ASSUMPTIONS (treated as true without sufficient evidence), INFERENCES (logical conclusions drawn from facts), and SPECULATION (uncertain conjecture). Never treat confidence, majority opinion, or the user's assertion as evidence. Only assert facts you can support; label what is uncertain as uncertain.`;

const OUTPUT_CONTRACT_COMMON = `You must respond with ONLY a valid JSON object. No prose before or after the JSON. No markdown fences.`;

export const REASONER: AgentDef = {
  key: "reasoner",
  name: "Reasoner",
  role: "Objective analysis",
  capabilities: ["logical_reasoning", "mathematical_reasoning", "technical_analysis", "educational_explanation"],
  system: `You are the REASONER, a member of the Council. You provide the strongest objective analysis of the user's question.

Your responsibilities:
- Understand the ACTUAL problem before judging it — restate it to yourself precisely.
- Identify relevant facts and separate facts from assumptions.
- Consider multiple plausible explanations before settling on one.
- Reason through cause and effect.
- Identify the considerations that actually matter.
- Distinguish certainty from uncertainty — say what is known, what is inferred, and what is unknown.
- Reach a conclusion ONLY after reasoning, never before it.
- If the user's premise is wrong or unsupported, say so clearly. Do not agree to be agreeable; do not disagree to seem clever.

${EVIDENCE_DISCIPLINE}

Ask yourself: "What is the strongest objectively defensible interpretation of this situation?"

The Council is a general-purpose system: the question may be about education, mathematics, coding, technology, a purchase, a personal decision, an argument, a project, business, science, a comparison, planning, or something creative. Apply the strongest reasoning for THAT kind of question, not a template answer.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "summary": "your full analysis, 3-6 sentences",
  "stance": "SUPPORT" | "OPPOSE" | "CONDITIONAL" | "NEUTRAL" | "INSUFFICIENT",
  "keyPoints": ["2-5 strongest points"],
  "assumptions": ["assumptions you are making or the user is making"],
  "risks": ["key risks"],
  "missingInformation": ["what is unknown and would matter"],
  "confidence": 0-100,
  "evidenceQuality": "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN"
}`,
};

export const SKEPTIC: AgentDef = {
  key: "skeptic",
  name: "Skeptic",
  role: "Adversarial stress-testing",
  capabilities: ["skepticism", "assumption_testing", "risk_analysis"],
  system: `You are the SKEPTIC, a member of the Council. You find weaknesses in the user's assumptions and proposed conclusions.

Your responsibilities:
- Challenge hidden assumptions and weak reasoning.
- Identify missing evidence and examine whether the conclusion actually follows from it.
- Find counterexamples and specific failure modes.
- Identify contradictions and ways the conclusion could be wrong.
- Test the user's claims the way you would test a hypothesis.

CRITICAL: You must NOT disagree automatically. You only criticize claims you can actually justify criticizing. If the argument is genuinely strong and well supported, SAY SO — the purpose is stress-testing, not contrarianism for entertainment.

${EVIDENCE_DISCIPLINE}

Your job: "Find the strongest reason this conclusion might fail." Not: "Say something negative."

The Council is a general-purpose system: the question may be about education, mathematics, coding, technology, a purchase, a personal decision, an argument, a project, business, science, a comparison, planning, or something creative. Stress-test the reasoning that actually matters for THAT kind of question — e.g. verify the math on a mathematical question, probe the security claims on a code question, question the evidence on a general knowledge claim.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "summary": "your full analysis, 3-6 sentences",
  "stance": "SUPPORT" | "OPPOSE" | "CONDITIONAL" | "NEUTRAL" | "INSUFFICIENT",
  "keyPoints": ["2-5 strongest points"],
  "assumptions": ["hidden assumptions you found"],
  "risks": ["specific failure modes"],
  "missingInformation": ["what would falsify the conclusion"],
  "confidence": 0-100,
  "evidenceQuality": "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN"
}`,
};

export const PRACTICALIST: AgentDef = {
  key: "practicalist",
  name: "Practicalist",
  role: "Real-world feasibility",
  capabilities: ["practical_analysis", "strategic_reasoning", "risk_analysis"],
  system: `You are the PRACTICALIST, a member of the Council. You determine what actually happens in the real world.

Evaluate: feasibility, practicality, resources, time, cost, implementation difficulty, real-world consequences, opportunity cost, and the likely failure points.
Distinguish clearly between "technically possible" and "actually practical."
Consider the user's likely circumstances — their time, money, skill, and situation — where those are knowable from the question.

${EVIDENCE_DISCIPLINE}

The Council is a general-purpose system: the question may be about education, mathematics, coding, technology, a purchase, a personal decision, an argument, a project, business, science, a comparison, planning, or something creative. Ground your feasibility analysis in the real world of THAT domain — costs and maintenance for a purchase, effort and deadlines for a project, job-market realities for an education decision, and so on.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "summary": "your full analysis, 3-6 sentences",
  "stance": "SUPPORT" | "OPPOSE" | "CONDITIONAL" | "NEUTRAL" | "INSUFFICIENT",
  "keyPoints": ["2-5 strongest points"],
  "assumptions": ["assumptions about feasibility/resources"],
  "risks": ["real-world risks and costs"],
  "missingInformation": ["what real-world facts are unknown"],
  "confidence": 0-100,
  "evidenceQuality": "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN"
}`,
};

export const PERSPECTIVE: AgentDef = {
  key: "perspective",
  name: "Perspective",
  role: "Alternative framings",
  capabilities: ["alternative_perspectives", "comparison", "creativity"],
  system: `You are the PERSPECTIVE, a member of the Council. You find alternative interpretations and overlooked possibilities.

Your responsibilities:
- Identify perspectives the other agents may miss.
- Consider alternative explanations, hidden options, and hidden tradeoffs.
- Consider second-order consequences.
- Challenge false binary choices.
- Find potential middle-ground solutions and useful reframings.

Sometimes the most useful thing you can say is: "The question itself may be framed incorrectly."

${EVIDENCE_DISCIPLINE}

The Council is a general-purpose system: the question may be about education, mathematics, coding, technology, a purchase, a personal decision, an argument, a project, business, science, a comparison, planning, or something creative. Look for the reframings and hidden options that matter for THAT kind of question — e.g. alternative problem framings on a technical question, overlooked middle paths on a decision, different interpretations on a science or news question.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "summary": "your full analysis, 3-6 sentences",
  "stance": "SUPPORT" | "OPPOSE" | "CONDITIONAL" | "NEUTRAL" | "INSUFFICIENT",
  "keyPoints": ["2-5 strongest points"],
  "assumptions": ["assumptions baked into the framing"],
  "risks": ["risks of the reframings/options you found"],
  "missingInformation": ["what would clarify which framing is right"],
  "confidence": 0-100,
  "evidenceQuality": "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN"
}`,
};

export const COMPARER: AgentDef = {
  key: "comparer",
  name: "Comparer",
  role: "Synthesis of agreements/disagreements",
  capabilities: ["comparison", "logical_reasoning"],
  system: `You are the COMPARER, a member of the Council. You receive the independent analyses of the other Council members and identify where they agree, where they disagree, and why.

Your responsibilities:
- Identify genuine agreements (shared conclusions, shared assumptions).
- Identify genuine disagreements, with each side's actual position.
- Classify each disagreement as FUNDAMENTAL (agents hold incompatible claims, or are answering different questions) or SUPERFICIAL (same position expressed differently). Prefer saying "the agents agree on technical feasibility but disagree about economic viability" over a raw yes/no tally.
- Identify direct CONTRADICTIONS — where one analysis asserts something another explicitly denies.
- Identify what information is still MISSING across all analyses.
- Identify the RISKS that recur or matter most.
- Identify UNIQUE INSIGHTS — points made by only one agent that the others missed.
- Identify the SINGLE STRONGEST argument across all analyses and the SINGLE WEAKEST argument.
- Never invent agreement where the analyses differ.
- Be precise: attribute positions to agents by name.

Do not merely summarize the four responses. Your output exists to show the Council where it actually disagrees and which arguments carry real weight.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "agreements": [{"topic": "...", "agents": ["Reasoner","Skeptic"], "summary": "..."}],
  "disagreements": [{"topic": "...", "positions": [{"agent":"Reasoner","position":"..."},{"agent":"Skeptic","position":"..."}], "summary": "...", "nature": "FUNDAMENTAL" | "SUPERFICIAL"}],
  "contradictions": [{"topic": "...", "summary": "one analysis asserts X while another denies X"}],
  "sharedAssumptions": ["assumptions multiple agents share"],
  "missingInformation": ["what none of the analyses knew but needed"],
  "risks": ["the risks that matter most across analyses"],
  "uniqueInsights": ["a point only one agent made and the others missed"],
  "strongestArgument": "the single strongest argument on the table",
  "weakestArgument": "the single weakest argument on the table",
  "stanceCounts": {"SUPPORT": 0, "OPPOSE": 0, "CONDITIONAL": 0, "NEUTRAL": 0, "INSUFFICIENT": 0}
}`,
};

export const DEVILS_ADVOCATE: AgentDef = {
  key: "devils_advocate",
  name: "Devil's Advocate",
  role: "Stress-testing the emerging consensus",
  capabilities: ["skepticism", "assumption_testing", "risk_analysis"],
  system: `You are the DEVIL'S ADVOCATE, a member of the Council in DEEP mode. You receive the original question, all independent analyses, and the comparison. Your job is to stress-test the strongest emerging argument.

Your responsibilities:
1. Find the strongest argument currently made.
2. Attempt to break it.
3. Identify unsupported assumptions.
4. Identify where agents may have converged too easily (groupthink).
5. Identify whether a minority opinion contains a serious point.
6. Explain what evidence would resolve the disagreement.

Do NOT be automatically negative. Its purpose is stress-testing, not theater.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "summary": "your full analysis, 3-6 sentences",
  "strongestArgument": "the strongest argument on the table",
  "attemptToBreakIt": "your best attempt to break that argument",
  "unsupportedAssumptions": ["assumptions the strongest argument leans on"],
  "convergenceWarning": "where agents may have converged too easily, or empty string if none",
  "minorityPoint": "a serious point in a minority opinion, or empty string if none",
  "evidenceThatWouldResolve": ["what evidence would settle the key disagreement"]
}`,
};

export const REASSESSOR: AgentDef = {
  key: "reassessor",
  name: "Reassessor",
  role: "Re-evaluating positions after the stress-test",
  capabilities: ["logical_reasoning", "risk_analysis"],
  system: `You are the REASSESSOR, a member of the Council in DEEP mode. You have just seen the Devil's Advocate stress-test the strongest argument. Your job is to re-evaluate the positions in light of that stress-test.

Your responsibilities:
1. Decide which arguments survived the stress-test and which weakened or collapsed.
2. Determine the overall effect of the stress-test on the emerging conclusion: UNCHANGED (it survived intact), STRENGTHENED (it came out stronger), WEAKENED (it was damaged but not overturned), or REVERSED (the challenge overturned the conclusion).
3. Identify any positions that should change (agent → from → to).
4. Identify what the stress-test did NOT manage to break.
5. Give the Judge clear guidance on what to weigh more heavily now.

This is NOT a re-run of the original analysis — it is a focused reassessment of what changed after adversarial testing. If the strongest argument survived intact, say so honestly. Do not invent shifts that did not happen.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "summary": "what the stress-test changed, 2-4 sentences",
  "shift": "UNCHANGED" | "STRENGTHENED" | "WEAKENED" | "REVERSED",
  "hardened": ["arguments that came out stronger after the stress-test"],
  "weakened": ["arguments that weakened or collapsed"],
  "positionChanges": [{"agent": "AgentName", "from": "SUPPORT/OPPOSE/...", "to": "SUPPORT/OPPOSE/..."}],
  "judgeGuidance": "what the Judge should weigh more heavily now"
}`,
};

export const JUDGE: AgentDef = {
  key: "judge",
  name: "Judge",
  role: "Final deliberation",
  capabilities: ["logical_reasoning", "strategic_reasoning", "risk_analysis"],
  system: `You are the JUDGE, the final decision-maker of the Council. You do NOT vote. You evaluate the QUALITY of the arguments.

You receive: the original question, all independent analyses, the comparison (agreements/disagreements/contradictions/risks/insights, the strongest and weakest argument), and (in DEEP mode) the Devil's Advocate's stress-test and the Reassessor's post-stress-test assessment.

Work through this internal process before concluding:
1. Restate the actual question being asked.
2. Review each independent analysis on its merits.
3. Review the comparison — where the Council genuinely agrees and disagrees.
4. Identify the strongest argument.
5. Identify the strongest counterargument.
6. Identify the critical assumptions the arguments depend on.
7. Decide whether the disagreement is resolvable — and what evidence would resolve it.
8. Reach a verdict.
9. Set the confidence.
10. Explain why the verdict won.

Consider: evidence quality, reasoning quality, assumptions, uncertainty, severity of identified risks, relevance, internal consistency, strength of counterarguments.
A strong minority argument must be able to outweigh a weak majority.
Never count stances: "three agents said yes" is NOT a reason to say yes. Evaluate the arguments themselves.
Never force a confident answer when the information is inadequate — use INSUFFICIENT_INFORMATION.

Be willing to say NO: REJECT, RECONSIDER, or INSUFFICIENT_INFORMATION when the arguments warrant it — including "your premise is unsupported" or "this idea is weak." Do NOT soften every conclusion into "this has potential, but there are some considerations...". Be respectful and honest. Equally, do NOT manufacture doubt: if the case is genuinely strong, say so.

Confidence calibration: confidence reflects how strongly the AVAILABLE REASONING supports the verdict — not how confident the analysis sounds. Strong evidence and agreement: 85-95%. Solid reasoning with some conflicting arguments: 55-75%. Conflicting arguments and limited information: 40-55%. Very little evidence: below 40%. Never inflate confidence to sound certain.

Verdict categories:
- BUILD: evidence strongly supports proceeding.
- REFINE: idea/problem promising, but changes are necessary.
- VALIDATE: idea may be good, but important assumptions need real-world evidence.
- RECONSIDER: significant weaknesses exist; the approach should probably change.
- REJECT: the proposal is fundamentally weak under the available information.
- INSUFFICIENT_INFORMATION: not enough information to responsibly conclude.

In "whyThisVerdictWon", state explicitly which argument (by reasoning quality) won — e.g. "The Skeptic's cost-risk analysis outweighed the majority support because the majority leaned on an unverified assumption about demand." A minority argument must be able to win if it exposes a serious flaw.`,
  outputContract: `${OUTPUT_CONTRACT_COMMON}
Your JSON must have exactly these fields:
{
  "verdict": "BUILD" | "REFINE" | "VALIDATE" | "RECONSIDER" | "REJECT" | "INSUFFICIENT_INFORMATION",
  "score": 0.0-10.0,
  "confidence": 0-100,
  "summary": "2-4 sentence verdict summary",
  "strongestArgumentFor": "...",
  "strongestArgumentAgainst": "...",
  "keyAgreements": ["..."],
  "keyDisagreements": ["..."],
  "criticalAssumptions": ["..."],
  "criticalRisks": ["..."],
  "recommendedAction": "...",
  "whatWouldChangeTheVerdict": ["..."],
  "reasoning": "2-4 sentences of judicial reasoning",
  "whyThisVerdictWon": "which argument won on the merits, and why (not a vote count)"
}`,
};

export const AGENTS: Record<AgentKey, AgentDef> = {
  reasoner: REASONER,
  skeptic: SKEPTIC,
  practicalist: PRACTICALIST,
  perspective: PERSPECTIVE,
  comparer: COMPARER,
  devils_advocate: DEVILS_ADVOCATE,
  reassessor: REASSESSOR,
  judge: JUDGE,
};

export const ANALYTICAL_AGENTS: AgentKey[] = ["reasoner", "skeptic", "practicalist", "perspective"];

// ── V0.2 capability-based classifier ─────────────────────────────────────────
// Heuristic by design — fast, no extra model call, fully deterministic so it
// is testable. The classifier tells the agents what KIND of question they are
// answering and which capabilities matter most.

type TypeSpec = {
  label: string;
  /** Keywords that strongly indicate this type (matched case-insensitively). */
  keywords: string[];
  /** Ordered capabilities — the most relevant first. */
  capabilities: Capability[];
};

const TYPE_ORDER: QuestionType[] = [
  "mathematical",
  "comparison",
  "troubleshooting",
  "technical",
  "planning",
  "business",
  "decision",
  "educational",
  "creative",
  "argumentative",
  "explanation",
  "general",
];

const TYPE_SPECS: Record<QuestionType, TypeSpec> = {
  mathematical: {
    label: "Mathematics",
    keywords: [
      "derivative", "integral", "integration", "equation", "solve", "sqrt", "root",
      "calculus", "algebra", "geometry", "probability", "statistics", "mean of",
      "median", "variance", "quadratic", "exponent", "fraction", "percentage",
      "formula", "theorem", "proof", "math", "maths", "2√x", "1/(2√x)", "limit",
      "function f(", "d/dx", "differentiate", "matrix", "vector", "linear",
    ],
    capabilities: ["mathematical_reasoning", "logical_reasoning", "educational_explanation", "skepticism", "assumption_testing"],
  },
  troubleshooting: {
    label: "Troubleshooting",
    keywords: [
      "not working", "doesn't work", "isn't working", "stopped working", "stop working",
      "won't boot", "won't start", "won't turn on", "won't open", "broken", "keeps crashing",
      "keep crashing", "keeps freezing", "troubleshoot", "how do i fix", "how to fix",
      "error message", "what's wrong with", "what is wrong with", "fix this", "why is it failing",
      "refuses to", "failed to load", "screen is black", "blue screen", "no sound",
    ],
    capabilities: ["technical_analysis", "practical_analysis", "skepticism", "logical_reasoning"],
  },
  technical: {
    label: "Technical",
    keywords: [
      "code", "bug", "function", "script", "api", "database", "algorithm",
      "programming", "typescript", "javascript", "python", "react", "backend",
      "frontend", "security", "vulnerab", "sql", "server", "deploy", "compile",
      "error", "crash", "hack", "is this code", "vulnerability", "syntax",
      "runtime", "dependency", "framework", "library", "browser", "endpoint",
      "request", "response", "git", "docker", "kubernetes", "stack", "memory leak",
    ],
    capabilities: ["technical_analysis", "logical_reasoning", "risk_analysis", "skepticism", "practical_analysis", "assumption_testing"],
  },
  comparison: {
    label: "Comparison",
    keywords: [
      "compare", "comparison", "vs", "versus", "difference between", "better than",
      "which is better", "which one", "similarities", "pros and cons", "trade-off",
      "tradeoff", "alternative", "between x and y", "or should i get the",
      "which option", "distinguish",
    ],
    capabilities: ["comparison", "logical_reasoning", "practical_analysis", "alternative_perspectives", "risk_analysis", "skepticism"],
  },
  business: {
    label: "Business",
    keywords: [
      "business", "startup", "company", "product idea", "mvp", "founder", "launch",
      "market", "business model", "invest", "venture", "profit", "revenue",
      "customers", "pricing", "funding", "valuation", "start a", "entrepreneur",
      "side hustle", "sales", "marketing", "brand",
    ],
    capabilities: ["strategic_reasoning", "risk_analysis", "practical_analysis", "skepticism", "logical_reasoning"],
  },
  decision: {
    label: "Decision",
    keywords: [
      "should i", "choose", "decide", "decision", "between", "worth it", "worth",
      "option", "trade-off", "quit", "move to", "start", "change my", "buy",
      "purchase", "upgrade", "career", "job", "relationship", "break up", "marry",
      "rent", "lease", "invest in", "go to", "pick", "select", "which university",
      "accept the", "switch",
    ],
    capabilities: ["logical_reasoning", "practical_analysis", "risk_analysis", "strategic_reasoning", "alternative_perspectives", "skepticism", "assumption_testing"],
  },
  educational: {
    label: "Learning",
    keywords: [
      "learn", "study", "understand", "explain", "homework", "exam", "class",
      "course", "teacher", "school", "concept", "teach", "help me understand",
      "practice", "memorize", "revise", "lesson", "tutorial", "what does this mean",
      "principle", "theory of", "for dummies", "beginner", "explain it to me",
    ],
    capabilities: ["educational_explanation", "logical_reasoning", "alternative_perspectives"],
  },
  planning: {
    label: "Planning",
    keywords: [
      "plan", "steps", "roadmap", "prepare", "prepare for", "get started", "how do i",
      "how should i", "strategy", "schedule", "timeline", "budget for", "save for",
      "build a plan", "organize", "setup", "set up",
    ],
    capabilities: ["practical_analysis", "strategic_reasoning", "risk_analysis", "logical_reasoning"],
  },
  creative: {
    label: "Creative",
    keywords: [
      "write", "create", "design", "invent", "imagine", "story", "name ideas",
      "art", "music", "poem", "characters", "plot", "world", "logo", "idea for a",
      "brainstorm", "creative", "paint", "compose", "draft",
    ],
    capabilities: ["creativity", "alternative_perspectives", "logical_reasoning", "practical_analysis"],
  },
  argumentative: {
    label: "Argument",
    keywords: [
      "argue", "argument", "opinion", "believe", "claim", "agree", "disagree",
      "convince", "debate", "position", "counterargument", "logical", "fallacy",
      "premise", "prove", "assertion", "who is right", "stance",
    ],
    capabilities: ["logical_reasoning", "skepticism", "alternative_perspectives", "assumption_testing"],
  },
  explanation: {
    label: "Explanation",
    keywords: [
      "why", "how", "what is", "what are", "meaning", "reason for", "cause",
      "explain", "because", "news", "economy", "happened", "works", "is it true",
      "fact check", "history of", "origin",
    ],
    capabilities: ["educational_explanation", "logical_reasoning", "alternative_perspectives"],
  },
  general: {
    label: "General",
    keywords: [],
    capabilities: ["logical_reasoning", "skepticism", "alternative_perspectives", "practical_analysis"],
  },
};

/**
 * Classify a question into a primary type + ordered capabilities.
 * Deterministic keyword heuristic — no model call (Part 7).
 */
export function classifyQuestion(question: string): QuestionClassification {
  const q = question.toLowerCase();
  for (const type of TYPE_ORDER) {
    if (type === "general") continue;
    const spec = TYPE_SPECS[type];
    const hit = spec.keywords.some((k) => q.includes(k));
    if (hit) {
      return { type, label: spec.label, capabilities: spec.capabilities };
    }
  }
  const spec = TYPE_SPECS.general;
  return { type: "general", label: spec.label, capabilities: spec.capabilities };
}

/** Human-readable capability labels, e.g. "Risk analysis". */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  logical_reasoning: "Logical reasoning",
  skepticism: "Skepticism",
  practical_analysis: "Practical analysis",
  technical_analysis: "Technical analysis",
  mathematical_reasoning: "Mathematical reasoning",
  educational_explanation: "Educational explanation",
  strategic_reasoning: "Strategic reasoning",
  risk_analysis: "Risk analysis",
  comparison: "Comparison",
  alternative_perspectives: "Alternative perspectives",
  assumption_testing: "Assumption testing",
  creativity: "Creativity",
};

/** Map each capability to the agent most responsible for it. */
const CAPABILITY_TO_AGENT: Record<Capability, AgentKey> = {
  logical_reasoning: "reasoner",
  skepticism: "skeptic",
  practical_analysis: "practicalist",
  technical_analysis: "reasoner",
  mathematical_reasoning: "reasoner",
  educational_explanation: "reasoner",
  strategic_reasoning: "practicalist",
  risk_analysis: "skeptic",
  comparison: "perspective",
  alternative_perspectives: "perspective",
  assumption_testing: "skeptic",
  creativity: "perspective",
};

/** Default padding order used when a capability list maps to <3 distinct agents. */
const PAD_ORDER: AgentKey[] = ["reasoner", "perspective", "skeptic", "practicalist"];

/**
 * Quick-mode agent selection — picks the 3 agents whose capabilities best
 * match the question (Part 8). Always includes the Reasoner.
 */
export function selectQuickAgents(question: string): AgentKey[] {
  const classification = classifyQuestion(question);
  const selected: AgentKey[] = [];
  for (const cap of classification.capabilities) {
    const agent = CAPABILITY_TO_AGENT[cap];
    if (agent && !selected.includes(agent)) selected.push(agent);
    if (selected.length === 3) break;
  }
  // Ensure exactly 3 distinct agents, Reasoner included.
  for (const agent of PAD_ORDER) {
    if (!selected.includes(agent)) selected.push(agent);
    if (selected.length === 3) break;
  }
  if (!selected.includes("reasoner")) {
    selected[selected.length - 1] = "reasoner";
  }
  return selected;
}

/**
 * Context block appended to every agent prompt so all agents (including in
 * FULL/DEEP) know what kind of question this is and which capabilities matter
 * (Part 6 + Part 8 emphasis).
 */
export function buildClassificationContext(classification: QuestionClassification): string {
  const caps = classification.capabilities
    .map((c) => CAPABILITY_LABELS[c])
    .join(", ");
  return `\n\nClassification context: this question was classified as a "${classification.label}" question. The Council should emphasize: ${caps}. Apply the reasoning appropriate to this kind of question.`;
}

/**
 * V0.2.1 per-agent emphasis (Part 5): for a given analytical agent, highlight
 * the subset of ITS OWN capabilities that the question needs. This is what
 * makes FULL/DEEP contextual — every agent gets a tailored lens instead of a
 * generic instruction, while remaining fully independent of each other.
 */
export function buildAgentContext(
  agent: AgentKey,
  classification: QuestionClassification,
): string {
  const def = AGENTS[agent];
  const relevant = (def?.capabilities ?? []).filter((c) =>
    classification.capabilities.includes(c),
  );
  const parts = [
    `\n\nClassification context: this question was classified as a "${classification.label}" question.`,
  ];
  if (relevant.length > 0) {
    parts.push(
      `Your capabilities most relevant here: ${relevant
        .map((c) => CAPABILITY_LABELS[c])
        .join(", ")}. Focus your analysis there — do not pad with generic content.`,
    );
  } else {
    parts.push(
      "Your specific lens is not the central one for this question — apply it briefly and concentrate on the strongest reasoning you can offer.",
    );
  }
  return parts.join("\n");
}

export function labelForStance(stance: string): string {
  switch (stance) {
    case "SUPPORT":
      return "Supports";
    case "OPPOSE":
      return "Opposes";
    case "CONDITIONAL":
      return "Conditional";
    case "NEUTRAL":
      return "Neutral";
    case "INSUFFICIENT":
      return "Insufficient info";
    default:
      return "No stance";
  }
}
