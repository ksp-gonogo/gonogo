/**
 * Task 8: end-to-end integration sweep.
 *
 * Every prior task (T3-T7) has its own focused unit tests in
 * `registry.test.ts` / `broker.test.ts` / `version.test.ts` /
 * `proof/comms.test.ts`. This file proves the mechanisms compose: ONE
 * `resolve()` call wiring an exclusive default+loser, a shared capability,
 * a cross-capability dependency, and a version-excluded-to-vanilla fallback
 * all in the same kernel, asserting the full result (active sets + notices)
 * in one go, plus that the outcome is deterministic across repeated builds.
 *
 * It then covers the fail-loud paths, each as its own `resolve()` that
 * throws: a dependency cycle, an ambiguous exclusive tie, a spine-critical
 * capability with no compatible provider and no vanilla, and (filling a T4
 * coverage gap) two `isDefault` providers with unequal priority — still
 * ambiguous, because multiple defaults is checked before priority.
 */
import { describe, expect, it } from "vitest";
import type { ProviderContext } from "./capability";
import {
  AmbiguousResolutionError,
  DependencyCycleError,
  SpineCapabilityUnsatisfiedError,
} from "./errors";
import { Kernel } from "./registry";

interface Named {
  name: string;
}

interface TelemetryInstance extends Named {
  commsName: string;
}

/**
 * Builds a fresh kernel wiring four capabilities together, in the same
 * registration order every time (used both for the main assertions and for
 * the determinism check).
 */
function buildScenario(): Kernel {
  const kernel = new Kernel();

  // 1. Exclusive capability with a default winner and a superseded loser.
  kernel.registerCapability<Named>({ id: "comms", exclusive: true });
  kernel.registerProvider<Named>({
    capability: "comms",
    id: "comms-default",
    isDefault: true,
    factory: () => ({ name: "comms-default" }),
  });
  kernel.registerProvider<Named>({
    capability: "comms",
    id: "comms-alt",
    factory: () => ({ name: "comms-alt" }),
  });

  // 2. Shared (non-exclusive) capability: both providers stay active.
  kernel.registerCapability<Named>({ id: "sensors", exclusive: false });
  kernel.registerProvider<Named>({
    capability: "sensors",
    id: "sensor-a",
    factory: () => ({ name: "sensor-a" }),
  });
  kernel.registerProvider<Named>({
    capability: "sensors",
    id: "sensor-b",
    factory: () => ({ name: "sensor-b" }),
  });

  // 3. A capability whose winning provider depends on "comms" — proves
  // dependency-first activation: the factory's ctx.query("comms") must
  // succeed, which only works if "comms" activated before "telemetry".
  kernel.registerCapability<TelemetryInstance>({
    id: "telemetry",
    exclusive: true,
  });
  kernel.registerProvider<TelemetryInstance>({
    capability: "telemetry",
    id: "telemetry-provider",
    deps: ["comms"],
    factory: (ctx: ProviderContext) => {
      const comms = ctx.query<Named>("comms");
      return { name: "telemetry", commsName: comms.name };
    },
  });

  // 4. A capability whose only provider is version-excluded, falling back
  // to vanilla.
  kernel.registerCapability<Named>({
    id: "power",
    exclusive: true,
    vanilla: () => ({ name: "power-vanilla" }),
  });
  kernel.registerProvider<Named>({
    capability: "power",
    id: "power-future",
    versions: { self: "1.0.0", minKernelVersion: "99.0.0" },
    factory: () => ({ name: "power-future" }),
  });

  return kernel;
}

