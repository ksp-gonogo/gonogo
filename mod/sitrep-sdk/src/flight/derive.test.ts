import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDerivedKeys, getDerivedKeys, registerDerivedKey } from "./derive";

afterEach(() => {
  clearDerivedKeys();
});

describe("registerDerivedKey / getDerivedKeys", () => {
  it("starts empty", () => {
    expect(getDerivedKeys()).toHaveLength(0);
  });

  it("registers and retrieves a key", () => {
    registerDerivedKey({
      id: "test.double",
      inputs: ["v.altitude"],
      meta: { label: "Doubled altitude", unit: "m", group: "Test" },
      fn: ([alt]) => (alt.v as number) * 2,
    });
    const keys = getDerivedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].id).toBe("test.double");
  });

  it("clearDerivedKeys empties the registry", () => {
    registerDerivedKey({
      id: "test.x",
      inputs: ["v.altitude"],
      meta: { label: "X", group: "Test" },
      fn: ([a]) => a.v,
    });
    clearDerivedKeys();
    expect(getDerivedKeys()).toHaveLength(0);
  });
});

describe("fn invocation semantics", () => {
  it("fn receives inputs in inputs-array order", () => {
    const fn = vi.fn().mockReturnValue(1);
    registerDerivedKey({
      id: "test.sum",
      inputs: ["v.altitude", "v.verticalSpeed"],
      meta: { label: "Sum", group: "Test" },
      fn,
    });

    const def = getDerivedKeys()[0];
    const altSample = { t: 1000, v: 100 };
    const vspeedSample = { t: 1000, v: 5 };
    def.fn([altSample, vspeedSample], null);
    expect(fn).toHaveBeenCalledWith([altSample, vspeedSample], null);
  });

  it("fn receives previous inputs on subsequent calls", () => {
    const fn = vi.fn().mockReturnValue(1);
    registerDerivedKey({
      id: "test.rate",
      inputs: ["v.altitude"],
      meta: { label: "Rate", group: "Test" },
      fn,
    });

    const def = getDerivedKeys()[0];
    const first = { t: 1000, v: 100 };
    const second = { t: 2000, v: 110 };

    def.fn([first], null);
    def.fn([second], [first]);

    expect(fn).toHaveBeenNthCalledWith(2, [second], [first]);
  });

  it("returning undefined from fn means skip emission", () => {
    registerDerivedKey({
      id: "test.skipFirst",
      inputs: ["v.altitude"],
      meta: { label: "Skip first", group: "Test" },
      fn: (_inputs, previous) => (previous === null ? undefined : 42),
    });

    const def = getDerivedKeys()[0];
    expect(def.fn([{ t: 1000, v: 100 }], null)).toBeUndefined();
    expect(def.fn([{ t: 2000, v: 110 }], [{ t: 1000, v: 100 }])).toBe(42);
  });
});
