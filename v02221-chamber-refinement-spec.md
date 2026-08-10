# COUNCIL V0.2.2.1 — The Chamber Refinement · Specification

**Status:** Spec (no code changes yet)
**Based on:** repository as committed at `dbdeff3` (V0.2.2, pushed to `origin/main`)
**Source request:** "COUNCIL V0.2.2.1 — THE CHAMBER REFINEMENT" (refinement pass; no architecture rewrite)
**Interviews:** 4 rounds, 13 questions — answers recorded below in "Decisions"

---

## 1. Goal

A **refinement pass** over the existing Council:

1. Verify and harden Judge-failure behavior (no stance counting, ever).
2. Give the deliberation a distinctive "chamber" feel — a central Council node and
   connection lines — WITHOUT making the UI busier.
3. Present Judge failure as an unmistakable, distinct panel.
4. Preserve everything that already works (V0.2 reliability, V0.2.1 intelligence,
   V0.2.2 obsidian/gold identity).

**FINAL PRINCIPLE (from the request):** *Do NOT make Council look busier. Make it
feel more intentional.* The user should understand the process at a glance:
ANALYZE → COMPARE → CHALLENGE → REASSESS → JUDGE → VERDICT.

---

## 2. Current state (from inspection — source of truth)

### 2.1 Judge failure (already correct in code)
- `lib/council/orchestrator.ts` → `fallbackVerdict()` returns
  `{ verdict: "INSUFFICIENT_INFORMATION", score: 0, confidence: max(0, 30 - failedCount*10),
   degraded: true, ... }`. It explicitly says *"No verdict is fabricated from the surviving stances."*
- `runJudge()` catches call failures / timeouts → `fallbackVerdict(analyses)`. Malformed
  (but parseable-into-raw-text) judge output also → `fallbackVerdict`.
- **No majority-vote fallback exists.** Pinned by `tests/orchestrator.test.ts` (lines ~255, ~276).
- `degraded: true` is set ONLY by `fallbackVerdict` — a reliable signal for "the Judge did
  not complete" vs a legitimate `INSUFFICIENT_INFORMATION` the Judge chose deliberately.

### 2.2 README
- The contradiction described in the prompt is **already fixed** (V0.2.2): both
  "V0.2 changes" (§ ~135) and "Design notes" (§ ~240) state the same rule:
  Judge failure → degraded `INSUFFICIENT_INFORMATION`, never stance counting.
- Action: verify during audit + add a regression test (see §6). A short V0.2.2.1
  section may be added at the end; full rewrite is out of scope.

