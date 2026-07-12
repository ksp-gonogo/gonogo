import { topoSortActivationOrder } from "./broker";
import type {
  CapabilityDescriptor,
  CapabilityId,
  ProviderContext,
  ProviderRegistration,
} from "./capability";
import {
  AmbiguousResolutionError,
  SpineCapabilityUnsatisfiedError,
} from "./errors";
import { satisfiesKernel, satisfiesModRange } from "./version";

export interface ResolveOptions {
  kernelVersion: string;
  modVersion?: string;
  preferences?: Record<CapabilityId, string>;
}

export interface ResolutionNotice {
  capability: CapabilityId;
  /**
   * "superseded" -> Task 4 (exclusive-conflict resolution)
   * "version-excluded" -> Task 5 (version gating)
   * "vanilla-fallback" -> this task: no provider registered/survived, used
   *   the capability's vanilla factory instead.
   */
  kind: "superseded" | "version-excluded" | "vanilla-fallback";
  detail: string;
}

/**
 * The set of providers chosen to activate for one capability, decided
 * during the selection phase of `resolve()` — before any factory has run.
 * Empty `providers` means "no provider survived selection"; activation then
 * falls back to the capability's `vanilla` factory (if any) or resolves to
 * zero active instances.
 */
interface CapabilitySelection {
  descriptor: CapabilityDescriptor;
  providers: ProviderRegistration[];
}

/**
 * The capability/provider registry.
 *
 * `resolve()` runs in three phases, in order:
 *  1. **Selection** (`selectCapability`) — for every registered capability,
 *     decide which provider(s) win (version gating, then exclusive-conflict
 *     resolution or shared fan-out). No factory runs yet, so this phase can
 *     freely iterate `this.capabilities` in registration order without any
 *     capability depending on another capability's factory having already
 *     run.
 *  2. **Ordering** (`topoSortActivationOrder`, in `./broker`) — build one
 *     dependency-graph node per capability from its selected provider(s)'
 *     `deps`, and topo-sort so a capability's declared dependencies precede
 *     it. Throws `DependencyCycleError` if the graph has a cycle.
 *  3. **Activation** (`activateSelection`) — walk the topo order and invoke
 *     factories, writing each capability's active instances into
 *     `activeInstances` immediately after its factory runs (not batched at
 *     the end), so a later capability's factory can call
 *     `ctx.query(dep)` and see the dependency's already-active instance.
 *
 * This split is what let each milestone task land without reshaping the
 * ones before it:
 *  - Task 4 (exclusive-conflict resolution) is the priority/isDefault
 *    tie-breaking inside step 1's `selectExclusive`, emitting "superseded"
 *    notices.
 *  - Task 5 (version gating + spine-halt) is a candidate-filtering pass
 *    (using `spineCritical` / `versions`) inside step 1, before selection,
 *    emitting "version-excluded" notices.
 *  - Task 6 (dependency broker) is steps 2 and 3 — selection decides *who*
 *    wins per capability; the broker decides *when* each winner's factory
 *    runs.
 */
export class Kernel {
  private readonly capabilities = new Map<CapabilityId, CapabilityDescriptor>();
  private readonly providers = new Map<CapabilityId, ProviderRegistration[]>();
  private readonly activeInstances = new Map<CapabilityId, unknown[]>();

  registerCapability<T>(descriptor: CapabilityDescriptor<T>): void {
    this.capabilities.set(descriptor.id, descriptor as CapabilityDescriptor);
    if (!this.providers.has(descriptor.id)) {
      this.providers.set(descriptor.id, []);
    }
    if (!this.activeInstances.has(descriptor.id)) {
      this.activeInstances.set(descriptor.id, []);
    }
  }

  registerProvider<T>(registration: ProviderRegistration<T>): void {
    const providers = this.providers.get(registration.capability);
    if (providers === undefined) {
      throw new Error(
        `Cannot register provider "${registration.id}" for unknown capability "${registration.capability}". Call registerCapability() first.`,
      );
    }
    providers.push(registration as ProviderRegistration);
  }

