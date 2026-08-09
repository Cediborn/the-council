import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { CouncilUsage } from "./types";

/**
 * Usage & cost tracking — the accounting layer for future monetization.
 *
 * V0.1 does NOT enforce limits. It records, per session, everything a future
 * billing/tier system needs: mode, agent call counts, model, token usage,
 * duration, success/failure. Records are appended to .data/council-usage.ndjson
 * (server-side only, git-ignored) and never contain the question text or any
 * secrets. Failures to write are swallowed — tracking must never break the
 * Council.
 */

const DATA_DIR = join(process.cwd(), ".data");
const USAGE_FILE = join(DATA_DIR, "council-usage.ndjson");

function ensureDir() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export function recordUsage(usage: Omit<CouncilUsage, "startedAt"> & { startedAt?: string }) {
  try {
    ensureDir();
    const record = {
      ...usage,
      startedAt: usage.startedAt ?? new Date().toISOString(),
      // Never persist question text or other user content.
      // Only structural metadata is stored.
    };
    appendFileSync(USAGE_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // tracking must never crash the Council
  }
}

/** In-memory recent sessions (last 50) for diagnostics without disk I/O. */
const recent: CouncilUsage[] = [];
export function trackRecent(usage: CouncilUsage) {
  recent.push(usage);
  if (recent.length > 50) recent.shift();
}

export function recentUsage(): CouncilUsage[] {
  return [...recent];
}
