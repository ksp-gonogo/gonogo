import {
  registerBarePrimitiveTopic,
  registerCollectionTopic,
  registerTopicUnits,
  registerTypeUnits,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  getCollectionTopics,
  getTopicFieldCatalog,
  getUndescribedTopics,
  isNumericField,
} from "./topicFieldCatalog";

/**
 * A third-party Uplink this repo has never heard of, registering exactly what
 * an Uplink client package registers at module load: its Topic ids, its own
 * generated unit map, and the type map a nested payload resolves through.
 *
 * Deliberately not one of the bundled Uplinks. A first-party Topic can always
 * be hand-listed somewhere in this repo, so testing with one would prove only
 * that the list was maintained.
 */
const REACTOR = "acme.reactor";

registerBarePrimitiveTopic(REACTOR);
registerTopicUnits(
  REACTOR,
  { coreTempK: "K", scrammed: "flag" },
  { limits: "AcmeReactorLimits" },
);
registerTypeUnits("AcmeReactorLimits", { maxTempK: "K" });

/**
 * The same Uplink's collection Topic: a bare array of rods, whose unit map
 * describes one rod. Registered exactly as the reactor is, plus the collection
 * mark, so the reactor is its control.
 */
const RODS = "acme.rods";

registerBarePrimitiveTopic(RODS);
registerTopicUnits(RODS, { insertion: "ratio", rodTempK: "K" });
registerCollectionTopic(RODS);

describe("an Uplink's own fields", () => {
  it("are offered by the picker every graph and alarm reads from", () => {
    const keys = new Set(getTopicFieldCatalog().map((entry) => entry.key));
    expect(keys.has("acme.reactor.coreTempK")).toBe(true);
    expect(keys.has("acme.reactor.limits.maxTempK")).toBe(true);
  });

  it("carry the label and unit a picker renders", () => {
    const coreTemp = getTopicFieldCatalog().find(
      (entry) => entry.key === "acme.reactor.coreTempK",
    );
    expect(coreTemp).toMatchObject({
      topic: REACTOR,
      fieldPath: "coreTempK",
      unit: "K",
      kind: "quantity",
      group: REACTOR,
    });
  });

  it("are offered as a number when they have a magnitude", () => {
    const coreTemp = getTopicFieldCatalog().find(
      (entry) => entry.key === "acme.reactor.coreTempK",
    );
    expect(coreTemp && isNumericField(coreTemp)).toBe(true);
  });

  it("are not offered as a number when they have none", () => {
    const scrammed = getTopicFieldCatalog().find(
      (entry) => entry.key === "acme.reactor.scrammed",
    );
    expect(scrammed?.kind).toBe("flag");
    expect(scrammed && isNumericField(scrammed)).toBe(false);
  });

  it("reach the picker the alarm and graph editors actually read", async () => {
    // `useNumericFields` is the list the alarm, trigger and graph pickers are
    // built from, so this is the read that says an operator can pick the field,
    // rather than that the catalogue happens to contain it.
    const { render } = await import("@ksp-gonogo/test-utils");
    const { useNumericFields } = await import("../hooks/useTopicFields");
    let keys: readonly { key: string }[] = [];
    function Probe() {
      keys = useNumericFields();
      return null;
    }
    render(<Probe />);
    expect(keys.map((entry) => entry.key)).toContain("acme.reactor.coreTempK");
    expect(keys.map((entry) => entry.key)).not.toContain(
      "acme.reactor.scrammed",
    );
  });

  it("resolve to a Topic a read can sample", async () => {
    // The read half, which the picker half is worthless without.
    const { resolveValueTopic } = await import("@ksp-gonogo/sitrep-client");
    expect(resolveValueTopic("acme.reactor.coreTempK")).toBe(
      "acme.reactor.coreTempK",
    );
  });
});

describe("an Uplink's collection Topic", () => {
  it("offers no field of an element, and says it left the Topic out", () => {
    expect(
      getTopicFieldCatalog().filter((entry) => entry.topic === RODS),
    ).toEqual([]);
    expect(getCollectionTopics()).toContain(RODS);
    expect(getUndescribedTopics()).not.toContain(RODS);
  });

  it("keeps an element field out of the picker the editors read", async () => {
    const { render } = await import("@ksp-gonogo/test-utils");
    const { useNumericFields } = await import("../hooks/useTopicFields");
    let keys: readonly { key: string }[] = [];
    function Probe() {
      keys = useNumericFields();
      return null;
    }
    render(<Probe />);
    const offered = keys.map((entry) => entry.key);
    expect(offered).not.toContain("acme.rods.rodTempK");
    // The control: the record Topic registered beside it is still offered.
    expect(offered).toContain("acme.reactor.coreTempK");
  });

  it("leaves the record Topic's own report alone", () => {
    expect(getCollectionTopics()).not.toContain(REACTOR);
  });
});
