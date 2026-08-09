"use client";

import { AnimatePresence, motion } from "framer-motion";
import { FlameIcon } from "@/components/icons";

/**
 * Challenge foundation.
 * The verdict UI is architected so a future [ CHALLENGE THE COUNCIL ] flow
 * (user counterargument → Council reopens case → reassessment → updated
 * verdict) plugs in here without rebuilding the engine. V0.1 does NOT
 * implement fake challenge functionality — the button is honest about being
 * unavailable.
 */
export function ChallengeButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        aria-expanded={visible}
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-5 py-3 text-sm font-semibold text-ink-soft transition-all hover:border-warn/50 hover:text-warn"
      >
        <FlameIcon className="h-4 w-4" />
        Challenge the Council
      </button>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-10 mt-2 w-72 rounded-xl border border-line bg-card p-4 shadow-lift"
          >
            <p className="font-display text-sm font-bold text-warn">Coming in a later version</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              The Challenge flow — your counterargument, a reopened case, and an updated
              verdict — will land in a future release. The Council engine is already
              built to support it.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
