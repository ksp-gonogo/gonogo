/**
 * Error classes thrown by the Sitrep capability kernel.
 *
 * Kept in one file so later tasks in this milestone can add their own
 * (e.g. Task 5's version-gating / spine-halt errors) alongside this one.
 */

/**
 * Thrown by `Kernel.resolve()` when an EXCLUSIVE capability has two or more
 * equally-ranked provider candidates and there is no user preference or
 * unique `isDefault`/highest-priority provider to break the tie.
 *
 * This is a fail-loud condition: the kernel refuses to silently pick a
 * winner (e.g. by registration order) when the tie is genuinely ambiguous,
 * since that non-determinism is exactly what the exclusive-provider model
 * exists to prevent.
 */
export class AmbiguousResolutionError extends Error {
  readonly capability: string;
  readonly providerIds: string[];

  constructor(capability: string, providerIds: string[]) {
    super(
      `Ambiguous exclusive resolution for capability "${capability}": ` +
        `providers [${providerIds.join(", ")}] are tied with no user ` +
        `preference or unique default/highest-priority provider to break ` +
        `the tie.`,
    );
    this.name = "AmbiguousResolutionError";
    this.capability = capability;
    this.providerIds = providerIds;
  }
}

/**
 * Thrown by `Kernel.resolve()` when a `spineCritical` capability has no
 * compatible provider (every registered provider was excluded by version
 * gating, or none were registered at all) AND no `vanilla` fallback.
 *
 * The spine cannot boot without this capability, so the kernel refuses to
 * silently continue with the capability absent — unlike a non-spine-critical
 * capability in the same situation, which simply resolves to zero active
 * instances.
 */
export class SpineCapabilityUnsatisfiedError extends Error {
  readonly capability: string;

  constructor(capability: string) {
    super(
      `Spine-critical capability "${capability}" has no compatible provider ` +
        `and no vanilla fallback; the kernel cannot start.`,
    );
    this.name = "SpineCapabilityUnsatisfiedError";
    this.capability = capability;
  }
}

/**
 * Thrown by `Kernel.resolve()` (via the dependency broker's topo-sort) when
 * two or more capabilities' *selected* providers depend on each other,
 * directly or transitively, so there is no valid dependency-first activation
 * order.
 *
 * `cycle` lists the capability ids that form the cycle, in dependency order
 * (each depends on the next, and the last depends back on the first) — it is
 * a diagnostic aid, not necessarily every capability affected by the cycle
 * (a capability outside the cycle that merely depends on a cyclic one is not
 * included).
 */
export class DependencyCycleError extends Error {
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(
      `Dependency cycle detected among capabilities: ${cycle.join(" -> ")}. ` +
        `The kernel cannot determine a dependency-first activation order.`,
    );
    this.name = "DependencyCycleError";
    this.cycle = cycle;
  }
}
