import { describe, expect, it } from "vitest";
import type { ProviderContext } from "./capability";
import {
  AmbiguousResolutionError,
  DependencyCycleError,
  SpineCapabilityUnsatisfiedError,
} from "./errors";
import { Kernel } from "./registry";

interface Comms {
  name: string;
}

describe("Kernel", () => {
  it("falls back to the vanilla provider when none is registered", () => {
    const kernel = new Kernel();
    kernel.registerCapability<Comms>({
      id: "comms",
      exclusive: true,
      vanilla: () => ({ name: "vanilla" }),
    });

    const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

    expect(kernel.query<Comms>("comms")).toEqual({ name: "vanilla" });
    expect(notices).toContainEqual(
      expect.objectContaining({
        capability: "comms",
        kind: "vanilla-fallback",
      }),
    );
  });

  it("activates the single registered provider instead of vanilla", () => {
    const kernel = new Kernel();
    kernel.registerCapability<Comms>({
      id: "comms",
      exclusive: true,
      vanilla: () => ({ name: "vanilla" }),
    });
    kernel.registerProvider<Comms>({
      capability: "comms",
      id: "real-provider",
      factory: () => ({ name: "real" }),
    });

    const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

    expect(kernel.query<Comms>("comms")).toEqual({ name: "real" });
    expect(
      notices.some(
        (n) => n.capability === "comms" && n.kind === "vanilla-fallback",
      ),
    ).toBe(false);
  });

  it("activates every provider for a non-exclusive capability", () => {
    const kernel = new Kernel();
    kernel.registerCapability<Comms>({ id: "sensors", exclusive: false });
    kernel.registerProvider<Comms>({
      capability: "sensors",
      id: "sensor-a",
      factory: () => ({ name: "a" }),
    });
    kernel.registerProvider<Comms>({
      capability: "sensors",
      id: "sensor-b",
      factory: () => ({ name: "b" }),
    });

    kernel.resolve({ kernelVersion: "1.0.0" });

    const active = kernel.active("sensors");
    expect(active).toHaveLength(2);
    expect(active).toEqual(
      expect.arrayContaining([{ name: "a" }, { name: "b" }]),
    );
  });

  it("query() throws when a capability does not resolve to exactly one active provider", () => {
    const kernel = new Kernel();
    kernel.registerCapability<Comms>({ id: "sensors", exclusive: false });
    kernel.registerProvider<Comms>({
      capability: "sensors",
      id: "sensor-a",
      factory: () => ({ name: "a" }),
    });
    kernel.registerProvider<Comms>({
      capability: "sensors",
      id: "sensor-b",
      factory: () => ({ name: "b" }),
    });

    kernel.resolve({ kernelVersion: "1.0.0" });

    expect(() => kernel.query("sensors")).toThrow();
  });

  it("passes a ProviderContext with kernelVersion and query to factories", () => {
    const kernel = new Kernel();
    let capturedCtx: ProviderContext | undefined;

    kernel.registerCapability<Comms>({
      id: "comms",
      exclusive: true,
      vanilla: () => ({ name: "vanilla" }),
    });
    kernel.registerProvider<Comms>({
      capability: "comms",
      id: "real-provider",
      factory: (ctx) => {
        capturedCtx = ctx;
        return { name: "real" };
      },
    });

    kernel.resolve({ kernelVersion: "1.2.3" });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx?.kernelVersion).toBe("1.2.3");
    expect(typeof capturedCtx?.query).toBe("function");
  });

  it("lets a factory's ProviderContext.query resolve an already-active capability", () => {
    const kernel = new Kernel();
    kernel.registerCapability<Comms>({ id: "base", exclusive: true });
    kernel.registerCapability<Comms>({ id: "dependent", exclusive: true });

    kernel.registerProvider<Comms>({
      capability: "base",
      id: "base-provider",
      factory: () => ({ name: "base" }),
    });

    let seenBase: Comms | undefined;
    kernel.registerProvider<Comms>({
      capability: "dependent",
      id: "dependent-provider",
      factory: (ctx) => {
        seenBase = ctx.query<Comms>("base");
        return { name: "dependent" };
      },
    });

    kernel.resolve({ kernelVersion: "1.0.0" });

    expect(seenBase).toEqual({ name: "base" });
  });

  it("throws for an unknown capability passed to registerProvider", () => {
    const kernel = new Kernel();
    expect(() =>
      kernel.registerProvider<Comms>({
        capability: "missing",
        id: "x",
        factory: () => ({ name: "x" }),
      }),
    ).toThrow();
  });

  it("a capability descriptor requires either a vanilla fallback or at least one provider to resolve", () => {
    const kernel = new Kernel();
    kernel.registerCapability<Comms>({ id: "orphan", exclusive: true });

    kernel.resolve({ kernelVersion: "1.0.0" });

    expect(kernel.active("orphan")).toHaveLength(0);
    expect(() => kernel.query("orphan")).toThrow();
  });

  describe("exclusive-conflict resolution", () => {
    it("prefers the isDefault provider and supersedes the other, emitting a notice naming the loser", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        isDefault: true,
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "B",
        factory: () => ({ name: "B" }),
      });

      const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "A" });
      const active = kernel.active("comms");
      expect(active).toHaveLength(1);
      expect(active).toEqual([{ name: "A" }]);
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "superseded",
          detail: expect.stringContaining("B"),
        }),
      );
    });

    it("picks the unique highest-priority provider when neither is isDefault (clean supersede, not ambiguous)", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        priority: 5,
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "B",
        priority: 1,
        factory: () => ({ name: "B" }),
      });

      const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "A" });
      expect(kernel.active("comms")).toHaveLength(1);
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "superseded",
          detail: expect.stringContaining("B"),
        }),
      );
    });

    it("throws AmbiguousResolutionError when two providers tie on priority with no default", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        priority: 3,
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "B",
        priority: 3,
        factory: () => ({ name: "B" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).toThrow(
        AmbiguousResolutionError,
      );
    });

    it("throws AmbiguousResolutionError when multiple providers are isDefault", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        isDefault: true,
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "B",
        isDefault: true,
        factory: () => ({ name: "B" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).toThrow(
        AmbiguousResolutionError,
      );
    });

    it("lets a user preference beat the isDefault provider", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        isDefault: true,
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "B",
        factory: () => ({ name: "B" }),
      });

      const { notices } = kernel.resolve({
        kernelVersion: "1.0.0",
        preferences: { comms: "B" },
      });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "B" });
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "superseded",
          detail: expect.stringContaining("A"),
        }),
      );
    });

    it("ignores a stale preference naming an unregistered provider id and falls through to default", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        isDefault: true,
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "B",
        factory: () => ({ name: "B" }),
      });

      const { notices } = kernel.resolve({
        kernelVersion: "1.0.0",
        preferences: { comms: "does-not-exist" },
      });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "A" });
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "superseded",
          detail: expect.stringContaining("B"),
        }),
      );
    });

    it("never throws ambiguity for a shared (non-exclusive) capability, and activates all providers", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "sensors", exclusive: false });
      kernel.registerProvider<Comms>({
        capability: "sensors",
        id: "sensor-a",
        priority: 3,
        factory: () => ({ name: "a" }),
      });
      kernel.registerProvider<Comms>({
        capability: "sensors",
        id: "sensor-b",
        priority: 3,
        factory: () => ({ name: "b" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).not.toThrow();
      expect(kernel.active("sensors")).toHaveLength(2);
    });
  });

  describe("version gating", () => {
    it("excludes a provider whose minKernelVersion exceeds the resolve kernelVersion, with a version-excluded notice, falling back to vanilla", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({
        id: "comms",
        exclusive: true,
        vanilla: () => ({ name: "vanilla" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
        factory: () => ({ name: "A" }),
      });

      const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "vanilla" });
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "version-excluded",
          detail: expect.stringContaining("A"),
        }),
      );
    });

    it("excludes a provider whose targetModVersionRange does not contain the resolve modVersion", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({
        id: "comms",
        exclusive: true,
        vanilla: () => ({ name: "vanilla" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        versions: {
          self: "1.0.0",
          targetModVersionRange: { min: "2.0.0", max: "3.0.0" },
        },
        factory: () => ({ name: "A" }),
      });

      const { notices } = kernel.resolve({
        kernelVersion: "1.0.0",
        modVersion: "1.5.0",
      });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "vanilla" });
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "version-excluded",
          detail: expect.stringContaining("A"),
        }),
      );
    });

    it("excludes a provider with a defined targetModVersionRange when modVersion is undefined", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({
        id: "comms",
        exclusive: true,
        vanilla: () => ({ name: "vanilla" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        versions: {
          self: "1.0.0",
          targetModVersionRange: { min: "1.0.0" },
        },
        factory: () => ({ name: "A" }),
      });

      const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "vanilla" });
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "version-excluded",
        }),
      );
    });

    it("keeps a provider with no versions field always compatible", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        factory: () => ({ name: "A" }),
      });

      const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "A" });
      expect(notices.some((n) => n.kind === "version-excluded")).toBe(false);
    });

    it("falls back to the remaining compatible provider when the default is version-excluded (ambiguity computed over compatible-only)", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        isDefault: true,
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "B",
        factory: () => ({ name: "B" }),
      });

      const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "B" });
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "version-excluded",
          detail: expect.stringContaining("A"),
        }),
      );
      // Only one compatible candidate remains after the version gate, so
      // exclusive selection's superseded/ambiguity machinery never runs.
      expect(notices.some((n) => n.kind === "superseded")).toBe(false);
    });

    it("falls back to vanilla when the only registered (default) provider is version-excluded", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({
        id: "comms",
        exclusive: true,
        vanilla: () => ({ name: "vanilla" }),
      });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        isDefault: true,
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
        factory: () => ({ name: "A" }),
      });

      const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });

      expect(kernel.query<Comms>("comms")).toEqual({ name: "vanilla" });
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "version-excluded",
        }),
      );
      expect(notices).toContainEqual(
        expect.objectContaining({
          capability: "comms",
          kind: "vanilla-fallback",
        }),
      );
    });
  });

  describe("spine-critical halt", () => {
    it("throws SpineCapabilityUnsatisfiedError naming the capability when a spineCritical capability has all providers version-excluded and no vanilla", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({
        id: "life-support",
        exclusive: true,
        spineCritical: true,
      });
      kernel.registerProvider<Comms>({
        capability: "life-support",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
        factory: () => ({ name: "A" }),
      });

      let thrown: unknown;
      try {
        kernel.resolve({ kernelVersion: "1.0.0" });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(SpineCapabilityUnsatisfiedError);
      expect((thrown as Error).message).toContain("life-support");
    });

    it("resolves to vanilla (no throw) when a spineCritical capability has a vanilla fallback, even though all providers are version-excluded", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({
        id: "life-support",
        exclusive: true,
        spineCritical: true,
        vanilla: () => ({ name: "vanilla" }),
      });
      kernel.registerProvider<Comms>({
        capability: "life-support",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
        factory: () => ({ name: "A" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).not.toThrow();
      expect(kernel.query<Comms>("life-support")).toEqual({
        name: "vanilla",
      });
    });

    it("does not throw resolve for a non-spine-critical capability with all providers version-excluded and no vanilla; it simply resolves absent", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "comms", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "comms",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
        factory: () => ({ name: "A" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).not.toThrow();
      expect(kernel.active("comms")).toHaveLength(0);
      expect(() => kernel.query("comms")).toThrow();
    });
  });

  describe("dependency broker", () => {
    it("activates a declared dependency before its dependent, even when the dependent capability is registered first, so ctx.query(dep) resolves inside the factory", () => {
      const kernel = new Kernel();
      // Registration order is deliberately dependent-before-base, so a pass
      // over `this.capabilities` in registration order would call the
      // dependent's factory before "base" is active if the broker didn't
      // reorder activation.
      kernel.registerCapability<Comms>({ id: "dependent", exclusive: true });
      kernel.registerCapability<Comms>({ id: "base", exclusive: true });

      let seenBase: Comms | undefined;
      kernel.registerProvider<Comms>({
        capability: "dependent",
        id: "dependent-provider",
        deps: ["base"],
        factory: (ctx) => {
          seenBase = ctx.query<Comms>("base");
          return { name: "dependent" };
        },
      });
      kernel.registerProvider<Comms>({
        capability: "base",
        id: "base-provider",
        factory: () => ({ name: "base" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).not.toThrow();

      expect(seenBase).toEqual({ name: "base" });
      expect(kernel.query<Comms>("dependent")).toEqual({ name: "dependent" });
    });

    it("satisfies a dependency on a capability that resolves to its vanilla fallback", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "dependent", exclusive: true });
      kernel.registerCapability<Comms>({
        id: "base",
        exclusive: true,
        vanilla: () => ({ name: "base-vanilla" }),
      });

      let seenBase: Comms | undefined;
      kernel.registerProvider<Comms>({
        capability: "dependent",
        id: "dependent-provider",
        deps: ["base"],
        factory: (ctx) => {
          seenBase = ctx.query<Comms>("base");
          return { name: "dependent" };
        },
      });
      // No provider registered for "base" — it resolves to vanilla, and that
      // vanilla instance is what a dep on "base" should see.

      kernel.resolve({ kernelVersion: "1.0.0" });

      expect(seenBase).toEqual({ name: "base-vanilla" });
    });

    it("throws DependencyCycleError when two capabilities' active providers depend on each other", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "a", exclusive: true });
      kernel.registerCapability<Comms>({ id: "b", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "a",
        id: "a-provider",
        deps: ["b"],
        factory: () => ({ name: "a" }),
      });
      kernel.registerProvider<Comms>({
        capability: "b",
        id: "b-provider",
        deps: ["a"],
        factory: () => ({ name: "b" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).toThrow(
        DependencyCycleError,
      );
    });

    it("does not swallow a spine-critical halt for a capability that other providers depend on", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({
        id: "life-support",
        exclusive: true,
        spineCritical: true,
      });
      kernel.registerCapability<Comms>({ id: "dependent", exclusive: true });
      kernel.registerProvider<Comms>({
        capability: "life-support",
        id: "A",
        versions: { self: "1.0.0", minKernelVersion: "2.0.0" },
        factory: () => ({ name: "A" }),
      });
      kernel.registerProvider<Comms>({
        capability: "dependent",
        id: "dependent-provider",
        deps: ["life-support"],
        factory: (ctx) => {
          ctx.query<Comms>("life-support");
          return { name: "dependent" };
        },
      });

      let thrown: unknown;
      try {
        kernel.resolve({ kernelVersion: "1.0.0" });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(SpineCapabilityUnsatisfiedError);
    });

    it("a dependency on an absent (non-spine, no-vanilla) capability activates fine; the factory's ctx.query throws only if it's actually called", () => {
      const kernel = new Kernel();
      kernel.registerCapability<Comms>({ id: "dependent", exclusive: true });
      kernel.registerCapability<Comms>({ id: "absent", exclusive: true });
      // "absent" has no provider and no vanilla — it resolves to zero active
      // instances, but that alone shouldn't block "dependent" from
      // activating (no cycle, no spine halt).
      kernel.registerProvider<Comms>({
        capability: "dependent",
        id: "dependent-provider",
        deps: ["absent"],
        factory: () => ({ name: "dependent" }),
      });

      expect(() => kernel.resolve({ kernelVersion: "1.0.0" })).not.toThrow();
      expect(kernel.query<Comms>("dependent")).toEqual({ name: "dependent" });
      expect(kernel.active("absent")).toHaveLength(0);
    });
  });
});
