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
 * result, so its answer stays current whatever it reads, and comparing the
 * result needs no declaration of which inputs a compute really reads.
 */
interface ContributionScope {
  id: string;
  declaredTopics: ReadonlySet<string>;
}

let current: ContributionScope | null = null;
const reported = new Set<string>();

/**
 * Runs `compute` as the contribution `id`, whose declared Topic dependencies
 * are `declaredTopics`. Useful for noticing when a contribution reads a Topic
 * it did not declare. Used when the contributions of a widget slot are
 * evaluated.
 */
export function runContributionCompute<Result>(
  id: string,
  declaredTopics: ReadonlySet<string>,
  compute: () => Result,
): Result {
  const outer = current;
  current = { id, declaredTopics };
  try {
    return compute();
  } finally {
    current = outer;
  }
}

/**
 * Runs `evaluate` with no contribution in scope. Useful for a Processor that is
 * evaluated on demand from inside a contribution's `compute`, because its reads
 * belong to the Processor and not to the contribution that asked. Used by the
 * Processor evaluator.
 */
export function runOutsideContributionScope<Result>(
  evaluate: () => Result,
): Result {
  const outer = current;
  current = null;
  try {
    return evaluate();
  } finally {
    current = outer;
  }
}

/**
 * Reports a read of `seam` from inside a contribution's `compute`, once per
 * contribution and seam. `topic` names the Topic the read resolved to, and a
 * Topic the contribution declared is not reported. Useful for telling a
 * developer that a contribution reads a Topic it has not declared. Used by the
 * on-demand telemetry reads.
 *
 * The report goes to `console.error` under test and to the host's
 * `logger.warn` otherwise. It never throws: the read still answers, and the
 * message names the fix.
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
  if (process.env.NODE_ENV === "test") {
    console.error(message);
    return;
  }
  if (hasHost()) {
    logger.warn(message);
    return;
  }
  console.warn(message);
}
