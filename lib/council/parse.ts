import type { ZodType } from "zod";
import { ZodError } from "zod";

/**
 * Safe parsing helpers.
 *
 * Model output is UNTRUSTED. These helpers try progressively harder to turn
 * raw model text into structured data:
 *
 *   1. exact JSON.parse
 *   2. strip markdown code fences
 *   3. extract the outermost {...} block (balanced-brace scan)
 *   4. rescue truncated JSON (append missing closing braces/quotes)
 *
 * If everything fails, we return null and the caller falls back to keeping
 * the raw text (an agent that returned readable prose is never silently
 * dropped), or to a safe default verdict.
 */

function extractCodeFence(raw: string): string {
  // ```json ... ```  /  ``` ... ```
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : raw.trim();
}

/** Find the outermost balanced {...} block. */
function extractObjectBlock(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** Attempt to rescue truncated JSON by closing open braces/brackets/strings. */
function rescueTruncatedJson(raw: string): string | null {
  let s = raw;
  // If we end inside a string, drop the trailing partial string.
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    }
  }
  if (inString) {
    // cut back to the last unescaped quote
    const lastQuote = s.lastIndexOf('"');
    s = lastQuote > -1 ? s.slice(0, lastQuote + 1) : s;
  }
  // Remove trailing commas before closing braces/brackets.
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Track open brackets in order, then close them in reverse order so
  // truncated arrays get `]` and objects get `}` (not just `}` for both).
  const stack: Array<"{" | "["> = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }
  while (stack.length) {
    s += stack.pop() === "{" ? "}" : "]";
  }
  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}

export function parseJsonObject(raw: string): unknown {
  const candidates = [raw.trim(), extractCodeFence(raw), extractObjectBlock(raw) ?? ""].filter(
    Boolean,
  );
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const parsed: unknown = JSON.parse(candidate);
      // The model sometimes wraps the whole object as a JSON-encoded STRING
      // (e.g. "{\"summary\": ...}" instead of {"summary": ...}). Unwrap one
      // level so the object is validated, not the string wrapper.
      if (typeof parsed === "string" && parsed.trim().length > 0) {
        try {
          return JSON.parse(parsed.trim());
        } catch {
          return parsed;
        }
      }
      return parsed;
    } catch {
      // continue
    }
  }
  // Last resort: rescue truncated JSON.
  const rescued = rescueTruncatedJson(extractCodeFence(raw));
  if (rescued) {
    try {
      return JSON.parse(rescued);
    } catch {
      return null;
    }
  }
  return null;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an unknown parsed value against a Zod schema.
 * Returns { ok: true, data } or { ok: false, issues }.
 */
export function validate<T>(schema: ZodType<T>, value: unknown) {
  try {
    return { ok: true as const, data: schema.parse(value) };
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false as const, issues: err.issues.map((i) => i.path.join(".") || "(root)") };
    }
    return { ok: false as const, issues: ["unknown validation error"] };
  }
}

/** Human-friendly join of validation issues. */
export function summarizeIssues(issues: string[]): string {
  if (issues.length === 0) return "output failed validation";
  const first = issues.slice(0, 4).join(", ");
  return `output failed validation (${first})`;
}

/**
 * Some small models double-encode the entire structured object as a JSON
 * string inside a single field (usually `summary`), leaving the real content
 * empty at the top level. If `fieldName` parses to an object that looks like
 * the expected output, merge its known keys up to the top level (nested values
 * win for known keys; unknown keys are preserved from the outer object).
 */
export function unwrapNestedObject(
  raw: unknown,
  fieldName: string,
  knownKeys: string[],
): unknown {
  if (!isPlainObject(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const field = record[fieldName];
  if (typeof field !== "string") return raw;
  const nested = parseJsonObject(field);
  if (!isPlainObject(nested)) return raw;
  const nestedRecord = nested as Record<string, unknown>;
  if (!knownKeys.some((k) => k in nestedRecord)) return raw;

  const merged: Record<string, unknown> = { ...record };
  for (const key of knownKeys) {
    const value = nestedRecord[key];
    if (value !== undefined && value !== "") merged[key] = value;
  }
  return merged;
}
