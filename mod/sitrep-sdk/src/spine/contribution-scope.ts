import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * Which contribution's `compute` is running, so an out-of-band read can name
 * it.
 *
 * A contribution is recomputed only when one of its declared `deps` moves. A
 * `compute` that also reads the view clock, or samples a topic it never
 * declared, gets whatever that read said at its last recompute and nothing
 * after, and nothing about that is visible from inside the contribution: it
 * works for as long as something else happens to be recomputing it. The seams
 * those reads go through call {@link noteUndeclaredRead}, which says so while
 * a contribution is on the stack.
 *
 * A Processor is never in scope. It is evaluated every frame and compares its
 * RESULT, so its answer stays current whatever it reads, and comparing the
 * result needs no declaration of which inputs a compute really reads.
 */
interface ContributionScope {
  id: string;
  declaredTopics: ReadonlySet<string>;
}

let current: ContributionScope | null = null;
const reported = new Set<string>();

/** Run `compute` as contribution `id`, whose declared topic deps are `declaredTopics`. */
export function runContributionCompute<T>(
  id: string,
  declaredTopics: ReadonlySet<string>,
  compute: () => T,
): T {
  const outer = current;
  current = { id, declaredTopics };
  try {
    return compute();
  } finally {
    current = outer;
  }
}

/**
 * Run `evaluate` with no contribution in scope. A Processor evaluated on demand
 * from inside a contribution's `compute` reads for itself, not for the
 * contribution that asked.
 */
export function runOutsideContributionScope<T>(evaluate: () => T): T {
  const outer = current;
  current = null;
  try {
    return evaluate();
  } finally {
    current = outer;
  }
}

/**
 * Report a read of `seam` from inside a contribution's `compute`, once per
 * (contribution, seam). `topic` names the topic the read resolved to, and a
 * topic the contribution declared is not reported.
 *
 * `console.error` under test, so the suite that exercises the contribution
 * shows it; the host's `logger.warn` otherwise. It never throws: the read
 * still answers, and the message names the fix.
 */
export function noteUndeclaredRead(seam: string, topic?: string): void {
  const scope = current;
  if (!scope) return;
  if (topic !== undefined && scope.declaredTopics.has(topic)) return;
  const what = topic === undefined ? seam : `${seam}("${topic}")`;
  const key = `${scope.id}\u0000${what}`;
  if (reported.has(key)) return;
  reported.add(key);
  const message = `contribution ${scope.id} read ${what} without declaring it; move it into a processor`;
  if (process.env.NODE_ENV === "test") console.error(message);
  else if (hasHost()) logger.warn(message);
  else console.warn(message);
}
