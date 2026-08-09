"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useCouncil } from "@/lib/client/useCouncil";
import { completedAnalyses } from "@/lib/client/councilState";
import type { AgentAnalysis } from "@/lib/council/types";
import { QuestionScreen } from "./QuestionScreen";
import { DeliberationPanel } from "./DeliberationPanel";
import { VerdictView } from "./VerdictView";
import { ChallengeButton } from "./ChallengeButton";
import { RotateIcon } from "@/components/icons";

/**
 * COUNCIL V0.2 — the phase state machine.
 *
 * Reliability fix (Part 1): an error ALWAYS renders the error panel, even when
 * zero SSE events arrived (network failure / provider down before any event).
 * The user can retry or start a new question — a refresh is never required.
 */
export function CouncilApp() {
  const council = useCouncil();
  const [showChallenge, setShowChallenge] = useState(false);

  return (
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
          </motion.div>
        )}

        {(council.phase === "submitting" || council.phase === "running") &&
          council.events.length === 0 && (
            <motion.div
              key="starting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col items-center justify-center gap-6"
            >
              <p className="font-display text-lg text-ink-soft animate-pulse-soft">
                The Council is assembling…
              </p>
              <button
                onClick={council.cancel}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-soft transition-all hover:border-bad/50 hover:text-bad"
              >
                Cancel
              </button>
            </motion.div>
          )}

        {council.phase === "running" && council.events.length > 0 && (
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
            <div className="mx-auto w-full max-w-xl rounded-2xl border border-line bg-card p-8 text-center shadow-card">
              <h2 className="font-display text-2xl font-bold text-ink">Council stopped</h2>
              <p className="mt-2 text-sm text-ink-soft">
                The session was cancelled. No request is left running — you can
                immediately ask something else.
              </p>
              <button
                onClick={council.reset}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-brand-2"
              >
                New question
              </button>
            </div>
          </motion.div>
        )}

        {council.phase === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-1 flex-col justify-center"
          >
            <ErrorPanel
              message={council.error ?? "Unknown error"}
              preserved={completedAnalyses(council.events)}
              onRetry={() => {
                if (council.question && council.mode) council.run(council.question, council.mode);
              }}
              onReset={council.reset}
            />
          </motion.div>
        )}

        {council.phase === "complete" && council.lastVerdict && (
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
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Error recovery panel (Part 2): explains the likely cause, preserves completed
 * analyses (Part 5), and always offers TRY AGAIN + NEW QUESTION. The Council
 * never requires a browser refresh to recover.
 */
function ErrorPanel({
  message,
  preserved,
  onRetry,
  onReset,
}: {
  message: string;
  preserved: AgentAnalysis[];
  onRetry: () => void;
  onReset: () => void;
}) {
  const likelyCause = explainCause(message);
  return (
    <div className="rounded-2xl border border-bad/40 bg-card p-8 shadow-card">
      <h2 className="font-display text-2xl font-bold text-bad">Council session interrupted</h2>
      <p className="mt-3 text-ink">{message}</p>
      {likelyCause && (
        <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm text-ink-soft">{likelyCause}</p>
      )}
      <p className="mt-2 text-sm text-ink-soft">
        {preserved.length > 0
          ? `${preserved.length} of ${preserved.length} completed analysis${preserved.length === 1 ? "" : "es"} are preserved below. No verdict is fabricated.`
          : "No completed analyses could be preserved. No verdict is fabricated."}
      </p>

      {preserved.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          {preserved.map((a) => (
            <div key={a.agent} className="rounded-xl border border-line bg-surface px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-mint" aria-hidden="true" />
                <p className="font-display text-sm font-semibold text-ink">{a.name}</p>
                <span className="text-[10px] uppercase tracking-wider text-mint">completed</span>
              </div>
              {a.summary && <p className="mt-1 text-sm leading-relaxed text-ink-soft">{a.summary}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-brand-2"
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

/** Map common failure messages to an actionable explanation (Part 2). */
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
