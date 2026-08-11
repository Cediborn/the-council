"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ConversationTurn } from "@/lib/council/types";
import { VerdictView } from "./VerdictView";
import { RotateIcon } from "@/components/icons";

/**
 * V0.3 — the archived conversation thread.
 *
 * Past turns of a conversation render compactly; past verdict turns expand to
 * the full VerdictView when their in-memory events are available (during the
 * session). After a refresh the turns are summarized (persistence decision #10)
 * so the verdict card shows the outcome without the expandable analyses.
 *
 * The latest verdict of the conversation is NOT rendered here — CouncilApp
 * renders it live through the normal verdict view.
 */

function VerdictTurn({ turn }: { turn: ConversationTurn }) {
  const [open, setOpen] = useState(false);
  const v = turn.verdict;
  if (!v) return null;
  const isRevision = turn.type === "revision";

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-2xl rounded-xl border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-brand">
            {isRevision && <RotateIcon className="h-3 w-3" />}
            {isRevision ? "Revised verdict" : "Council verdict"}
          </span>
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
            {v.verdict.replace(/_/g, " ")}
          </span>
          <span className="text-[11px] text-ink-soft">
            {v.score.toFixed(1)}/10 · {v.confidence}% · sufficiency {v.informationSufficiency}
          </span>
          {turn.diff?.changed && (
            <span className="text-[11px] text-warn">↻ {turn.diff.summaryNote}</span>
          )}
          {turn.events && turn.events.length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="ml-auto rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:border-brand/40 hover:text-brand"
            >
              {open ? "Hide analysis" : "View analysis"}
            </button>
          )}
        </div>

        <p className="mt-2 text-sm leading-relaxed text-ink">{v.summary}</p>

        {turn.events && turn.usage && turn.events.length > 0 && (
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="mt-3 border-t border-line pt-3">
                  <VerdictView verdict={v} usage={turn.usage} events={turn.events} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        {turn.events && turn.events.length === 0 && (
          <p className="mt-2 text-[11px] text-ink-soft">
            Full analysis is available only in the session where it was produced.
          </p>
        )}
      </div>
    </div>
  );
}

function UserTurn({ turn }: { turn: ConversationTurn }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xl rounded-br-sm border border-brand/25 bg-brand/10 px-4 py-2.5">
        {turn.type === "clarification" && turn.clarifications?.length ? (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-ink-soft">
              Answers to the Council's questions
            </p>
            <p className="mt-0.5 text-sm text-ink">{turn.text}</p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-ink">{turn.text}</p>
        )}
      </div>
    </div>
  );
}

function AssistantTextTurn({ turn }: { turn: ConversationTurn }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-line bg-surface px-4 py-2.5">
        <p className="text-[10px] font-mono uppercase tracking-widest text-ink-soft">
          {turn.type === "chat_reply" ? "Council" : "Council — direct answer"}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-ink">{turn.text}</p>
      </div>
    </div>
  );
}

export function ConversationThread({ turns }: { turns: ConversationTurn[] }) {
  if (turns.length === 0) return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {turns.map((turn) => {
        if (turn.kind === "user") return <UserTurn key={turn.id} turn={turn} />;
        if (turn.type === "verdict" || turn.type === "revision") {
          return <VerdictTurn key={turn.id} turn={turn} />;
        }
        return <AssistantTextTurn key={turn.id} turn={turn} />;
      })}
    </div>
  );
}
