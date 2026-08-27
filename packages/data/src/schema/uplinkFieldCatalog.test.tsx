import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { getTopicFieldCatalog, isThresholdSubject } from "./topicFieldCatalog";

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

  it("can be a threshold subject when they have a magnitude", () => {
    const coreTemp = getTopicFieldCatalog().find(
      (entry) => entry.key === "acme.reactor.coreTempK",
    );
    expect(coreTemp && isThresholdSubject(coreTemp)).toBe(true);
  });

  it("are still refused as a threshold subject when they have none", () => {
    const scrammed = getTopicFieldCatalog().find(
      (entry) => entry.key === "acme.reactor.scrammed",
    );
    expect(scrammed?.kind).toBe("flag");
    expect(scrammed && isThresholdSubject(scrammed)).toBe(false);
  });

  it("reach the picker the alarm and graph editors actually read", async () => {
    // `useValueKeys("data")` is the list `AlarmsModal`'s threshold subject
    // picker and `GraphView`'s axis picker are both built from, so this is the
    // read that says an operator can pick the field, rather than that the
    // catalogue happens to contain it.
    const { render } = await import("@ksp-gonogo/test-utils");
    const { useValueKeys } = await import("../hooks/useValueKeys");
    let keys: readonly { key: string }[] = [];
    function Probe() {
      keys = useValueKeys("data");
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
    expect(resolveValueTopic("data", "acme.reactor.coreTempK")).toBe(
      "acme.reactor.coreTempK",
    );
  });
});
