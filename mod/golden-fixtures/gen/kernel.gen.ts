#!/usr/bin/env tsx
/**
 * Golden-fixture generator for `mod/sitrep-kernel/src/{capability,registry,broker,errors}.ts`
 * (the `Kernel` class — Task 6 of the M5a C# port).
 *
 * `Kernel` is far too stateful/behavioral for a `{args, expected}` vector
 * fixture, and its provider `factory` functions can't be serialized to JSON
 * at all. So each scenario here is a **scripted scenario**, in the same
 * spirit as `clock.gen.ts` / `stub-network.gen.ts` / `archive.gen.ts` /
 * `courier.gen.ts`:
 *
 *  - `ops` is a sequence of `registerCapability` / `registerProvider` calls
 *    (registration only — `Kernel.resolve()` itself is invoked once, after
 *    all ops, via the top-level `resolve` field).
 *  - A provider's un-serializable `factory` is replaced by a marker: it
 *    returns its own `id` string as its "instance", and (for capabilities
 *    with `hasVanilla: true`) the vanilla factory returns the literal
 *    string `"vanilla"`. Since `expected.activePerCapability` is keyed per
 *    capability, `"vanilla"` never collides with a real provider id.
 *  - Every invoked factory (provider or vanilla) also appends its owning
 *    capability's id to a shared `activationOrder` log, purely for
 *    observing the dependency broker's topo-sort — this is what lets the
 *    fixture assert "a provider's deps are active before its factory runs"
 *    without needing real closures.
 *  - A provider op may set `queryDeps: true` to have its factory actually
 *    call `ctx.query(dep)` for each of its `deps` (ignoring the result) —
 *    this exercises the real dependency-satisfaction path (a dep that
 *    resolves to zero or >1 active instances makes `ctx.query` throw),
 *    mirroring the TS reference's own dependency-broker tests. Scenarios
 *    that only care about *ordering*, not query success, leave this unset
 *    so an intentionally-unsatisfied dep (e.g. "absent", spine-halted)
 *    doesn't turn into a spurious throw.
 *
 * `runScenario` builds a REAL `Kernel`, replays the ops, then calls
 * `resolve()` exactly once inside a try/catch:
 *  - success -> `expected` carries `activationOrder`, `activePerCapability`
 *    (every registered capability's `kernel.active(id)`, coerced to
 *    strings), and `notices` (`{capability, kind}` only — `detail` is a
 *    human message, not part of the cross-language contract).
 *  - throw -> `expectedError` carries the thrown error's `name` (one of the
 *    three fail-loud kernel errors for every scenario below), and
 *    `activeAfterThrow` snapshots `kernel.active(id)` for every registered
 *    capability post-throw — this is the atomicity assertion: a resolve()
 *    that throws must not have activated anything, anywhere, not just for
 *    the capability that caused the throw.
 *
 * Both the TS reference (already covered by `registry.test.ts` /
 * `broker.test.ts`) and the C# port (`Sitrep.Core.Tests/KernelGoldenFixtureTests.cs`)
 * are checked against this same file.
 *
 * Run with: `pnpm --filter @ksp-gonogo/sitrep-kernel gen:golden-fixtures`
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CapabilityId,
  ProviderContext,
  ProviderVersions,
} from "../../sitrep-kernel/src/capability.ts";
import {
  Kernel,
  type ResolveOptions,
} from "../../sitrep-kernel/src/registry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "kernel.json");

interface RegisterCapabilityOp {
  op: "registerCapability";
  id: CapabilityId;
  exclusive: boolean;
  spineCritical?: boolean;
  /** When true, the vanilla factory returns the marker "vanilla". */
  hasVanilla?: boolean;
}

interface RegisterProviderOp {
  op: "registerProvider";
  capability: CapabilityId;
  id: string;
  isDefault?: boolean;
  priority?: number;
  deps?: CapabilityId[];
  versions?: ProviderVersions;
  /**
   * When true, the factory calls `ctx.query(dep)` for every declared dep
   * (ignoring the result) so a genuinely-unsatisfied dep surfaces as a
   * thrown error, instead of silently being ignored like an unused `deps`
   * entry would be.
   */
  queryDeps?: boolean;
}

