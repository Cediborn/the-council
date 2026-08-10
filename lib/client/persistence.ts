import type { CouncilEvent, CouncilMode, CouncilUsage, CouncilVerdict } from "@/lib/council/types";

/**
 * COUNCIL V0.2.2.2 — client-side session persistence (Part 11 / TEST 6).
 *
 * Completed sessions are stored in localStorage so a page refresh never loses
 * a finished deliberation. No server storage, no auth, no new dependencies.
 * The storage key is versioned so schema changes from future builds are
 * ignored gracefully instead of crashing on stale records.
 */

export interface StoredSession {
  /** Bump when the stored shape changes incompatibly. */
  version: 1;
  sessionId: string;
  question: string;
  mode: CouncilMode;
  startedAt: number;
  status: "complete" | "degraded" | "failed" | "cancelled";
  error?: string;
  verdict?: CouncilVerdict;
  usage?: CouncilUsage;
  events: CouncilEvent[];
}

const STORAGE_KEY = "council.sessions.v1";
const MAX_SESSIONS = 10;
const MAX_BYTES = 500_000;

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isStoredSession(s: unknown): s is StoredSession {
  if (typeof s !== "object" || s === null) return false;
  const r = s as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.sessionId === "string" &&
    typeof r.question === "string" &&
    typeof r.mode === "string" &&
    Array.isArray(r.events)
  );
}

export function loadSessions(): StoredSession[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is StoredSession => isStoredSession(s));
  } catch {
    return [];
  }
}

function totalBytes(sessions: StoredSession[]): number {
  try {
    return JSON.stringify(sessions).length;
  } catch {
    return Infinity;
  }
}

function write(sessions: StoredSession[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Quota exceeded — drop oldest until it fits; if it still cannot, give up
    // silently (persistence must never break the app).
    try {
      let trimmed = sessions;
      while (trimmed.length > 1 && totalBytes(trimmed) > MAX_BYTES) {
        trimmed = trimmed.slice(0, -1);
      }
      storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore
    }
  }
}

/** Insert (or update) a session, dedupe by sessionId, cap count + size. */
export function saveSession(session: StoredSession): StoredSession[] {
  const sessions = loadSessions().filter((s) => s.sessionId !== session.sessionId);
  sessions.unshift(session);
  while (sessions.length > MAX_SESSIONS) sessions.pop();
  while (sessions.length > 1 && totalBytes(sessions) > MAX_BYTES) sessions.pop();
  write(sessions);
  return sessions;
}

export function clearSessions(): void {
  const storage = getStorage();
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
