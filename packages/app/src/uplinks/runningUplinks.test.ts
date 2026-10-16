import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetUplinkOutcomes,
  runningUplinks,
  setUplinkOutcome,
  setUplinksSettled,
} from "./loaderState";

beforeEach(() => {
  __resetUplinkOutcomes();
});

describe("runningUplinks", () => {
  it("is null until a load pass has settled", () => {
    setUplinkOutcome({
      id: "alpha",
      name: "Alpha",
      version: "1.0.0",
      status: "loaded",
    });
    expect(runningUplinks()).toBeNull();
  });

  it("lists only loaded clients, by id and version, sorted by id", () => {
    setUplinkOutcome({
      id: "gamma",
      name: "Gamma",
      version: "3.0.0",
      status: "loaded",
    });
    setUplinkOutcome({
      id: "alpha",
      name: "Alpha",
      version: "1.0.0",
      status: "loaded",
    });
    setUplinkOutcome({
      id: "beta",
      name: "Beta",
      version: "2.0.0",
      status: "quarantined",
    });
    setUplinkOutcome({ id: "delta", name: "Delta", status: "loading" });
    setUplinksSettled();
    expect(runningUplinks()).toEqual([
      { id: "alpha", version: "1.0.0" },
      { id: "gamma", version: "3.0.0" },
    ]);
  });
});
