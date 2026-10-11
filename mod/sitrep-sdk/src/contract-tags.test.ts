import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_CONTRACT_OWNER,
  clearRegisteredContractTags,
  reckonableRowsOf,
  registerContractTags,
  valueTagsOf,
} from "./contract-tags";
import { isReckonableTopic, reckonableValuesOf } from "./reckonability";
import { clearReckoners, registerReckoner } from "./spine/reckoners";

afterEach(() => {
  clearRegisteredContractTags();
  clearReckoners();
});

const rateRow = (topic: string, field: string) => ({
  topic,
  field,
  basis: "rate-integration",
  inputs: [{ topic: "", path: "rate" }],
});

describe("value tags are registered by the owner that publishes them", () => {
  it("holds core's own tags from the moment the module loads", () => {
    expect(valueTagsOf("vessel.propulsion")?.owner).toBe(CORE_CONTRACT_OWNER);
    expect(valueTagsOf("vessel.propulsion")?.paths.get("dryMass")).toEqual({
      kind: "discrete",
    });
    expect(
      reckonableRowsOf("vessel.flight").every(
        (row) => row.owner === CORE_CONTRACT_OWNER,
      ),
    ).toBe(true);
  });

  it("sees an owner's tags once they are registered", () => {
    registerContractTags("acme", {
      topics: { "acme.tank": { level: { kind: "continuous" } } },
    });
    expect(valueTagsOf("acme.tank")).toEqual({
      owner: "acme",
      paths: new Map([["level", { kind: "continuous" }]]),
    });
  });

  it("refuses a second owner describing the same Topic, naming both", () => {
    registerContractTags("acme", {
      topics: { "acme.tank": { level: { kind: "continuous" } } },
    });
    expect(() =>
      registerContractTags("rival", {
        topics: { "acme.tank": { level: { kind: "discrete" } } },
      }),
    ).toThrow(/acme\.tank.*"acme"/s);
    expect(() =>
      registerContractTags("rival", {
        topics: { "acme.tank": { level: { kind: "discrete" } } },
      }),
    ).toThrow(/registerContractTags\("rival"\)/);
  });

  it("replaces an owner's own tags when it registers again", () => {
    registerContractTags("acme", {
      topics: { "acme.tank": { level: { kind: "continuous" } } },
      reckonable: [rateRow("acme.tank", "level")],
    });
    registerContractTags("acme", { reckonable: [] });
    expect(valueTagsOf("acme.tank")).toBeUndefined();
    expect(reckonableRowsOf("acme.tank")).toEqual([]);
  });

  it("refuses a model outside the closed vocabulary", () => {
    expect(() =>
      registerContractTags("acme", {
        reckonable: [{ ...rateRow("acme.tank", "level"), basis: "vibes" }],
      }),
    ).toThrow(/vibes/);
  });
});

describe("a model may be declared on another owner's Topic", () => {
  it("keeps each owner's rows apart, so a decline can be explained from one", () => {
    registerContractTags("acme", {
      reckonable: [rateRow("vessel.flight", "altitudeAsl")],
    });
    expect(isReckonableTopic("vessel.flight")).toBe(true);
    expect(
      reckonableValuesOf("vessel.flight", "acme").map((row) => row.basis),
    ).toEqual(["rate-integration"]);
    expect(
      reckonableValuesOf("vessel.flight", CORE_CONTRACT_OWNER).some(
        (row) => row.basis === "kepler-propagation",
      ),
    ).toBe(true);
  });
});

describe("a model is refused on a value its owner never marked", () => {
  it("throws at registration, naming the Topic, the owner and the mark to add", () => {
    expect(() =>
      registerReckoner("vessel.resources", "acme", {
        deps: [],
        reckon: () => ({ declined: { reason: "model-inapplicable" } }),
      }),
    ).toThrow(/vessel\.resources.*"acme".*SitrepReckonableOn/s);
  });

  it("does not let core's mark stand in for another owner's", () => {
    expect(() =>
      registerReckoner("vessel.flight", "acme", {
        deps: [],
        reckon: () => ({ declined: { reason: "model-inapplicable" } }),
      }),
    ).toThrow(/"acme" declares no value of vessel\.flight/);
  });

  it("accepts the model once the owner's contract marks the value", () => {
    registerContractTags("acme", {
      reckonable: [rateRow("vessel.flight", "altitudeAsl")],
    });
    expect(() =>
      registerReckoner("vessel.flight", "acme", {
        deps: [],
        reckon: () => ({ declined: { reason: "model-inapplicable" } }),
      }),
    ).not.toThrow();
  });
});

describe("a model on an Event channel", () => {
  it("is refused at registration, since nothing lies between two occurrences", () => {
    registerContractTags("acme", {
      reckonable: [rateRow("crash.lastCrash", "ut")],
    });
    expect(() =>
      registerReckoner("crash.lastCrash", "acme", {
        deps: [],
        reckon: () => ({ declined: { reason: "model-inapplicable" } }),
      }),
    ).toThrow(/crash\.lastCrash is an Event channel/);
  });
});