### 2.3 UI (relevant files)
| File | Current behavior |
|---|---|
| `components/council/CouncilApp.tsx` | Phases: idle/submitting/running/cancelled/error/complete. `MotionConfig reducedMotion="user"`. `CancelledPanel` + `ErrorPanel` with preserved analyses. Verdict phase renders `VerdictView` + "Ask another question" + `ChallengeButton`. |
| `components/council/DeliberationPanel.tsx` | `max-w-2xl`; header ("Council convened" + stage title + question + mode chips); `StagePipeline` strip; 2-col `grid` (`grid-cols-1 sm:grid-cols-2`) of `AgentCard`s from `convened.agents`; stage moments (Comparison / Devil's Advocate / Reassessment / Judge); Cancel button. |
| `components/council/VerdictView.tsx` | `Reveal` staged delays; `VerdictBadge` (icon + label + tone, never color alone); score/confidence bars; summary; strongest for/against; agreements/disagreements/assumptions/risks sections; `AgreementSummary` (stance counts + per-agent why); `ComparisonExtras`; `ReassessmentCard`; expandable `AnalysisCard`s. |
| `components/council/QuestionScreen.tsx` | Black/gold; question textarea; 3 mode cards; gold "Convene Council". |
| `components/council/ChallengeButton.tsx` | Honest "Coming in a later version" placeholder. Keep as-is. |
| `components/icons.tsx` | Hand-drawn SVGs incl. `GavelIcon`, `NodesIcon`, agent icons. No emojis. |
| `lib/client/deliberation.ts` | Pure helpers: `deriveDeliberationStage`, `agentVisual`, `stagesForMode`, `hasAnalysis`, `STAGE_LABELS`. Fully unit-tested (`tests/deliberation.test.ts`). |
| `lib/client/councilState.ts` | Pure reducer; phases; preserves events on error/cancel; session history (cap 20). |
| `lib/client/useCouncil.ts` | SSE consumer; AbortController; duplicate-submit guard; `lastVerdict` from events. |
| `lib/council/orchestrator.ts` | Pipeline: classify → 4 analysts (parallel) → comparison (FULL/DEEP) → DA (DEEP) → reassessment (DEEP) → judge. Emits `convened`, `agent:start`, `agent:done`, `stage`, `comparison`, `da:done`, `reassessment:done`, `verdict`, `error`. |
| `lib/council/types.ts` | `CouncilEvent` union; `CouncilVerdict.degraded?: boolean`; `CouncilStage`. |
| `app/api/council/route.ts` | POST → SSE stream of `CouncilEvent`s; aborts run on client disconnect; `CouncilRunError` → `error` event with preserved analyses. |
| `app/globals.css` | Obsidian `#080808`→`#141413`, gold `#d4af37`, muted greys; `dot-pulse`/`ring-pulse` keyframes OUTSIDE `@theme` (Tailwind tree-shake fix); `bg-council` atmosphere; reduced-motion CSS. |

### 2.4 Gaps vs the V0.2.2.1 request
1. **No distinct Judge-failure panel** — a failed Judge currently renders as the normal
   (degraded) verdict card.
2. **No central Council node, no connection lines** — plain 2×2 grid.
3. **No "Deliberation complete" interstitial** before the verdict reveal.
4. **No layout-state derivation helpers / tests** for the chamber geometry.
5. **No retry-judge / retry-agent capability** — and none should be added (see Decisions).

---

## 3. Decisions (from 4 interview rounds)

### Round 1 — Scope & Judge-failure core
| # | Question | Answer |
|---|---|---|
| 1 | Retry Judge? | **NO retry-judge path.** "That's the whole point of Challenge Council — it sends the Council back into deliberation." The future Challenge flow is the re-deliberation mechanism. Honest scope: preserved analyses + NEW QUESTION (+ full TRY AGAIN, see R3). |
| 2 | Failure presentation | **Distinct failure panel** — a separate "COUNCIL RESULT — INSUFFICIENT INFORMATION" panel: "The Council completed its analysis, but the final Judge could not safely produce a verdict." Preserved analyses available. NEVER shows BUILD/REFINE/VALIDATE/RECONSIDER/REJECT. |
| 3 | README contradiction | **Verify + add regression test** pinning "Judge failure → INSUFFICIENT_INFORMATION, never stance-counted" so it can't regress. (Code already correct; test will lock it.) |

### Round 2 — Chamber visualization
| # | Question | Answer |
|---|---|---|
| 4 | Desktop chamber layout | **Radial chamber** — agents visibly arranged around the central node (Reasoner + Skeptic top, Practicalist + Perspective bottom, node between). The "one Council, independent perspectives" geometry from Part 5. |
| 5 | Connection lines | **Faint always, gold when active** — thin lines visible (faint) during independent analysis; become gold + animated (draw-in/trace) during comparing, deliberation (DA/reassess), and judge — driven by real stage events, never faked. |
| 6 | Mobile | **Keep small node, drop lines** — small centered node stays visible; connection lines hidden on small screens; cards stack as today. |

### Round 3 — Cards, DA, QUICK, controls
| # | Question | Answer |
|---|---|---|
| 7 | Agent card content | **Live status only (as now)** — no static role descriptor line. The dynamic status text + chip already communicates what each agent is doing. |
| 8 | Devil's Advocate | **Gold outline + warning geometry only** — keep it gold-first within the black/gold identity; a subtle warning cue (e.g. small triangle geometry) signals the adversarial role. Replace the current tangerine-heavy treatment. |
| 9 | QUICK layout | **Keep QUICK simple** — QUICK keeps the plain stacked/grid list; the chamber geometry applies to FULL/DEEP only. |
| 10 | Failure panel controls | **NEW QUESTION + full TRY AGAIN** — TRY AGAIN re-convenes the whole Council for the same question (existing `council.run`); NEW QUESTION resets to home. |

### Round 4 — Node, reveal, verification, tests
| # | Question | Answer |
|---|---|---|
| 11 | Node emblem | **Reuse `GavelIcon`** as the central node (consistent with home-screen branding) — no new SVG artwork needed for the node itself. |
| 12 | Verdict reveal | **Add brief interstitial** — a short "Deliberation complete" settle moment (a few hundred ms) before the staged card reveal. |
| 13 | UI verification | **Retry browser_use + CSS checks** — attempt live browser verification (desktop + a real question run); fall back to compiled-CSS/keyframe checks + unit tests + live API runs if the agent is unavailable again. |
| 14 | Test scope | **Both** — judge-failure regression test AND unit tests for the new derived visual state (node/line activation). |

---

## 4. Requirements → implementation mapping

### 4.1 Judge-failure hard verification + regression test (Parts 2, 3, 18)
Already-correct behavior to be **verified by tests**, not re-implemented:
- Judge times out / provider fails / connection drops / empty response / malformed output
  → `INSUFFICIENT_INFORMATION` + `degraded: true`; completed analyses preserved;
  verdict event still emitted with `stage: "complete"`.
- `CouncilRunError` (e.g. all analysts failed, abort) → `error` event with analyses.

**Add to `tests/orchestrator.test.ts`:**
- Judge throws → `verdict.verdict === "INSUFFICIENT_INFORMATION"`, `degraded === true`,
  and NO stance-count arithmetic (e.g. even when 3 analyses SUPPORT, no BUILD verdict).
- Judge returns malformed output → same degraded result.
- Judge times out → same.
- (Existing tests at ~255/276 already cover prose-output and throw; extend with
  malformed-JSON and timeout variants.)
- Assert preserved analyses survive on the `error` path (`CouncilRunError`).

**Comments sweep:** ensure `orchestrator.ts`, `agents.ts`, `types.ts` comments contain
no stale "derive verdict from surviving stances" language. (None found at inspection —
verify during implementation.)

### 4.2 Distinct INSUFFICIENT_INFORMATION panel (Part 16, Decision 2)
- In `CouncilApp.tsx`, the `complete` phase renders `VerdictView` when the verdict is a
  real Judge result. When `council.lastVerdict.verdict.degraded === true` (signal:
  Judge did not complete — see §2.1), render a **new `InsufficientPanel`** instead.
- Panel content (per Part 16 example):
  - `COUNCIL RESULT` / `INSUFFICIENT INFORMATION`
  - "The Council completed its analysis, but the final Judge could not safely produce
    a verdict. Completed analyses remain available."
  - Preserved analyses list (reuse the same card style as `CancelledPanel`/`ErrorPanel`).
  - Controls: **[TRY AGAIN]** (full re-run, `council.run(question, mode)`) + **[NEW QUESTION]** (`council.reset`).
- MUST NOT display any of BUILD / REFINE / VALIDATE / RECONSIDER / REJECT.
- A legitimate `INSUFFICIENT_INFORMATION` from a working Judge (`degraded` falsy) still
  renders the normal `VerdictView` — it IS a valid verdict. Detection key: `degraded`.
- New component file: `components/council/InsufficientPanel.tsx` (keeps `CouncilApp` small).

### 4.3 Radial chamber + central node (Parts 5–7, Decisions 4–6, 9, 11)
- **Scope:** FULL and DEEP modes only. QUICK keeps its simple list.
- **Desktop (`sm`+):** chamber geometry —
  - Top row: Reasoner, Skeptic.
  - Bottom row: Practicalist, Perspective.
  - Center: the **Council node** (`GavelIcon` in a gold ring/emblem) positioned between
    the rows, anchored visually at the grid's center.
  - Node states (derived from real events): idle/dim → active (soft gold pulse while
    ANY analyst is ACTIVE) → prominent during comparing → settles at verdict.
- **Connection lines:** thin, low-opacity, warm-grey by default; turn gold + animate
  (draw-in / trace, slow, ~0.8–1.2s, non-looping or very subtle) when the derived stage
  is `comparing`, `devils_advocate`, `reassessing`, or `judging`. During pure
  `analyzing` they stay faint (they may even be "broken" — visually showing
  independence — until comparison begins).
- **Implementation approach (recommended):** avoid DOM-measurement-driven SVG lines.
  Use a relatively-positioned container with a static radiating-line SVG motif behind
  the node (4 thin spokes toward each card quadrant); animate opacity/stroke color via
  the derived stage. If time permits, a measured-position variant can be considered,
  but the static-motif approach is preferred for robustness + `prefers-reduced-motion`.
- **Mobile (< `sm`):** node stays visible as a small gold mark; connection lines hidden
  (`hidden sm:block` on the line layer). Cards stack vertically as today.
- **Accessibility:** node + lines are decorative (`aria-hidden="true"`, `pointer-events-none`).
- **Reduced motion:** all new animations honor `MotionConfig reducedMotion="user"` +
  existing CSS media query; static layout must remain fully legible with animation off.

### 4.4 New derived visual state (testable, Part 31/24)
- Extend `lib/client/deliberation.ts` with pure helpers, e.g.:
  - `chamberState(events, mode): { node: "IDLE" | "ACTIVE" | "PROMINENT" | "SETTLED"; lines: "OFF" | "FAINT" | "ACTIVE" }`
    derived ONLY from received events + mode (same philosophy as `deriveDeliberationStage`).
  - Node active while any analyst `agent:start` without `agent:done`; prominent on
    comparing/DA/reassess/judging stage events; settled once `verdict` arrives.
  - Lines FAINT during analyzing (FULL/DEEP only), ACTIVE from `comparing` onward,
    OFF for QUICK and for empty/mobile contexts (mobile handled in CSS, not the helper).
- `tests/deliberation.test.ts`: add unit tests for `chamberState` transitions
  (analyzing → comparing → judging → verdict; QUICK → lines OFF).

### 4.5 Devil's Advocate restyle (Part 12, Decision 8)
- Keep the existing `DevilsAdvocateMoment` structure and text
  ("What could make the Council wrong?").
- Replace tangerine accent with **gold outline + a subtle warning geometry cue**
  (e.g. small triangle/warning mark beside the label) — staying inside the black/gold
  identity. No bright orange, no new palette.

### 4.6 Verdict interstitial (Part 16, Decision 12)
- In `VerdictView` (or `CouncilApp` at verdict reveal), add a brief
  "Deliberation complete" → "Verdict" settle moment (~400–500 ms, opacity/y settle)
  before the existing staged `Reveal` sequence begins.
- Must not delay or block the real verdict state; purely presentational, honors
  reduced-motion (skip/instantly complete when reduced).

### 4.7 Keep as-is (explicit non-changes)
- `QuestionScreen`, `ChallengeButton`, `icons.tsx` (reuse `GavelIcon`, no new icons
  required — may add a tiny warning-geometry glyph if useful for §4.5),
  `councilState.ts`, `useCouncil.ts`, `route.ts`, orchestrator logic, agents/schemas/parse.
- No premium characters (VEX/AXIOM/TITAN/NEXUS/SOVEREIGN) — V0.3.
- No Challenge implementation — V0.2.3. Button stays honest.
- No purple, no rainbow, no stock art, no emojis, no new dependencies.

---

## 5. Visual identity constraints (Parts 4, 22, 32)

- **Palette:** obsidian blacks (`#080808` → `#141413`), warm gold `#d4af37` (sparing),
  off-white text, muted warm greys. Muted red only for error/failure.
- **Gold communicates:** ACTIVE, IMPORTANT, SELECTED, COUNCIL, VERDICT.
- **Restraint:** no particles, no constant glow, no spinning/bouncing, no giant gradients,
  no neon, no glassmorphism. CALM · PRECISE · PREMIUM · INTELLIGENT.
- Every state resolves to success, failure, or cancellation — no endless loading.

---

## 6. Testing plan (Part 24, 31; Decision 14)

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (scripts exist in
`package.json` — test = `vitest run`, typecheck = `tsc --noEmit`).

**New tests:**
1. `tests/orchestrator.test.ts` — Judge failure regression matrix (throw / malformed JSON /
   timeout / empty) → `INSUFFICIENT_INFORMATION` + `degraded`, never stance-counted;
   analyses preserved on error path.
2. `tests/deliberation.test.ts` — `chamberState` transitions per mode + QUICK exclusion.

**Existing coverage retained:** 109 tests (agents, councilState, deliberation, orchestrator, parse).

**Manual test questions (Part 25) via live runs:**
- "Should I buy a new phone?"
- "Explain why sqrt(x) differentiates to 1/(2sqrt(x))."
- "Is this startup idea good?"

---

## 7. Verification plan (Part 25, 32; Decision 13)

1. **Automated:** vitest + tsc + lint + production build.
2. **Compiled CSS checks:** gold tokens present, no violet, new keyframes emitted
   (watch the Tailwind v4 `@theme` tree-shake trap — new keyframes must live OUTSIDE
   `@theme` if referenced via inline styles, as `dot-pulse`/`ring-pulse` are today).
3. **Live API runs:** QUICK (should be visually simple, no chamber), FULL (chamber
   geometry + comparison lines), DEEP (chamber + DA/reassess moments).
4. **Browser (best effort):** retry `browser_use` (desktop + one question run); if
   unavailable, rely on (2)+(3)+unit tests and tell the user to eyeball visuals.
5. **Failure drill:** stop Ollama mid-run → verify the UI lands on a calm error panel
   with preserved analyses, no refresh needed. Force Judge failure (e.g. inject failing
   provider in a test) → verify the distinct `InsufficientPanel` renders.

---

## 8. Acceptance criteria (from the request's 20 success criteria)

1. Judge failure behavior unambiguous. ✅ (tests + distinct panel)
2. No majority-vote fallback exists. ✅ (verified + regression-pinned)
3. README and implementation agree. ✅ (audit)
4. Gold/black identity consistent. ✅ (no palette change)
5. Current UI preserved and refined. ✅ (no rewrites of working parts)
6. Agents feel visually connected to one Council. ✅ (chamber geometry)
7. Central Council node exists subtly. ✅ (GavelIcon emblem, FULL/DEEP)
8. Comparison visually communicates convergence. ✅ (lines → gold + active)
9. Genuine disagreement is surfaced. ✅ (existing ComparisonMoment, unchanged)
10. Devil's Advocate remains distinct. ✅ (gold + warning geometry)
11. Judge feels like the final reasoning stage. ✅ (existing JudgeMoment + interstitial)
12. Verdict feels earned. ✅ (interstitial + staged reveal)
13. No fake progress introduced. ✅ (all state derived from real events)
14. No premium characters introduced. ✅
15. Challenge not prematurely implemented. ✅
16. Mobile remains usable. ✅ (node kept small, lines dropped, cards stack)
17. Accessibility intact. ✅ (aria-hidden decor, reduced-motion)
18. Tests pass. ✅ (new + existing)
19. Build passes. ✅
20. No working functionality unnecessarily rewritten. ✅

---

## 9. Out of scope (explicit)

- RETRY JUDGE / retry-failed-agent capabilities (Challenge flow is the future
  re-deliberation path — V0.2.3+).
- Premium characters (V0.3), Challenge loop (V0.2.3), billing/tiers, accounts, memory.
- Full README rewrite, QuestionScreen redesign, new icon set, new dependencies,
  new provider/backend work, new SSE event types.

---

## 10. Open items / risks

- **Line-animation robustness:** static radiating motif chosen over DOM measurement;
  confirm it reads as "convergence" — if not convincing in browser check, iterate on
  the motif (still no measurement).
- **`degraded` as the Judge-failure signal:** relies on `fallbackVerdict` being the only
  place that sets `degraded: true`. Locked by the regression test.
- **Browser verification availability:** may fall back to compiled-CSS + API checks
  (documented in §7).

---

## 11. Suggested file touch-list (implementation order)

1. `tests/orchestrator.test.ts` — Judge-failure regression matrix.
2. `lib/client/deliberation.ts` + `tests/deliberation.test.ts` — `chamberState` helper + tests.
3. `components/council/DeliberationPanel.tsx` — radial chamber, central node, connection lines.
4. `components/council/InsufficientPanel.tsx` (new) + `components/council/CouncilApp.tsx` — wire distinct panel.
5. `components/council/VerdictView.tsx` — "Deliberation complete" interstitial.
6. `components/council/DeliberationPanel.tsx` — Devil's Advocate gold + warning geometry.
7. `README.md` — verify consistency; optional short V0.2.2.1 section.
8. Validate: `npm test` → `npm run typecheck` → `npm run lint` → `npm run build` →
   compiled-CSS checks → live API runs → best-effort browser verification.
9. Commit + push immediately after validation (per standing instruction).
