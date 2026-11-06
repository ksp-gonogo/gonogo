import { isReportEvent } from "./reportTags.js";
import type { LogEntry, LogLevel } from "./types.js";

export interface LogBudgetLimits {
  /** Length of one counting window. */
  windowMs: number;
  /** Most debug lines let through in one window. */
  debugPerWindow: number;
  /** Most debug, info and warn lines together let through in one window. */
  linesPerWindow: number;
  /** Most distinct error lines let through in one window. */
  errorsPerWindow: number;
  /** Most lines one transport lets through in its lifetime, the backstop for a loop that varies its message. */
  ceiling: number;
  /** Most distinct lines tracked for collapsing within one window. */
  maxDistinct: number;
}

/**
 * Sized for Axiom's free plan, where storage (25 GB over 30 days) is the limit
 * that binds. A normal session sends about 3000 lines a day at about 660 bytes
 * a line, so a window of 100 lines rarely bites in ordinary play and still
 * admits a start-up burst. The worst case is 130 lines (about 86 KB) a minute
 * and 5000 lines (about 3.3 MB) per page load, a little over a normal
 * session-day. Errors get their own smaller allowance so a flood of debug
 * lines cannot hide an error and a flood of errors cannot use the whole window.
 */
export const DEFAULT_LOG_BUDGET: LogBudgetLimits = {
  windowMs: 60_000,
  debugPerWindow: 40,
  linesPerWindow: 100,
  errorsPerWindow: 30,
  ceiling: 5000,
  maxDistinct: 200,
};

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Decides which lines a transport forwards. Feedback and bug-report entries
 * always pass and are never counted. A line identical to one already let
 * through in the window (level, tag, message) is folded into a single
 * "repeated N times" line at the end of the window. Anything beyond the
 * window's allowance is dropped, debug first, and counted into one "dropped N
 * lines" line at the end of the window. The ring buffer and console never see
 * this: it only shapes what leaves the page.
 */
export class LogBudget {
  private windowStart: number | null = null;
  private passedLines = 0;
  private passedDebug = 0;
  private passedErrors = 0;
  private total = 0;
  private seen = new Map<string, { entry: LogEntry; repeats: number }>();
  private dropped: Record<LogLevel, number> = emptyCounts();
  private lastTemplate: LogEntry | null = null;

  constructor(private readonly limits: LogBudgetLimits = DEFAULT_LOG_BUDGET) {}

  /** The lines to forward for `entry`: summaries of a window that just ended, then `entry` itself if it passes. */
  admit(entry: LogEntry, now: number = Date.now()): LogEntry[] {
    const out: LogEntry[] = [];
    if (
      this.windowStart !== null &&
      now - this.windowStart >= this.limits.windowMs
    ) {
      this.close(now, out);
    }
    this.windowStart ??= now;
    if (isReportEvent(entry)) {
      out.push(entry);
      return out;
    }
    this.lastTemplate = entry;
    const key = `${entry.level}\u0000${entry.tag ?? ""}\u0000${entry.message}`;
    const known = this.seen.get(key);
    if (known) {
      known.repeats++;
      return out;
    }
    if (!this.allows(entry.level)) {
      this.dropped[entry.level]++;
      return out;
    }
    this.total++;
    if (entry.level === "error") this.passedErrors++;
    else {
      this.passedLines++;
      if (entry.level === "debug") this.passedDebug++;
    }
    if (this.seen.size < this.limits.maxDistinct) {
      this.seen.set(key, { entry, repeats: 0 });
    }
    out.push(entry);
    return out;
  }

  /** Whether any summary is waiting for the window to end. */
  hasPending(): boolean {
    if (LEVELS.some((l) => this.dropped[l] > 0)) return true;
    for (const v of this.seen.values()) if (v.repeats > 0) return true;
    return false;
  }

  /** Ends the current window and returns its summary lines. */
  close(now: number = Date.now(), out: LogEntry[] = []): LogEntry[] {
    const timestamp = new Date(now).toISOString();
    const template = this.lastTemplate;
    const stamp = {
      timestamp,
      ...(template?.device ? { device: template.device } : {}),
      ...(template?.sessionId ? { sessionId: template.sessionId } : {}),
      ...(template?.runId ? { runId: template.runId } : {}),
    };
    for (const { entry, repeats } of this.seen.values()) {
      if (repeats === 0) continue;
      out.push({
        level: entry.level,
        message: `repeated ${repeats} times: ${entry.message}`,
        ...(entry.tag ? { tag: entry.tag } : {}),
        context: { count: repeats },
        ...stamp,
      });
    }
    const parts = LEVELS.filter((l) => this.dropped[l] > 0).map(
      (l) => `${l} ${this.dropped[l]}`,
    );
    if (parts.length > 0) {
      const count = LEVELS.reduce((n, l) => n + this.dropped[l], 0);
      out.push({
        level: "warn",
        message: `dropped ${count} lines (${parts.join(", ")})`,
        context: { count },
        ...stamp,
      });
    }
    this.seen = new Map();
    this.dropped = emptyCounts();
    this.passedLines = 0;
    this.passedDebug = 0;
    this.passedErrors = 0;
    this.windowStart = null;
    return out;
  }

  private allows(level: LogLevel): boolean {
    const l = this.limits;
    if (this.total >= l.ceiling) return false;
    if (level === "error") return this.passedErrors < l.errorsPerWindow;
    if (this.passedLines >= l.linesPerWindow) return false;
    return level !== "debug" || this.passedDebug < l.debugPerWindow;
  }
}

function emptyCounts(): Record<LogLevel, number> {
  return { debug: 0, info: 0, warn: 0, error: 0 };
}
