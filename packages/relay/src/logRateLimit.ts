/**
 * Caps how often one kind of log line passes through. Lines are grouped by
 * their text with digits collapsed, so `Trying to bind fd 4153` and
 * `Trying to bind fd 4154` count as the same line. The first `limit` lines of
 * a group in each window pass; the rest are dropped and counted. Used by the
 * coturn log forwarder, where a pool fault repeats one line hundreds of
 * thousands of times in seconds.
 */
export interface LogRateLimiter {
  /** True when the line should be written. */
  allow(line: string, now?: number): boolean;
  /**
   * Lines dropped since the last flush, one summary per group, and a reset.
   * Call on a timer so a flood that ends is still reported.
   */
  flush(): string[];
}

export function createLogRateLimiter(
  limit: number,
  windowMs: number,
): LogRateLimiter {
  const groups = new Map<
    string,
    { windowStart: number; passed: number; dropped: number; sample: string }
  >();

  return {
    allow(line, now = Date.now()) {
      const key = line.replace(/\d+/g, "#");
      let g = groups.get(key);
      if (!g) {
        g = { windowStart: now, passed: 0, dropped: 0, sample: line };
        groups.set(key, g);
      }
      if (now - g.windowStart >= windowMs) {
        g.windowStart = now;
        g.passed = 0;
      }
      if (g.passed < limit) {
        g.passed++;
        return true;
      }
      g.dropped++;
      return false;
    },
    flush() {
      const summaries: string[] = [];
      for (const [key, g] of groups) {
        if (g.dropped > 0) {
          summaries.push(`suppressed ${g.dropped} repeats of: ${g.sample}`);
        }
        groups.delete(key);
      }
      return summaries;
    },
  };
}
