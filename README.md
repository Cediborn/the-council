# COUNCIL — V0.2.2

A general-purpose, multi-agent **deliberation engine**. Ask it anything —
everyday decisions, school questions, business ideas, code questions, life
decisions — and it convenes several independent AI perspectives, lets them
disagree, stress-tests the emerging consensus, and returns a structured,
honest verdict.

COUNCIL is designed to optimize for **decision quality and truthfulness, not
user satisfaction**. It will tell you when you're wrong, when an idea is
weak, or when there simply isn't enough information.

## What V0.2 does

1. You enter **any** question.
2. You pick a mode: **Quick**, **Full**, or **Deep**.
3. The Council classifies the question (type + capabilities) and picks the
   relevant agents — Quick selects the 3 best-fit perspectives, Full and Deep
   run all four with the classification injected into every prompt.
4. The Council convenes — real, separate model calls per agent, running
   concurrently, never seeing each other's answers during the first round.
5. You watch the actual deliberation stages stream by — including the
   Deep-mode Reassessment after the Devil's Advocate stress-test.
6. You receive a structured verdict (score, confidence, strongest arguments,
   agreements, disagreements, contradictions, risks, assumptions, why this
   verdict won, recommended action) plus each agent's expandable analysis.
7. If anything fails mid-run — network drop, provider down, a hung model —
   the Council stays usable: completed analyses are preserved, the cause is
   explained, and you can retry or start fresh. **No page refresh is ever
   required to recover** (V0.2's headline reliability fix).

## Modes

| Mode | Pipeline |
| --- | --- |
| **Quick** | 3 analytical agents (selected by question type) → Judge |
| **Full** | Reasoner + Skeptic + Practicalist + Perspective → comparison → Judge |
| **Deep** | all four → comparison → Devil's Advocate stress-test → Reassessment → Judge |

The four analytical agents:

- **Reasoner** — the strongest objectively defensible interpretation.
- **Skeptic** — the strongest reason the conclusion might fail (not theater).
- **Practicalist** — what actually happens in the real world.
- **Perspective** — alternative framings and overlooked options.

The **Judge** does not vote. It weighs argument quality — a strong minority
argument can outweigh a weak majority. Verdicts: `BUILD`, `REFINE`,
`VALIDATE`, `RECONSIDER`, `REJECT`, `INSUFFICIENT_INFORMATION`.

## V0.2.1 changes (intelligence & reasoning)

- **Fuller taxonomy.** Question types now include `troubleshooting` and
  `argumentative`; capabilities grew to 12 (`mathematical_reasoning`,
  `comparison`, `assumption_testing`, `creativity`, plus the originals).
- **Per-agent dynamic emphasis.** In every mode, each analytical agent is
  told which of *its own* capabilities the question needs (and honestly told
  to keep its lens brief when it isn't central) — contextual Full/Deep
  reasoning without sacrificing independence.
- **Evidence quality.** Every analysis reports how strong its supporting
  evidence is (`STRONG`/`MODERATE`/`WEAK`/`UNKNOWN`), and every agent prompt
  now enforces the fact/assumption/inference/speculation discipline —
  confidence, majority opinion, and the user's assertion are never treated
  as evidence.
- **Sharper agents.** The Reasoner must call out a wrong premise; the Skeptic
  must stress-test without contrarianism and say so when an argument is
  genuinely strong; the Practicalist weighs opportunity cost and failure
  points; the Perspective may reframe the question itself.
- **Comparison finds the real disagreement.** The Comparer now names the
  strongest and weakest argument on the table and classifies each
  disagreement as FUNDAMENTAL (incompatible claims / different questions) or
  SUPERFICIAL (same position, different words) — the UI labels them.
- **Judge process.** The Judge follows an explicit 10-step reasoning
  process, calibrates confidence to the strength of the available reasoning
  (never inflated), and is instructed to be willing to say **no** — `REJECT`,
  `RECONSIDER`, or `INSUFFICIENT_INFORMATION` — without softening every
  conclusion into "has potential, but...".
- **Deep reassessment shift.** The Reassessor now reports what the stress-test
  did to the emerging conclusion — `UNCHANGED` / `STRENGTHENED` / `WEAKENED` /
  `REVERSED` — shown as a badge on the verdict.
- **Anti-yes-man & anti-contrarian prompt contracts** are pinned by
  deterministic tests, and the general-question battery (math, code,
  purchases, university, relationships, arguments…) is covered by tests too.

## V0.2.2 changes (deliberation experience & visual identity)

- **Obsidian / warm-gold identity.** The purple-heavy direction is gone.
  The Council now lives on layered near-blacks (`#080808` → `#141413`) with
  warm gold (`#d4af37`) used sparingly — active states, progress, selected
  modes, verdict highlights — over off-white text and muted warm greys.
- **The deliberation is visible, never faked.** The redesigned
  `DeliberationPanel` is a command chamber: a pipeline strip (Analyze →
  Compare → Challenge → Reassess → Judge) tracks the real SSE events, and
  every agent card has a true WAITING / ACTIVE / COMPLETE / FAILED state.
  Active agents breathe with a gold ring and signal dots; completion is a
  gold check; failure is a muted red. Stages only appear once their backend
  event has arrived.
- **Stage moments.** Comparison shows real agreement/disagreement/contradiction
  counts and labels a FUNDAMENTAL vs SUPERFICIAL disagreement when the data
  says so. Deep mode gets a distinct Devil's Advocate moment and a
  Reassessment badge driven by the actual `UNCHANGED` / `STRENGTHENED` /
  `WEAKENED` / `REVERSED` shift. The Judge cycles its real sub-process
  (weighing evidence → reviewing dissent → calibrating confidence).
- **Earned verdict.** The verdict card reveals in stages — badge, score,
  confidence, then sections — and each verdict category carries its own icon
  (shield / wrench / scales / rotate / cross / alert), so the verdict is
  never communicated by color alone.
- **Calm failure & cancellation.** Errors are now quiet and useful
  ("Council could not finish" with a reason), and cancelling shows a
  dedicated landing — "Deliberation stopped", preserved analyses, Resume +
  New question — instead of dumping you back to the home screen.
- **Reduced motion & responsiveness.** All animations respect
  `prefers-reduced-motion` via `MotionConfig reducedMotion="user"` plus CSS;
  agent cards stack on mobile instead of shrinking.

## V0.2 changes

- **Reliability (headline).** A failed Council session can never leave the
  UI stuck: every phase resolves to success, failure, or cancellation, and
  after any error the app shows *why* it failed (e.g. "make sure Ollama is
  running") with **Try again** and **New question** — no browser refresh.
- **Cancellation.** A Cancel button aborts the request, stops streaming,
  cleans up listeners, and lets you immediately ask something else.
- **Question classifier.** Every question is classified into a type
  (decision, mathematical, technical, comparison, business, planning,
  educational, creative, argumentative, troubleshooting, explanation,
  general) with an ordered capability profile. Quick mode picks the 3 agents
  whose capabilities fit best; all modes inject the classification into every
  agent prompt.
- **Deep mode is deeper.** After the Devil's Advocate stress-test, a
  Reassessment stage re-evaluates which arguments hardened, which weakened,
  and which positions changed — the Judge sees all of it.
- **The Judge never counts votes.** If the Judge fails, the Council returns
  an explicitly degraded `INSUFFICIENT_INFORMATION` verdict instead of
  deriving a verdict from stance counts. The verdict now also states **why
  this verdict won**.
- **Richer comparison.** Contradictions, missing information, risks, and
  unique insights are extracted alongside agreements and disagreements.
- **Sessions.** Every run has a session id and is recorded client-side
  (question, mode, status, completed agents, verdict, errors) — the
  foundation for future history and the Challenge flow.
- **Per-stage model routing.** Stages can be pinned to different models via
  `COUNCIL_MODEL_ANALYSIS`, `COUNCIL_MODEL_COMPARISON`,
  `COUNCIL_MODEL_DEVILS_ADVOCATE`, `COUNCIL_MODEL_REASSESSMENT`, and
  `COUNCIL_MODEL_JUDGE` env vars. Timeouts are configurable via
  `COUNCIL_TIMEOUT_MS`.
- **Sturdier parsing.** Empty-string, null, and string-wrapped JSON list
  fields no longer degrade a whole agent — the parser now handles them.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The default provider is **local Ollama** (free, no API key). It requires
Ollama to be running and a model pulled:

```bash
ollama pull qwen2.5:1.5b   # small, CPU-friendly, good at structured JSON
```

Configuration lives server-side in env vars (see `.env.example`). Cloud
providers (OpenRouter, OpenAI) are supported through the same model router
and activate automatically when their keys are set — keys never reach the
client.

### Running on machines with broken GPU drivers (e.g. old AMD laptops)

Some machines ship an Ollama default that tries to use a broken Vulkan GPU
path and crashes on any model load (`0xc0000005`). Fix: run a CPU-only
Ollama server and point the app at it. This is what the included `.env.local`
does on this machine:

```bash
# 1. start a CPU-only Ollama server on a separate port
OLLAMA_LLM_LIBRARY=cpu OLLAMA_GPU_LAYERS=0 OLLAMA_VISIBLE_DEVICES= \
  OLLAMA_HOST=127.0.0.1:11435 OLLAMA_LOAD_TIMEOUT=30m ollama serve

# 2. point the app at it (see .env.local)
OLLAMA_URL=http://127.0.0.1:11435
OLLAMA_MODEL=qwen2.5:1.5b
```

`OLLAMA_LLM_LIBRARY=cpu` is the critical piece: it forces llama-server to use
the CPU-only build so the broken GPU is never touched. First model load after
server start is slow (CPU-bound tensor loading); the model stays warm
afterwards.

## Scripts

```bash
npm run dev        # local dev server
npm run build      # production build (includes type checking)
npm run start      # serve the production build
npm run lint       # ESLint
npm run test       # Vitest unit tests
npm run typecheck  # TypeScript only
```

## Architecture

```
app/
  page.tsx                    # Council screen
  api/council/route.ts        # SSE endpoint — streams real pipeline events
components/council/
  CouncilApp.tsx              # phase state machine: idle → run → verdict/error/cancelled
  QuestionScreen.tsx          # question, mode picker, Convene button
  DeliberationPanel.tsx       # live stage visualization + Cancel
  VerdictView.tsx             # verdict card + expandable analyses + disagreement view
  ChallengeButton.tsx         # [Challenge the Council] — later version
  icons.tsx                   # hand-drawn SVG icons — no emojis
lib/council/
  agents.ts                   # agent registry + classifier (type/capabilities) + selection
  orchestrator.ts             # pipeline: classify → analyze → compare → DA → reassess → judge
  schemas.ts                  # Zod validation for every model output
  parse.ts                    # safe JSON extraction + graceful fallback
  providers/                  # model router: ollama | openai-compatible | per-stage
  usage.ts                    # per-session cost/usage tracking (future tiers)
lib/client/
  councilState.ts             # pure session state machine (testable, no React)
  useCouncil.ts               # SSE consumer wired to the state machine
lib/council/types.ts          # domain types: classification, comparison, verdict, events
tests/                        # unit tests (schemas, parsing, orchestrator, state machine)
```

## Design notes

- **Independence.** Analytical agents receive only the question and their
  role — never each other's output — until comparison. This is intentional:
  it reduces anchoring and groupthink.
- **Resilience.** If one agent fails, the Council continues with the
  survivors and the Judge is told to lower confidence. If the Judge fails, no
  verdict is fabricated — the Council returns an explicitly degraded
  `INSUFFICIENT_INFORMATION` verdict and preserves the completed analyses.
  The Council never counts stances and never derives a verdict from majority
  opinion.
- **Untrusted model output.** Every structured response is validated with
  Zod; malformed output degrades gracefully (raw text is kept, never silently
  dropped). Safe parsing rescues fenced, truncated, or prose-wrapped JSON.
- **Model routing.** `agent → model router → provider`. Ollama works out of
  the box; OpenRouter/OpenAI activate when keys are configured. Per-agent
  model routing and premium characters (VEX, AXIOM, TITAN, NEXUS, SOVEREIGN)
  will sit on top of this same capability-based engine later.
- **Future-proofing.** Usage tracking already records mode, agent count,
  model, tokens, duration, and success/failure server-side — the accounting
  layer for future Free/Pro/Sovereign tiers. No billing exists in V0.1.
- **The Challenge flow** (user counterargument → reopened case → reassessed
  verdict) is architected but not implemented; the button is honest about it.

## Security

- API keys stay server-side (env vars); the client never sees them.
- User input is validated; model output is treated as untrusted and validated
  before rendering.
- No unsafe HTML rendering; all user/model text renders as text.
- Usage logs store only structural metadata — never question text.

## Accessibility

Semantic controls, keyboard navigation, visible focus states, `aria-live`
announcements, non-color-only verdict signaling (icons + labels), and full
`prefers-reduced-motion` support.