type Op = RegisterCapabilityOp | RegisterProviderOp;

interface Scenario {
  name: string;
  description: string;
  ops: Op[];
  resolve: ResolveOptions;
}

interface ScenarioSuccess {
  activationOrder: CapabilityId[];
  activePerCapability: Record<CapabilityId, string[]>;
  notices: Array<{ capability: CapabilityId; kind: string }>;
}

interface ScenarioResult extends Scenario {
  expectedError?: string;
  expected?: ScenarioSuccess;
  /** Only present for `expectedError` scenarios: proves resolve() is atomic. */
  activeAfterThrow?: Record<CapabilityId, string[]>;
}

/** Runs one scenario's ops against a real `Kernel`, then calls resolve() once. */
function runScenario(scenario: Scenario): ScenarioResult {
  const kernel = new Kernel();
  const activationOrder: CapabilityId[] = [];
  const capabilityIds: CapabilityId[] = [];

  for (const op of scenario.ops) {
    if (op.op === "registerCapability") {
      capabilityIds.push(op.id);
      kernel.registerCapability({
        id: op.id,
        exclusive: op.exclusive,
        spineCritical: op.spineCritical,
        vanilla: op.hasVanilla
          ? () => {
              activationOrder.push(op.id);
              return "vanilla";
            }
          : undefined,
      });
    } else {
      const deps = op.deps;
      const queryDeps = op.queryDeps ?? false;
      kernel.registerProvider({
        capability: op.capability,
        id: op.id,
        isDefault: op.isDefault,
        priority: op.priority,
        deps,
        versions: op.versions,
        factory: (ctx: ProviderContext) => {
          activationOrder.push(op.capability);
          if (queryDeps) {
            for (const dep of deps ?? []) {
              ctx.query<string>(dep);
            }
          }
          return op.id;
        },
      });
    }
  }

  try {
    const { notices } = kernel.resolve(scenario.resolve);
    const activePerCapability: Record<CapabilityId, string[]> = {};
    for (const id of capabilityIds) {
      activePerCapability[id] = kernel.active(id) as string[];
    }
    return {
      ...scenario,
      expected: {
        activationOrder,
        activePerCapability,
        notices: notices.map((n) => ({
          capability: n.capability,
          kind: n.kind,
        })),
      },
    };
  } catch (err) {
    const activeAfterThrow: Record<CapabilityId, string[]> = {};
    for (const id of capabilityIds) {
      activeAfterThrow[id] = kernel.active(id) as string[];
    }
    return {
      ...scenario,
      expectedError: err instanceof Error ? err.name : "UnknownError",
      activeAfterThrow,
    };
  }
}