  resolve(opts: ResolveOptions): { notices: ResolutionNotice[] } {
    const notices: ResolutionNotice[] = [];
    const ctx: ProviderContext = {
      kernelVersion: opts.kernelVersion,
      query: <T>(capability: CapabilityId) => this.query<T>(capability),
    };

    // Phase 1: selection — decide the winning provider(s) per capability.
    // No factory has run yet, so this can safely iterate in plain
    // registration order regardless of any `deps` relationships.
    const selections: CapabilitySelection[] = [];
    for (const descriptor of this.capabilities.values()) {
      selections.push(this.selectCapability(descriptor, opts, notices));
    }

    // Phase 2: ordering — topo-sort capability activation so a provider's
    // `deps` are active before its factory runs. Edges come from each
    // capability's *selected* provider(s), not every registered candidate.
    const order = topoSortActivationOrder(
      selections.map((selection) => ({
        id: selection.descriptor.id,
        deps: dedupe(
          selection.providers.flatMap((provider) => provider.deps ?? []),
        ),
      })),
    );
    const selectionById = new Map(
      selections.map((selection) => [selection.descriptor.id, selection]),
    );

    // Phase 3: activation — run factories in topo order, publishing each
    // capability's active instances immediately so later factories in the
    // order can `ctx.query()` them.
    for (const capability of order) {
      const selection = selectionById.get(capability);
      if (selection === undefined) {
        continue;
      }
      const instances = this.activateSelection(selection, ctx, notices);
      this.activeInstances.set(capability, instances);
    }

    return { notices };
  }

  /**
   * Selection phase for one capability: version-gate the registered
   * candidates, apply the spine-critical halt check, then hand the survivors
   * to exclusive-conflict resolution (Task 4) or shared fan-out. Returns the
   * provider(s) chosen to activate — empty means "fall back to vanilla (or
   * nothing)" once activation runs. Does not call any factory.
   */
  private selectCapability(
    descriptor: CapabilityDescriptor,
    opts: ResolveOptions,
    notices: ResolutionNotice[],
  ): CapabilitySelection {
    const registered = this.providers.get(descriptor.id) ?? [];
    const candidates = this.filterVersionCompatible(
      descriptor.id,
      registered,
      opts,
      notices,
    );

    if (
      descriptor.spineCritical &&
      candidates.length === 0 &&
      !descriptor.vanilla
    ) {
      throw new SpineCapabilityUnsatisfiedError(descriptor.id);
    }

    const providers = descriptor.exclusive
      ? this.selectExclusive(
          descriptor.id,
          candidates,
          notices,
          opts.preferences,
        )
      : candidates;

    return { descriptor, providers };
  }

  /**
   * Version-gate pass (Task 5): runs BEFORE exclusive/shared selection, so
   * ambiguity (Task 4) is computed only over providers compatible with the
   * running kernel/mod version. A provider whose `versions.minKernelVersion`
   * exceeds `opts.kernelVersion`, or whose `versions.targetModVersionRange`
   * does not contain `opts.modVersion`, is excluded and gets a
   * "version-excluded" notice naming it. A provider with no `versions` (or
   * no constraints within it) is always compatible.
   */
  private filterVersionCompatible(
    capability: CapabilityId,
    candidates: ProviderRegistration[],
    opts: ResolveOptions,
    notices: ResolutionNotice[],
  ): ProviderRegistration[] {
    const compatible: ProviderRegistration[] = [];

    for (const candidate of candidates) {
      const kernelOk = satisfiesKernel(
        opts.kernelVersion,
        candidate.versions?.minKernelVersion,
      );
      const modOk = satisfiesModRange(
        opts.modVersion,
        candidate.versions?.targetModVersionRange,
      );

      if (kernelOk && modOk) {
        compatible.push(candidate);
        continue;
      }

      notices.push({
        capability,
        kind: "version-excluded",
        detail: `Provider "${candidate.id}" excluded: incompatible with kernelVersion "${opts.kernelVersion}"${
          opts.modVersion !== undefined
            ? ` / modVersion "${opts.modVersion}"`
            : ""
        }.`,
      });
    }

    return compatible;
  }

  active(capability: CapabilityId): unknown[] {
    this.assertKnownCapability(capability);
    return this.activeInstances.get(capability) ?? [];
  }

  query<T>(capability: CapabilityId): T {
    const instances = this.active(capability);
    if (instances.length !== 1) {
      throw new Error(
        `Capability "${capability}" does not resolve to exactly one active provider (found ${instances.length}).`,
      );
    }
    return instances[0] as T;
  }

