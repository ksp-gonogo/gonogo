import { afterEach, describe, expect, it } from "vitest";
import {
  __resetUplinkOutcomes,
  getUplinkOutcomes,
  recordBundledOutcomes,
} from "./loaderState";

afterEach(() => {
  __resetUplinkOutcomes();
});

describe("recordBundledOutcomes", () => {
  it("records a loaded outcome for every given id", () => {
    recordBundledOutcomes(["scansat", "kos", "kerbcast"]);
    const outcomes = getUplinkOutcomes();
    expect(outcomes).toHaveLength(3);
    for (const id of ["scansat", "kos", "kerbcast"]) {
      const outcome = outcomes.find((o) => o.id === id);
      expect(outcome).toBeDefined();
      expect(outcome?.status).toBe("loaded");
      expect(outcome?.reason).toBe("bundled");
    }
  });

  it("does nothing for an empty id list", () => {
    recordBundledOutcomes([]);
    expect(getUplinkOutcomes()).toHaveLength(0);
  });
});
