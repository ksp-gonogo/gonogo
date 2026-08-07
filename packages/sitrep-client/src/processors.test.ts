import { beforeEach, describe, expect, it } from "vitest";
import { clearProcessors, defineProcessor, getProcessor } from "./processors";

beforeEach(() => clearProcessors());

describe("defineProcessor", () => {
  it("registers under an owner-colon-id stamped id and is retrievable by it", () => {
    const handle = defineProcessor({
      id: "fuel-level",
      owner: "example-uplink",
      deps: ["vessel.orbit"],
      compute: (values) => values[0]?.sma ?? 0,
    });

    expect(handle.id).toBe("example-uplink:fuel-level");
    expect(getProcessor(handle.id)?.id).toBe("example-uplink:fuel-level");
  });

  it("throws on a genuine id collision within the same owner, no-ops for an identical re-registration", () => {
    const def = {
      id: "dup",
      owner: "example-uplink",
      deps: [] as const,
      compute: () => 0,
    };
    defineProcessor(def);
    expect(() => defineProcessor(def)).not.toThrow();
    expect(() =>
      defineProcessor({
        id: "dup",
        owner: "example-uplink",
        deps: [] as const,
        compute: () => 1,
      }),
    ).toThrow(/already registered/);
  });

  it("accepts another ProcessorHandle as a dep (nested processors)", () => {
    const inner = defineProcessor({
      id: "inner",
      owner: "core",
      deps: [] as const,
      compute: () => 42,
    });
    const outer = defineProcessor({
      id: "outer",
      owner: "core",
      deps: [inner] as const,
      compute: (values) => values[0] + 1,
    });
    expect(getProcessor(outer.id)?.deps).toEqual([inner]);
  });
});
