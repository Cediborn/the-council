"use client";

import { useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useCouncil } from "@/lib/client/useCouncil";
import { completedAnalyses } from "@/lib/client/councilState";
import type { AgentAnalysis, AgentKey } from "@/lib/council/types";
import { QuestionScreen } from "./QuestionScreen";
import { DeliberationPanel } from "./DeliberationPanel";
import { VerdictView } from "./VerdictView";
import { InsufficientPanel } from "./InsufficientPanel";
import { ChallengeButton } from "./ChallengeButton";
import { ExpandableAnalysis } from "./ExpandableAnalysis";
import { AlertIcon, GavelIcon, RotateIcon } from "@/components/icons";
import type { StoredSession } from "@/lib/client/persistence";

/**
 * COUNCIL V0.2.2.2 — app shell.
 *
 * Explicit phase machine (Part 5): every phase resolves to success, failure,
 * or cancellation — a refresh is never required. V0.2.2.2 adds the DEGRADED
 * terminal phase (provisional verdict rendered through VerdictView with its
 * banner), per-member retry, and a persisted previous-deliberations list
 * (TEST 6 — results survive a refresh).
 */
export function CouncilApp() {
  const council = useCouncil();
  const [showChallenge, setShowChallenge] = useState(false);

  const running =
    council.phase === "analyzing" ||
    council.phase === "partial_results" ||
    council.phase === "council_complete" ||
    council.phase === "judging";

  const retryMember = (agent: AgentKey) => council.retryAgent(agent);
  const preserved = completedAnalyses(council.events);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4 py-8 sm:px-6">
        <AnimatePresence mode="wait">
          {council.phase === "idle" && (
            <motion.div
              key="question"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="flex flex-1 flex-col justify-center"
            >
              <QuestionScreen onRun={council.run} />
              <PreviousSessions
                sessions={council.previousSessions}
                onRestore={council.restoreSession}
                onClear={council.clearHistory}
              />
            </motion.div>
          )}

          {council.phase === "analyzing" && council.events.length === 0 && (
            <motion.div
              key="starting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col items-center justify-center gap-6"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/30 bg-brand/5 text-brand animate-glow">
                <AlertIcon className="h-6 w-6 animate-breathe" />
              </div>
              <p className="font-display text-lg text-ink-soft animate-pulse-soft">
                The Council is assembling…
              </p>
              <button
                onClick={council.cancel}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-soft transition-all hover:border-bad/40 hover:text-bad"
              >
                Cancel
              </button>
            </motion.div>
          )}

          {running && council.events.length > 0 && (
            <motion.div
              key="running"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col justify-center"
            >
              <DeliberationPanel
                question={council.question}
                mode={council.mode ?? "QUICK"}
                events={council.events}
                onCancel={council.cancel}
              />
            </motion.div>
          )}

          {council.phase === "cancelled" && (
            <motion.div
              key="cancelled"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-1 flex-col justify-center"
            >
              <CancelledPanel
                preserved={preserved}
                onRetryAgent={retryMember}
                onRetry={() => {
                  if (council.question && council.mode) council.run(council.question, council.mode);
                }}
                onReset={council.reset}
              />
            </motion.div>
          )}

          {council.phase === "failed" && (
            <motion.div
              key="failed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-1 flex-col justify-center"
            >
              <ErrorPanel
                message={council.error ?? "Unknown error"}
                preserved={preserved}
                onRetryAgent={retryMember}
                onRetry={() => {
                  if (council.question && council.mode) council.run(council.question, council.mode);
                }}
                onReset={council.reset}
              />
            </motion.div>
          )}

          {(council.phase === "degraded" || council.phase === "complete") &&
            council.lastVerdict &&
            (council.phase === "degraded" && preserved.length === 0 ? (
              // True no-information degraded state — nothing to synthesize.
              <motion.div
                key="insufficient"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex flex-1 flex-col justify-center"
              >
                <InsufficientPanel
                  preserved={preserved}
                  onRetryAgent={retryMember}
                  onRetry={() => {
                    if (council.question && council.mode) council.run(council.question, council.mode);
                  }}
                  onReset={council.reset}
                />
              </motion.div>
            ) : (
              <motion.div
                key="verdict"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col gap-6"
              >
                <VerdictView
                  verdict={council.lastVerdict.verdict}
                  usage={council.lastVerdict.usage}
                  events={council.events}
                  onRetryAgent={retryMember}
                />
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    onClick={council.reset}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink transition-all hover:border-brand/50 hover:text-brand"
                  >
                    Ask another question
                  </button>
                  <ChallengeButton
                    visible={showChallenge}
                    onToggle={() => setShowChallenge((v) => !v)}
                  />
                </div>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

/** V0.2.2.2 (TEST 6): persisted deliberations, restorable after a refresh. */
function PreviousSessions({
  sessions,
  onRestore,
  onClear,
}: {
  sessions: StoredSession[];
  onRestore: (session: StoredSession) => void;
  onClear: () => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <div className="mx-auto mt-10 w-full max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-soft">
          Previous deliberations
        </p>
        <button
          onClick={onClear}
          className="text-xs text-ink-soft transition-colors hover:text-bad"
        >
          Clear history
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {sessions.map((s) => (
          <li key={s.sessionId}>
            <button
              onClick={() => onRestore(s)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-all hover:border-brand/40"
            >
              <GavelIcon className="h-4 w-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{s.question}</span>
                <span className="block text-[11px] text-ink-soft">
                  {s.mode} · {s.status} · {new Date(s.startedAt).toLocaleString()}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** V0.2.2 cancelled landing — never a hard drop back to the home screen. */
function CancelledPanel({
  preserved,
  onRetryAgent,
  onRetry,
  onReset,
}: {
  preserved: AgentAnalysis[];
  onRetryAgent: (agent: AgentKey) => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-line bg-card p-8 shadow-card">
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-soft">
        Council session cancelled
      </p>
      <h2 className="mt-2 font-display text-2xl font-bold text-ink">Deliberation stopped</h2>
      <p className="mt-2 text-sm text-ink-soft">
        No request is left running.{" "}
        {preserved.length > 0
          ? `${preserved.length} completed analysis${preserved.length === 1 ? "" : "es"} ${
              preserved.length === 1 ? "has" : "have"
            } been preserved.`
          : "No request was left running."}
      </p>

      {preserved.length > 0 && (
        <div className="mt-5 flex flex-col gap-2 text-left">
          {preserved.map((a) => (
            <ExpandableAnalysis key={a.agent} analysis={a} onRetry={() => onRetryAgent(a.agent)} />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-gold-contrast transition-all hover:bg-brand-2"
        >
          <RotateIcon className="h-4 w-4" />
          Resume
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink transition-all hover:border-brand/50"
        >
          New question
        </button>
      </div>
    </div>
  );
}

/** Error recovery panel — calm and useful, never a giant red banner. */
function ErrorPanel({
  message,
  preserved,
  onRetryAgent,
  onRetry,
  onReset,
}: {
  message: string;
  preserved: AgentAnalysis[];
  onRetryAgent: (agent: AgentKey) => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  const likelyCause = explainCause(message);
  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-bad/25 bg-card p-8 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-bad/30 bg-bad/10 text-bad">
          <AlertIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-bad/80">
            Deliberation interrupted
          </p>
          <h2 className="font-display text-xl font-bold text-ink">Council could not finish</h2>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink">{message}</p>
      {likelyCause && (
        <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm text-ink-soft">{likelyCause}</p>
      )}
      <p className="mt-2 text-xs text-ink-soft">
        {preserved.length > 0
          ? `${preserved.length} completed analysis${preserved.length === 1 ? "" : "es"} ${
              preserved.length === 1 ? "is" : "are"
            } preserved below. No verdict is fabricated.`
          : "No completed analyses could be preserved. No verdict is fabricated."}
      </p>

      {preserved.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {preserved.map((a) => (
            <ExpandableAnalysis key={a.agent} analysis={a} onRetry={() => onRetryAgent(a.agent)} />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-gold-contrast transition-all hover:bg-brand-2"
        >
          <RotateIcon className="h-4 w-4" />
          Try again
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink transition-all hover:border-brand/50"
        >
          New question
        </button>
      </div>
    </div>
  );
}

/** Map common failure messages to an actionable explanation (V0.2 Part 2). */
function explainCause(message: string): string | null {
  const m = message.toLowerCase();
  if (
    m.includes("ollama") ||
    m.includes("connect") ||
    m.includes("network") ||
    m.includes("fetch failed") ||
    m.includes("econgrefused") ||
    m.includes("unreachable") ||
    m.includes("provider")
  ) {
    return "Unable to connect to the model provider. Make sure Ollama is running, then try again.";
  }
  if (m.includes("timeout") || m.includes("timed out") || m.includes("aborted")) {
    return "A model call timed out. The Council stayed open — try again, or check the model is responsive.";
  }
  if (m.includes("stream ended")) {
    return "The connection was interrupted mid-deliberation. Completed analyses are preserved below.";
  }
  if (m.includes("invalid")) {
    return "The request was not valid — check the question and try again.";
  }
  return null;
}
