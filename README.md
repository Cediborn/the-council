# COUNCIL — V0.1

A general-purpose, multi-agent **deliberation engine**. Ask it anything —
everyday decisions, school questions, business ideas, code questions, life
decisions — and it convenes several independent AI perspectives, lets them
disagree, stress-tests the emerging consensus, and returns a structured,
honest verdict.

COUNCIL is designed to optimize for **decision quality and truthfulness, not
user satisfaction**. It will tell you when you're wrong, when an idea is
weak, or when there simply isn't enough information.

## What V0.1 does

1. You enter **any** question.
2. You pick a mode: **Quick**, **Full**, or **Deep**.
3. The Council convenes — real, separate model calls per agent, running
   concurrently, never seeing each other's answers during the first round.
4. You watch the actual deliberation stages stream by.
5. You receive a structured verdict (score, confidence, strongest arguments,
   agreements, disagreements, assumptions, risks, recommended action) plus
   each agent's expandable analysis.

## Modes

| Mode | Pipeline |
| --- | --- |
| **Quick** | 3 analytical agents (chosen for the question) → Judge |
| **Full** | Reasoner + Skeptic + Practicalist + Perspective → comparison → Judge |
| **Deep** | all four → comparison → Devil's Advocate stress-test → Judge |

The four analytical agents:

- **Reasoner** — the strongest objectively defensible interpretation.
- **Skeptic** — the strongest reason the conclusion might fail (not theater).
- **Practicalist** — what actually happens in the real world.
- **Perspective** — alternative framings and overlooked options.

The **Judge** does not vote. It weighs argument quality — a strong minority
argument can outweigh a weak majority. Verdicts: `BUILD`, `REFINE`,
`VALIDATE`, `RECONSIDER`, `REJECT`, `INSUFFICIENT_INFORMATION`.

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
  CouncilApp.tsx              # input → deliberation → verdict state machine
  QuestionScreen.tsx          # question, mode picker, Convene button
  DeliberationPanel.tsx       # live stage visualization
  VerdictView.tsx             # verdict card + expandable analyses
  ChallengeButton.tsx         # [Challenge the Council] — later version
  icons.tsx                   # hand-drawn SVG icons — no emojis
lib/council/
  agents.ts                   # agent registry + role prompts + Quick selection
  orchestrator.ts             # the pipeline: parallel analysis → compare → DA → judge
  schemas.ts                  # Zod validation for every model output
  parse.ts                    # safe JSON extraction + graceful fallback
  providers/                  # model router: ollama | openai-compatible
  usage.ts                    # per-session cost/usage tracking (future tiers)
lib/client/useCouncil.ts      # client SSE consumer
tests/                        # unit tests (schemas, parsing, orchestrator)
```

## Design notes

- **Independence.** Analytical agents receive only the question and their
  role — never each other's output — until comparison. This is intentional:
  it reduces anchoring and groupthink.
- **Resilience.** If one agent fails, the Council continues with the
  survivors and the Judge is told to lower confidence. If the Judge fails, no
  verdict is fabricated — completed analyses are preserved and a clearly
  marked degraded verdict is derived from surviving stances.
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