  /**
   * Exclusive-conflict selection (Task 4): picks 0 or 1 winning provider
   * from `candidates` without calling any factory. Emits "superseded"
   * notices for every non-winning candidate.
   */
  private selectExclusive(
    capability: CapabilityId,
    candidates: ProviderRegistration[],
    notices: ResolutionNotice[],
    preferences: Record<CapabilityId, string> | undefined,
  ): ProviderRegistration[] {
    if (candidates.length === 0) {
      return [];
    }
    if (candidates.length === 1) {
      return [candidates[0]];
    }

    const { winner, reason } = this.resolveExclusiveWinner(
      capability,
      candidates,
      preferences,
    );

    for (const candidate of candidates) {
      if (candidate === winner) {
        continue;
      }
      notices.push({
        capability,
        kind: "superseded",
        detail: `Provider "${candidate.id}" superseded by "${winner.id}" (${reason}).`,
      });
    }

    return [winner];
  }

  /**
   * Precedence for an exclusive capability with ≥2 candidates:
   *  1. `preferences[capability]` naming a registered provider id wins
   *     outright (preference beats default). A preference naming an
   *     unregistered id is a stale preference — ignored, falling through.
   *  2. Else a single `isDefault: true` provider wins. Multiple `isDefault`
   *     providers is itself ambiguous.
   *  3. Else the single provider with the unique highest `priority`
   *     (default 0) wins — a clean supersede.
   *  4. Else — two or more tied top candidates with no default/preference to
   *     break the tie — fail loud with `AmbiguousResolutionError` rather
   *     than silently picking by registration order.
   */
  private resolveExclusiveWinner(
    capability: CapabilityId,
    candidates: ProviderRegistration[],
    preferences: Record<CapabilityId, string> | undefined,
  ): { winner: ProviderRegistration; reason: string } {
    const preferredId = preferences?.[capability];
    if (preferredId !== undefined) {
      const preferred = candidates.find((c) => c.id === preferredId);
      if (preferred !== undefined) {
        return { winner: preferred, reason: "user preference" };
      }
      // Stale preference (names a provider that isn't registered for this
      // capability) — ignore it and fall through to default/priority.
    }

    const defaults = candidates.filter((c) => c.isDefault);
    if (defaults.length === 1) {
      return { winner: defaults[0], reason: "default" };
    }
    if (defaults.length > 1) {
      throw new AmbiguousResolutionError(
        capability,
        defaults.map((c) => c.id),
      );
    }

    const maxPriority = Math.max(...candidates.map((c) => c.priority ?? 0));
    const topCandidates = candidates.filter(
      (c) => (c.priority ?? 0) === maxPriority,
    );
    if (topCandidates.length === 1) {
      return { winner: topCandidates[0], reason: `priority ${maxPriority}` };
    }

    throw new AmbiguousResolutionError(
      capability,
      topCandidates.map((c) => c.id),
    );
  }

  /**
   * Activation phase (step 3 of `resolve()`): runs the factories for one
   * capability's selection, in topo order relative to other capabilities.
   * Empty `providers` (from either exclusive or shared selection) falls
   * back to the capability's vanilla factory.
   */
  private activateSelection(
    selection: CapabilitySelection,
    ctx: ProviderContext,
    notices: ResolutionNotice[],
  ): unknown[] {
    const { descriptor, providers } = selection;
    if (providers.length === 0) {
      return this.activateVanilla(descriptor, ctx, notices);
    }
    return providers.map((provider) => provider.factory(ctx));
  }

  private activateVanilla(
    descriptor: CapabilityDescriptor,
    ctx: ProviderContext,
    notices: ResolutionNotice[],
  ): unknown[] {
    if (!descriptor.vanilla) {
      return [];
    }
    notices.push({
      capability: descriptor.id,
      kind: "vanilla-fallback",
      detail: `No provider registered for capability "${descriptor.id}"; activated vanilla fallback.`,
    });
    return [descriptor.vanilla(ctx)];
  }

  private assertKnownCapability(capability: CapabilityId): void {
    if (!this.capabilities.has(capability)) {
      throw new Error(`Unknown capability "${capability}".`);
    }
  }
}

/** Order-preserving de-dup, used to union `deps` across a capability's
 * selected provider(s) before handing them to the topo-sort. */
function dedupe(ids: CapabilityId[]): CapabilityId[] {
  return [...new Set(ids)];
}