const scenarios: Scenario[] = [
  {
    name: "vanilla-fallback-when-no-provider",
    description:
      "An exclusive capability with no registered provider activates its vanilla factory and emits a vanilla-fallback notice.",
    ops: [
      {
        op: "registerCapability",
        id: "comms",
        exclusive: true,
        hasVanilla: true,
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "single-provider-wins-over-vanilla",
    description:
      "A single registered provider activates instead of vanilla, with no vanilla-fallback notice.",
    ops: [
      {
        op: "registerCapability",
        id: "comms",
        exclusive: true,
        hasVanilla: true,
      },
      { op: "registerProvider", capability: "comms", id: "real-provider" },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "exclusive-default-beats-loser",
    description:
      "Two exclusive candidates, one isDefault: the default wins and the other is superseded.",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      { op: "registerProvider", capability: "comms", id: "A", isDefault: true },
      { op: "registerProvider", capability: "comms", id: "B" },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "unique-max-priority-wins",
    description:
      "Two exclusive candidates, neither isDefault: the unique highest-priority one wins (clean supersede, not ambiguous).",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      { op: "registerProvider", capability: "comms", id: "A", priority: 5 },
      { op: "registerProvider", capability: "comms", id: "B", priority: 1 },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "ambiguous-equal-priority-no-default-throws",
    description:
      "Two exclusive candidates tied on priority with no default: AmbiguousResolutionError.",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      { op: "registerProvider", capability: "comms", id: "A", priority: 3 },
      { op: "registerProvider", capability: "comms", id: "B", priority: 3 },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "ambiguous-multiple-defaults-throws",
    description:
      "Two exclusive candidates both isDefault: AmbiguousResolutionError, even though priority would otherwise tie-break.",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      { op: "registerProvider", capability: "comms", id: "A", isDefault: true },
      { op: "registerProvider", capability: "comms", id: "B", isDefault: true },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "preference-beats-default",
    description:
      "A resolve-time preference for a non-default provider wins over the isDefault provider.",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      { op: "registerProvider", capability: "comms", id: "A", isDefault: true },
      { op: "registerProvider", capability: "comms", id: "B" },
    ],
    resolve: { kernelVersion: "1.0.0", preferences: { comms: "B" } },
  },
  {
    name: "stale-preference-falls-through-to-default",
    description:
      "A preference naming an unregistered provider id is ignored, falling through to the isDefault provider.",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      { op: "registerProvider", capability: "comms", id: "A", isDefault: true },
      { op: "registerProvider", capability: "comms", id: "B" },
    ],
    resolve: {
      kernelVersion: "1.0.0",
      preferences: { comms: "does-not-exist" },
    },
  },
  {
    name: "version-excluded-falls-back-to-remaining-provider",
    description:
      "The isDefault provider is version-excluded (minKernelVersion too high); the sole remaining compatible provider wins with no ambiguity/superseded machinery involved.",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      {
        op: "registerProvider",
        capability: "comms",
        id: "A",
        isDefault: true,
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
      },
      { op: "registerProvider", capability: "comms", id: "B" },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "version-excluded-only-provider-falls-back-to-vanilla",
    description:
      "The only registered provider is version-excluded and there's no other candidate; the capability falls back to vanilla with both a version-excluded and a vanilla-fallback notice.",
    ops: [
      {
        op: "registerCapability",
        id: "comms",
        exclusive: true,
        hasVanilla: true,
      },
      {
        op: "registerProvider",
        capability: "comms",
        id: "A",
        isDefault: true,
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "mod-version-range-excludes-provider",
    description:
      "A provider whose targetModVersionRange doesn't contain the resolve modVersion is excluded, falling back to vanilla.",
    ops: [
      {
        op: "registerCapability",
        id: "comms",
        exclusive: true,
        hasVanilla: true,
      },
      {
        op: "registerProvider",
        capability: "comms",
        id: "A",
        versions: {
          self: "1.0.0",
          targetModVersionRange: { min: "2.0.0", max: "3.0.0" },
        },
      },
    ],
    resolve: { kernelVersion: "1.0.0", modVersion: "1.5.0" },
  },
  {
    name: "spine-critical-unsatisfiable-throws",
    description:
      "A spineCritical capability with every provider version-excluded and no vanilla: SpineCapabilityUnsatisfiedError halts resolve().",
    ops: [
      {
        op: "registerCapability",
        id: "life-support",
        exclusive: true,
        spineCritical: true,
      },
      {
        op: "registerProvider",
        capability: "life-support",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "spine-critical-satisfied-by-vanilla-no-throw",
    description:
      "A spineCritical capability with all providers version-excluded but a vanilla fallback present: resolves to vanilla, no throw.",
    ops: [
      {
        op: "registerCapability",
        id: "life-support",
        exclusive: true,
        spineCritical: true,
        hasVanilla: true,
      },
      {
        op: "registerProvider",
        capability: "life-support",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "shared-capability-activates-all-providers",
    description:
      "A non-exclusive (shared) capability activates every registered provider, no notices.",
    ops: [
      { op: "registerCapability", id: "sensors", exclusive: false },
      { op: "registerProvider", capability: "sensors", id: "sensor-a" },
      { op: "registerProvider", capability: "sensors", id: "sensor-b" },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "shared-capability-never-ambiguous-with-tied-priority",
    description:
      "Tied priority never triggers AmbiguousResolutionError for a shared capability; both providers simply activate.",
    ops: [
      { op: "registerCapability", id: "sensors", exclusive: false },
      {
        op: "registerProvider",
        capability: "sensors",
        id: "sensor-a",
        priority: 3,
      },
      {
        op: "registerProvider",
        capability: "sensors",
        id: "sensor-b",
        priority: 3,
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "dependency-first-activation-registered-out-of-order",
    description:
      "The dependent capability is registered before its dependency ('base'); the broker still activates 'base' first so the dependent's ctx.query(\"base\") succeeds.",
    ops: [
      { op: "registerCapability", id: "dependent", exclusive: true },
      { op: "registerCapability", id: "base", exclusive: true },
      {
        op: "registerProvider",
        capability: "dependent",
        id: "dependent-provider",
        deps: ["base"],
        queryDeps: true,
      },
      { op: "registerProvider", capability: "base", id: "base-provider" },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "dependency-on-vanilla-resolved-capability",
    description:
      "A dependency with no registered provider resolves to its vanilla fallback, which activates before the dependent so ctx.query sees it.",
    ops: [
      { op: "registerCapability", id: "dependent", exclusive: true },
      {
        op: "registerCapability",
        id: "base",
        exclusive: true,
        hasVanilla: true,
      },
      {
        op: "registerProvider",
        capability: "dependent",
        id: "dependent-provider",
        deps: ["base"],
        queryDeps: true,
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "absent-dependency-does-not-block-activation",
    description:
      "A dep naming a capability with no provider and no vanilla (zero active instances) doesn't block the dependent's activation as long as the factory never calls ctx.query for it.",
    ops: [
      { op: "registerCapability", id: "dependent", exclusive: true },
      { op: "registerCapability", id: "absent", exclusive: true },
      {
        op: "registerProvider",
        capability: "dependent",
        id: "dependent-provider",
        deps: ["absent"],
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "dependency-cycle-throws",
    description:
      "Two capabilities' selected providers depend on each other: DependencyCycleError, no activation order exists.",
    ops: [
      { op: "registerCapability", id: "a", exclusive: true },
      { op: "registerCapability", id: "b", exclusive: true },
      {
        op: "registerProvider",
        capability: "a",
        id: "a-provider",
        deps: ["b"],
      },
      {
        op: "registerProvider",
        capability: "b",
        id: "b-provider",
        deps: ["a"],
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "spine-critical-halt-not-swallowed-by-dependent",
    description:
      "A spine-critical halt on a capability that another capability depends on still propagates as SpineCapabilityUnsatisfiedError (selection happens before ordering/activation).",
    ops: [
      {
        op: "registerCapability",
        id: "life-support",
        exclusive: true,
        spineCritical: true,
      },
      { op: "registerCapability", id: "dependent", exclusive: true },
      {
        op: "registerProvider",
        capability: "life-support",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
      },
      {
        op: "registerProvider",
        capability: "dependent",
        id: "dependent-provider",
        deps: ["life-support"],
      },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
  {
    name: "atomic-resolve-activates-nothing-on-throw",
    description:
      "An unrelated capability that would otherwise resolve cleanly must NOT end up activated when a different capability's resolve() throws — resolve() is all-or-nothing.",
    ops: [
      { op: "registerCapability", id: "comms", exclusive: true },
      { op: "registerProvider", capability: "comms", id: "real-provider" },
      { op: "registerCapability", id: "conflict", exclusive: true },
      { op: "registerProvider", capability: "conflict", id: "X", priority: 3 },
      { op: "registerProvider", capability: "conflict", id: "Y", priority: 3 },
    ],
    resolve: { kernelVersion: "1.0.0" },
  },
];

const results = scenarios.map(runScenario);

writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`);
console.log(`golden-fixtures -> ${OUT_FILE} (${results.length} scenarios)`);
