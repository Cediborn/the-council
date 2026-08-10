# COUNCIL — Critical Pipeline + UX Fix (Spec)

**Version target:** V0.2.2.2 (continuation of V0.2.2.1)
**Status:** Spec only — no code changes made.
**Date:** 2026-08-10
**Source request:** "THE COUNCIL — CRITICAL PIPELINE + UX FIX"

---

## 1. Overview

Fix the Council's reasoning pipeline, result persistence, inspectability, loading
experience, and Judge behavior **without redesigning the application** or changing
the obsidian/gold visual identity. Preserve the existing design system, components,
routes, branding, and working functionality.

The core user-visible failures being fixed:

1. The Judge lazily returns **"Insufficient information"** instead of a provisional
   verdict.
2. A Judge failure makes the session look like a dead end — individual analyses are
   truncated and **not expandable**, so the Council's work is effectively hidden.
3. Some expandable/collapsible sections don't open (or aren't present where they
   should be).
4. Results are **not persisted** — refreshing the page loses everything.
5. No way to **retry a single failed agent** without re-running the whole Council.
6. FAILED vs TIMED OUT vs NOT STARTED are not distinguished.
7. No per-stage timing data, so slow spots are invisible.

---

## 2. Current-state audit (verified against the code)

| Area | Current state |
|---|---|
| Pipeline | QUICK = 3 agents → Judge. FULL = 4 agents → comparison → Judge. DEEP = 4 agents → comparison → Devil's Advocate → Reassessment → Judge. Analysts **already run concurrently** (`Promise.all` in `orchestrator.ts`). Comparison → DA → Reassess → Judge are dependency-sequential. |
| SSE | `convened` → per-agent `agent:start`/`agent:done` (as each finishes) → `stage`/`comparison` → `da:done` → `reassessment:done` → `judging` → `verdict`/`error`. Live per-agent status already streams. |
| Judge schema | `verdict` (BUILD/REFINE/VALIDATE/RECONSIDER/REJECT/INSUFFICIENT_INFORMATION), `score` 0–10, `confidence` 0–100, `summary`, `strongestArgumentFor/Against`, `keyAgreements`, `keyDisagreements`, `criticalAssumptions`, `criticalRisks`, `recommendedAction`, `whatWouldChangeTheVerdict`, `reasoning`, `whyThisVerdictWon`. |
| Judge prompt | **Actively encourages the cop-out**: "Never force a confident answer when the information is inadequate — use INSUFFICIENT_INFORMATION." On a small local model this becomes an escape hatch. |
| Judge failure | V0.2.2.1: `fallbackVerdict()` → degraded `INSUFFICIENT_INFORMATION`, score 0, confidence dropped, `degraded: true`. No stance counting. Analyses preserved **but** the `InsufficientPanel` renders them as `line-clamp-2` summaries with **no expander**. |
| Expandables | `VerdictView`'s `AnalysisCard`/`DevilsAdvocateCard` expanders look correct in code (useState + AnimatePresence). `InsufficientPanel`, `CancelledPanel`, `ErrorPanel` list analyses with **no expansion at all**. |
| Persistence | Only usage logs (`usage.ts` → `.data/council-usage.ndjson`, no question/results). Client `history` (councilState) is in-memory, capped at 20, **lost on refresh**. |
| Members | Reasoner, Skeptic, Practicalist, Perspective (+ Comparer, Devil's Advocate, Reassessor, Judge). **No VEX/AXIOM/TITAN/NEXUS/SOVEREIGN.** |
| Retry | "Try again" / "Resume" re-runs the **entire** Council. No resumable sessions. |
| Timeout handling | Providers have timeouts internally, but a timeout is recorded as a generic `failed: true` — no TIMED OUT attribution. |
| Usage | `CouncilUsage` has totals (`agentCalls`, `durationMs`) but no per-stage durations. |

---

## 3. Interview decisions (4 rounds, 14 answers)

| # | Question | Decision |
|---|---|---|
| 1 | Verdict taxonomy | **Type-dependent sets.** Product-ish types use BUILD / BUILD_MVP / PIVOT / DO_NOT_BUILD; other types keep the current 6-category set. |
| 2 | Council members | **Keep generic agents** (Reasoner/Skeptic/Practicalist/Perspective). The character names in the request are illustrative; V0.3 stays V0.3. |
| 3 | Judge-failure vs cop-out | **Unify both paths**: a failed Judge still emits a provisional verdict structure when analyses exist. |
| 4 | Persistence | **localStorage (client-side)**: last N completed sessions survive refresh. |
| 5 | Expandable bug surfaces | **Normal verdict card + Judge-failure panel + "everywhere/unsure"** → audit ALL expandable surfaces, make the pattern consistent everywhere. |
| 6 | Mid-run expandability | **After completion only** (for now — may change later). |
| 7 | Score field | **Keep score 0–10.** |
| 8 | Verdict schema shape | **Adapt current → new**: rename/map current fields onto the new contract + add `informationSufficiency`, `criticalUnknowns`, `keyReasons`. One schema for all question types. |
| 9 | Failed-Judge degradation | **Deterministic synthesizer**: read `keyPoints`/`risks`/comparison of completed analyses and pick the most defensible provisional category, clearly labeled degraded. (Preserves "never count stances".) |
| 10 | Pipeline states | **New state machine**: explicit IDLE / ANALYZING / PARTIAL_RESULTS / COUNCIL_COMPLETE / JUDGING / COMPLETE / DEGRADED / FAILED (+ CANCELLED retained). |
| 11 | Failed-agent retry | **Per-agent retry now** — resumable sessions (server re-runs only the failed member). |
| 12 | Timeout attribution | **Distinguish** FAILED / TIMED OUT / NOT STARTED per member. |
| 13 | Type mapping | **Wide + agree mapping**: `business`, `decision`, `planning`, `comparison`, `troubleshooting`, `creative` → product set. `explanation`, `mathematical`, `educational`, `argumentative`, `general` → current set. Mapping: BUILD_MVP ≈ VALIDATE/REFINE, PIVOT ≈ RECONSIDER, DO_NOT_BUILD ≈ REJECT, BUILD stays BUILD. |
| 14 | Performance/durations | **Per-stage durations** tracked and surfaced in the verdict meta + usage record. |

---

## 4. Detailed design

### 4.1 Part 1 — Judge "insufficient information" behavior

**Goal:** the Judge stops using INSUFFICIENT_INFORMATION as a default escape.

- **A. Information sufficiency** — new field `informationSufficiency: "HIGH" | "MEDIUM" | "LOW"` on the verdict. Prompted explicitly.
- **B. Verdict** — type-dependent (see 4.2).
- **Rule added to the Judge prompt (both sets):**
  - When information is incomplete, still produce a **provisional verdict** using the
    best available reasoning, set `informationSufficiency` to LOW/MEDIUM, list
    `criticalUnknowns`, and note in `whatWouldChangeVerdict` what evidence would firm
    up the decision.
  - INSUFFICIENT_INFORMATION (general set) / the degraded no-verdict state (product
    set) is reserved for when making **any** recommendation would be genuinely
    irresponsible — never for convenience.
- **Example behavior** (product set): `BUILD_MVP`, confidence 61%, sufficiency LOW,
  criticalUnknowns = ["Will users use it repeatedly?", "How strong is the
  competition?", "Will users pay?"].

### 4.2 Part 6 — Judge output contract (adapted)

One schema, type-dependent verdict enum. The current fields are renamed/mapped onto
the new contract; `score`, `reasoning`, `whyThisVerdictWon`, `recommendedAction`, and
`strongestArgumentFor/Against` are **retained** (the UI and the "why it won"
principle depend on them).

```ts
// VerdictCategory becomes a union of the two sets:
type VerdictCategory =
  | "BUILD" | "BUILD_MVP" | "PIVOT" | "DO_NOT_BUILD"          // product set
  | "REFINE" | "VALIDATE" | "RECONSIDER" | "REJECT"           // general set
  | "INSUFFICIENT_INFORMATION";                               // shared (rare)

interface CouncilVerdict {
  verdict: VerdictCategory;
  score: number;                       // 0-10  (kept)
  confidence: number;                  // 0-100
  informationSufficiency: "HIGH" | "MEDIUM" | "LOW";   // NEW
  summary: string;
  keyReasons: string[];                // NEW (the deciding reasons)
  agreements: string[];                // was keyAgreements
  disagreements: string[];             // was keyDisagreements
  criticalUnknowns: string[];          // NEW
  assumptions: string[];               // was criticalAssumptions
  risks: string[];                     // was criticalRisks
  recommendedAction: string;           // kept
  whatWouldChangeVerdict: string[];    // was whatWouldChangeTheVerdict
  reasoning: string;                   // kept
  whyThisVerdictWon: string;           // kept
  strongestArgumentFor: string;        // kept
  strongestArgumentAgainst: string;    // kept
  degraded?: boolean;                  // kept
  provisional?: boolean;               // NEW — true when the synthesizer produced it
}
```

- `schemas.ts`: `verdictSchema` updated; the `verdict` enum is validated against the
  set matching the question's classification (fall back to the union if needed).
- The Judge's `outputContract` is generated **per classification type** so it lists
  only the allowed verdict values for that question.
- `VERDICT_CATEGORIES`/`VERDICT_META`/`VERDICT_ICON` gain entries for BUILD_MVP,
  PIVOT, DO_NOT_BUILD (new or reused SVG icons — e.g. flask/test, route/pivot, ban
  — never emoji, keep gold/black identity).
- Missing/extra fields handled gracefully (existing `stringList` coercion + `.catch`
  patterns; unknown enum values fall back to the appropriate default).

### 4.3 Parts 2, 5, 7 — never let Judge failure hide analysis; unified degraded path

**Behavior:**

1. **Working Judge** → normal verdict, fully expandable analyses (unchanged UI, new
   schema fields).
2. **Failed/timed-out/malformed Judge** (after retries) →
   - A **deterministic synthesizer** (`lib/council/synthesizer.ts`) reads the
     completed analyses + comparison and produces the most defensible provisional
     verdict:
     - Strong supportive keyPoints, few risks → `BUILD` / `BUILD` (product/general)
     - Support with material unknowns → `BUILD_MVP` / `VALIDATE`
     - Mixed evidence → `PIVOT` / `RECONSIDER`
     - Opposition-heavy or severe risks → `DO_NOT_BUILD` / `REJECT`
     - **No completed analyses at all** → degraded `INSUFFICIENT_INFORMATION`
       (existing `fallbackVerdict` path)
   - Result is labeled `degraded: true`, `provisional: true`, confidence is reduced
     (e.g. capped by the fraction of agents that succeeded), `summary`/`reasoning`
     state explicitly: "The Judge could not complete its evaluation; this verdict is
     provisional and synthesized from the surviving analyses."
   - **No stance counting** — the synthesizer reads reasoning content
     (keyPoints/risks/comparison), not vote tallies. (Preserves the V0.2.2.1
     regression matrix.)
3. **Every result surface preserves fully expandable analyses**: verdict card,
   provisional card, DEGRADED state, error panel, cancelled panel — same shared
   expander component (4.4).

### 4.4 Part 3 — fix all expandable sections

**Root-cause findings:**

- `InsufficientPanel` / `CancelledPanel` / `ErrorPanel` render analyses with
  `line-clamp-2` and **no expander at all** → "clicking does nothing."
- Normal `VerdictView` expanders look correct in code; verify against the **current
  local build** (the deployed Vercel version may be older than V0.2.2.1 and may not
  match).

**Actions:**

- Extract a single shared **`ExpandableAnalysis`** component (icon, name, state line,
  expand/collapse button, animated body with `overflow-hidden` + `z-index` guard,
  `aria-expanded`) and use it in **every** surface:
  - VerdictView "The perspectives" (replaces `AnalysisCard`/`DevilsAdvocateCard`
    internals with the shared component).
  - InsufficientPanel (degraded/provisional result) — full analyses expandable.
  - ErrorPanel and CancelledPanel — full analyses expandable.
- Add expanders for the **Judge error** itself ("View error" per the request's
  example state diagram) when the Judge failed.
- Audit checklist (desktop + mobile): opens on click, closes on click, preserves
  content, no overlap, no page refresh, no state loss when another section opens,
  keyboard accessible, `prefers-reduced-motion` respected.
- Regression tests: expander open/close/preserve behavior via a test component or a
  state-level test of the underlying toggle helper.

### 4.5 Part 4 — stream/persist results as they arrive

- **Already true:** SSE emits `agent:done` as each agent finishes and the
  deliberation screen reflects it live. Verified — no fake progress.
- **Change (Part 5, 11):** each completed analysis is **persisted immediately** to
  the session's client-side record (in-memory during run, localStorage on
  terminal state), so a mid-run refresh or a later failure never loses finished
  work for the current session.
- Per-agent retry (4.8) also relies on analyses being available client-side.

### 4.6 Part 5 + 10 — explicit pipeline states

New client state machine (`lib/client/councilState.ts`), phases:

```
IDLE
  → ANALYZING            (agents in flight; ≥1 agent:start)
  → PARTIAL_RESULTS      (≥1 analysis complete AND ≥1 agent failed/no longer
                          running, Council not complete — recoverable)
  → COUNCIL_COMPLETE     (all analytical agents done — comparison/DA stage on deck)
  → JUDGING              (judge stage event received)
  → COMPLETE             (verdict event)
  → DEGRADED             (terminal: degraded/provisional verdict OR failed-agent
                          retry declined — analyses preserved)
  → FAILED               (terminal: fatal run error, e.g. all agents failed / network)
CANCELLED  (retained terminal state — orthogonal, user-initiated)
```

- Every phase resolves to success/failure/cancel; no permanent stuck states.
- `DEGRADED` is a **first-class phase**, not just `complete` + a flag.
- The reducer stays pure and unit-testable; `deliberation.ts` derived helpers are
  updated to the new phase names (or kept as stage labels).
- Part 10 — per-member outcome enum: `"COMPLETED" | "FAILED" | "TIMED_OUT" |
  "NOT_STARTED"`:
  - Providers classify timeout errors (per-call timeout constant + error matching)
    so `TIMED_OUT` is attributed distinctly from other `FAILED`.
  - `NOT_STARTED` = no `agent:start` was ever emitted (e.g. cancelled before
    launch / skipped).
  - UI chips show the distinct state per member; error text retained for FAILED.

### 4.7 Part 11 — error handling audit

- Audit: API failures, malformed JSON (parse.ts already robust — keep), timeouts
  (now attributed), missing agent responses, Judge failures (synthesizer), partial
  completion, frontend sync, race conditions (runningRef + reducer guard already
  exist), duplicate responses, stale session data (sessionId checks on resume),
  refresh behavior (localStorage restore), navigation away/back (abort on unmount
  already exists).
- Fix underlying issues rather than adding cosmetic try/catch (per request).
- SSE framing, abort propagation, and listener cleanup stay as-is (verified sound in
  V0.2/V0.2.2 audits).

### 4.8 Part 5 — per-agent retry (resumable sessions)

**New capability.** A failed member gets `[Retry]` in the result (and in DEGRADED
state):

- The client POSTs to `/api/council` with the **same** `question`, `mode`,
  `sessionId`, the **completed analyses** (stateless — safe on serverless), and
  `retryAgent: <key>`.
- The orchestrator gains a `resume` option: re-runs **only** `retryAgent`, merges the
  new analysis over the failed one, then continues the pipeline from the appropriate
  stage (comparison → … → Judge).
- The agent list for QUICK is **passed through** (not recomputed) so the resumed set
  matches the original session.
- Events reuse the existing shapes (`convened` with same sessionId + full agent
  list, then `agent:start`/`agent:done` for the retried agent, then stages).
- Frontend replaces the failed analysis in `events` and re-derives phase/stage.
- If the retry also fails → stays in DEGRADED with the member marked failed; the
  user can try again or start new.
- Cancellation applies to the resumed run like any run.

### 4.9 Part 8 — member ↔ Judge relationship ("How the verdict formed")

Upgrade the existing `AgreementSummary` into a **"How the verdict formed"** section:

- Verdict badge + confidence + informationSufficiency (with the new fields).
- Per-member stance list (already present): `Reasoner — Supports`, `Skeptic —
  Opposes`, etc. — colored, clickable, each opening its full `ExpandableAnalysis`.
- **Main deciding factors**: prefer `verdict.keyReasons`; fall back to comparison
  `strongestArgument`/`weakestArgument` + a summary of `criticalUnknowns`.
- A "Judge unavailable — provisional" callout when `provisional` is true.
- Nothing invented: all content comes from real verdict/analysis fields.

### 4.10 Part 9 + 27 — performance

- Concurrency already correct (analysts parallel; sequential chain is dependency-
  bound — documented, no change).
- **Add per-stage durations** to `CouncilUsage`: `stageDurations: { analysisMs,
  comparisonMs, devilsAdvocateMs, reassessmentMs, judgeMs }` and per-agent
  `agentDurations` — recorded by the orchestrator.
- Surface in the verdict meta line (small "Timing" row or expandable detail), and in
  the usage record for diagnostics. No new dependencies.

### 4.11 Persistence (TEST 6)

- **localStorage, client-side.** On terminal states (COMPLETE / DEGRADED / FAILED /
  CANCELLED with preserved analyses), persist a compact session record:
  `{ sessionId, question, mode, startedAt, status, verdict, usage, events }`.
- Cap: last **10** sessions, ~**500 KB** total (drop oldest on overflow; trim event
  payloads if needed — analyses/comparison/verdict are enough to re-render).
- On load, the home screen shows a small "Previous deliberations" list; clicking one
  re-opens the stored result (read-only VerdictView rendered from the stored
  payload). "Clear history" action.
- No server storage, no auth, no new dependencies.

---

## 5. Non-changes (explicitly out of scope)

- ❌ No VEX / AXIOM / TITAN / NEXUS / SOVEREIGN characters.
- ❌ No Challenge flow (button stays an honest "coming later" placeholder).
- ❌ No visual identity change (obsidian + warm gold stays).
- ❌ No new dependencies (deterministic synthesizer, localStorage only).
- ❌ No payments/auth/subscriptions.
- ❌ No rewrite of the concurrent-analysis pipeline or SSE framing.
- ❌ No removal of existing agents or real data; no mock/fabricated results
  (the synthesizer is a *labeled* degraded fallback, not fake data).

---

## 6. File-by-file change plan

| File | Change |
|---|---|
| `lib/council/types.ts` | VerdictCategory union + product set; `CouncilVerdict` new/renamed fields + `provisional`; `CouncilUsage.stageDurations` + per-agent durations; `AgentAnalysis.outcome` (`COMPLETED/FAILED/TIMED_OUT/NOT_STARTED`); phase types re-exported for client. |
| `lib/council/schemas.ts` | `verdictSchema` updated (new fields, type-dependent enum validation); `informationSufficiency` enum; outcome enum; back-compat coercion kept. |
| `lib/council/agents.ts` | Judge prompt rewrite (provisional-verdict rule, sufficiency, no cop-out); type-dependent `outputContract` for the Judge; VERDICT category descriptions for both sets. |
| `lib/council/orchestrator.ts` | Track per-stage + per-agent durations; classify timeout errors; `resume` option (retry single agent, merge, continue pipeline); failed-Judge path → `synthesizeProvisionalVerdict` instead of bare fallback (fallback only when no analyses); pass-through agent list on resume. |
| `lib/council/synthesizer.ts` | **New.** Deterministic provisional-verdict synthesizer (keyPoints/risks/comparison → category, confidence cap, labels degraded+provisional). |
| `lib/council/providers/*.ts` | Expose timeout classification (per-call timeout constant, error kind detection for TIMED_OUT). |
| `app/api/council/route.ts` | Accept `resume` fields (sessionId, completedAnalyses, retryAgent, agents); validate; pass to orchestrator. |
| `lib/client/councilState.ts` | New phase machine (IDLE/ANALYZING/PARTIAL_RESULTS/COUNCIL_COMPLETE/JUDGING/COMPLETE/DEGRADED/FAILED/CANCELLED); outcome-aware session records; localStorage persistence (load/save/clear, capped). |
| `lib/client/useCouncil.ts` | Retry-agent action (POST resume, merge events); phase mapping; restore-from-storage on mount. |
| `lib/client/deliberation.ts` | Stage/phase derivation updated for new phases + outcome enum chips. |
| `components/council/ExpandableAnalysis.tsx` | **New.** Shared expander used everywhere. |
| `components/council/VerdictView.tsx` | New schema fields (sufficiency, keyReasons, criticalUnknowns); "How the verdict formed" section; VERDICT_META/ICON entries for BUILD_MVP/PIVOT/DO_NOT_BUILD; provisional callout; shared expander; per-stage timing row. |
| `components/council/InsufficientPanel.tsx` | Rework into the DEGRADED/provisional surface — expandable analyses + `[Retry agent]` + `[Try again]` + `[New question]`. |
| `components/council/CouncilApp.tsx` | New phase branches (DEGRADED, FAILED, PARTIAL_RESULTS); retry-agent wiring; previous-deliberations entry point. |
| `components/council/ErrorPanel.tsx` / `CancelledPanel.tsx` | Shared expander for preserved analyses; outcome chips; retry-agent where applicable. |
| `README.md` | Update Judge behavior (provisional + sufficiency), persistence, resume, states, type-dependent verdicts. |

---

## 7. Testing plan

**Automated (vitest):**

1. Normal Quick / Full / Deep produce a verdict (existing suites extended).
2. Judge returns provisional verdict + sufficiency LOW on ambiguous questions
   (prompt/behavior contract, mocked).
3. Type-dependent verdict enums: business question → product set; explanation
   question → general set.
4. Judge failure → `synthesizeProvisionalVerdict` (degraded + provisional, no
   stance counting, analyses preserved) — extends the existing regression matrix.
5. Malformed Judge output → graceful fallback (existing matrix stays green).
6. Agent failure → session DEGRADED (not FAILED) with analyses preserved.
7. Timeout attribution: TIMED_OUT vs FAILED vs NOT_STARTED.
8. Per-agent retry: resume re-runs only the failed agent, merges, completes.
9. Empty input / long input validation (existing).
10. Cancellation, duplicate submission (existing) — re-verify under new phases.
11. councilState: new phase transitions (IDLE→ANALYZING→PARTIAL_RESULTS→…→COMPLETE /
    DEGRADED / FAILED / CANCELLED).
12. localStorage persistence: save/restore/clear/cap (node localStorage shim or
    injectable storage).
13. Expander behavior: open/close/preserve (toggle-helper unit test).
14. **No page refresh required after any failure** (state-machine invariant test).

**Manual (per request §12):**

- TEST 1 normal product question; TEST 2 deliberately ambiguous question
  (expect provisional verdict, not a cop-out); TEST 3 one member fails (DEGRADED,
  analyses visible, retry works); TEST 4 Judge fails (all analyses expandable,
  provisional labeled); TEST 5 members disagree (visible in "How the verdict
  formed"); TEST 6 refresh after completion (localStorage restores).
- Also: kill Ollama mid-run → FAILED/DEGRADED surface, no dead UI, retry works;
  mobile-width click-through of every expandable surface.

---

## 8. Risks / notes

- **Serverless resume:** resume is stateless (analyses sent with the request), so a
  different warm instance can serve it — no shared memory required.
- **localStorage quota:** cap size; store compact payloads; never store provider
  config or keys.
- **INSUFFICIENT_INFORMATION semantics:** still exists (general set) but only for
  genuinely irresponsible-to-answer cases; the degraded path remains for real Judge
  failure with no usable analyses.
- **Deployed vs local divergence:** the reported expander bug may predate the
  current build — verify against the local V0.2.2.2 build before assuming a code
  defect; the shared expander normalizes everything regardless.
- **Verdict field renames ripple** through VerdictView, InsufficientPanel, tests,
  and any stored data — old localStorage records from an interim build are ignored
  gracefully (version tag on the storage key).

---

## 9. Definition of done

1. Judge gives provisional verdicts with `informationSufficiency` + `criticalUnknowns`
   instead of copping out.
2. Type-dependent verdict sets work end-to-end.
3. Judge failure never hides analyses: provisional synthesized verdict, fully
   expandable members, "Judge unavailable" callout.
4. All expandable sections open/close/preserve on desktop + mobile.
5. Per-agent retry works (resumable, stateless server).
6. FAILED / TIMED OUT / NOT_STARTED distinguished in records + UI.
7. Results survive refresh via localStorage (TEST 6).
8. New phase machine incl. DEGRADED is tested and never dead-ends.
9. Per-stage durations recorded and surfaced.
10. `npm test` (all suites), `npx tsc --noEmit`, and `npx next build` pass;
    browser click-through verified (or compiled-CSS + live API fallback as in prior
    versions if browser automation is unavailable).
11. No visual-identity change, no characters, no Challenge, no new dependencies.