describe("kernel integration: several mechanisms wired together in one resolve()", () => {
  it("resolves the full active set and notices for all four capabilities at once", () => {
    const kernel = buildScenario();

    const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

    // Exclusive: default wins, alt is gone.
    expect(kernel.active("comms")).toEqual([{ name: "comms-default" }]);

    // Shared: both providers active, order-independent.
    expect(kernel.active("sensors")).toHaveLength(2);
    expect(kernel.active("sensors")).toEqual(
      expect.arrayContaining([{ name: "sensor-a" }, { name: "sensor-b" }]),
    );

    // Dependency-first activation: the depender's factory actually saw the
    // winning "comms" instance via ctx.query, not just an empty/placeholder.
    expect(kernel.active("telemetry")).toEqual([
      { name: "telemetry", commsName: "comms-default" },
    ]);

    // Version-excluded provider -> vanilla fallback.
    expect(kernel.active("power")).toEqual([{ name: "power-vanilla" }]);

    // All three notice kinds fired, naming the right providers/capabilities.
    expect(notices).toContainEqual(
      expect.objectContaining({
        capability: "comms",
        kind: "superseded",
        detail: expect.stringContaining("comms-alt"),
      }),
    );
    expect(notices).toContainEqual(
      expect.objectContaining({
        capability: "power",
        kind: "version-excluded",
        detail: expect.stringContaining("power-future"),
      }),
    );
    expect(notices).toContainEqual(
      expect.objectContaining({
        capability: "power",
        kind: "vanilla-fallback",
      }),
    );

    // Exactly these four capabilities produced a notice; sensors/telemetry
    // resolved cleanly with nothing to report.
    const noticeCapabilities = new Set(notices.map((n) => n.capability));
    expect(noticeCapabilities).toEqual(new Set(["comms", "power"]));
  });

  it("is deterministic: rebuilding the identical scenario and resolving again yields the same active sets and notices, in the same order", () => {
    const first = buildScenario();
    const firstResult = first.resolve({ kernelVersion: "1.0.0" });

    const second = buildScenario();
    const secondResult = second.resolve({ kernelVersion: "1.0.0" });

    expect(secondResult.notices).toEqual(firstResult.notices);
    for (const capability of ["comms", "sensors", "telemetry", "power"]) {
      expect(second.active(capability)).toEqual(first.active(capability));
    }
  });

  describe("negative cases", () => {
    it("throws DependencyCycleError when two capabilities' selected providers depend on each other", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Named>({ id: "x", exclusive: true });
      kernel.registerCapability<Named>({ id: "y", exclusive: true });
      kernel.registerProvider<Named>({
        capability: "x",
        id: "x-provider",
        deps: ["y"],
        factory: () => ({ name: "x" }),
      });
      kernel.registerProvider<Named>({
        capability: "y",
        id: "y-provider",
        deps: ["x"],
        factory: () => ({ name: "y" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).toThrow(
        DependencyCycleError,
      );
    });

    it("throws AmbiguousResolutionError for an exclusive capability with two equal-top candidates and no default/preference", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Named>({ id: "comms", exclusive: true });
      kernel.registerProvider<Named>({
        capability: "comms",
        id: "A",
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Named>({
        capability: "comms",
        id: "B",
        factory: () => ({ name: "B" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).toThrow(
        AmbiguousResolutionError,
      );
    });

    it("throws SpineCapabilityUnsatisfiedError when a spine-critical capability has no compatible provider and no vanilla", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Named>({
        id: "life-support",
        exclusive: true,
        spineCritical: true,
      });
      kernel.registerProvider<Named>({
        capability: "life-support",
        id: "future-provider",
        versions: { self: "1.0.0", minKernelVersion: "99.0.0" },
        factory: () => ({ name: "future" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).toThrow(
        SpineCapabilityUnsatisfiedError,
      );
    });

    it("throws AmbiguousResolutionError when two isDefault providers have unequal priority (default-multiplicity beats priority)", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Named>({ id: "comms", exclusive: true });
      kernel.registerProvider<Named>({
        capability: "comms",
        id: "A",
        isDefault: true,
        priority: 10,
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Named>({
        capability: "comms",
        id: "B",
        isDefault: true,
        priority: 1,
        factory: () => ({ name: "B" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).toThrow(
        AmbiguousResolutionError,
      );
    });
  });
});
