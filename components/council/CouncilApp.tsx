"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useCouncil } from "@/lib/client/useCouncil";
import type { AgentAnalysis, CouncilMode, DevilAdvocateAnalysis } from "@/lib/council/types";
import { QuestionScreen } from "./QuestionScreen";
import { DeliberationPanel } from "./DeliberationPanel";
import { VerdictView } from "./VerdictView";
import { ChallengeButton } from "./ChallengeButton";

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

        {(council.phase === "running" || council.phase === "error") &&
          council.events.length === 0 && (
            <motion.div
              key="starting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 items-center justify-center"
            >
              <p className="font-display text-lg text-ink-soft animate-pulse-soft">
                The Council is assembling…
              </p>
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
            />
          </motion.div>
        )}

        {council.phase === "error" && council.events.length > 0 && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-1 flex-col justify-center"
          >
            <ErrorPanel
              message={council.error ?? "Unknown error"}
              analyses={council.lastErrorEvent?.analyses ?? []}
              devilsAdvocate={council.lastErrorEvent?.devilsAdvocate ?? null}
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

function ErrorPanel({
  message,
  analyses,
  devilsAdvocate,
  onRetry,
  onReset,
}: {
  message: string;
  analyses: AgentAnalysis[];
  devilsAdvocate: DevilAdvocateAnalysis | null;
  onRetry: () => void;
  onReset: () => void;
}) {
  const preserved = analyses.filter((a) => !a.failed);
  return (
    <div className="rounded-2xl border border-bad/40 bg-card p-8 shadow-card">
      <h2 className="font-display text-2xl font-bold text-bad">The Council could not reach a verdict</h2>
      <p className="mt-3 text-ink-soft">{message}</p>
      <p className="mt-2 text-sm text-ink-soft">
        {preserved.length > 0
          ? "The analyses completed before the failure are preserved below. No verdict is fabricated."
          : "No completed analyses could be preserved. No verdict is fabricated."}
      </p>

      {preserved.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          {preserved.map((a) => (
            <div key={a.agent} className="rounded-xl border border-line bg-surface px-4 py-3">
              <p className="font-display text-sm font-semibold text-ink">{a.name}</p>
              {a.summary && <p className="mt-1 text-sm leading-relaxed text-ink-soft">{a.summary}</p>}
              {a.keyPoints.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {a.keyPoints.map((p, i) => (
                    <li key={i} className="text-xs text-ink-soft">· {p}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {devilsAdvocate && !devilsAdvocate.failed && (
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <p className="font-display text-sm font-semibold text-ink">Devil's Advocate</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{devilsAdvocate.summary}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-brand-2"
        >
          Retry
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink transition-all hover:border-brand/50"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
