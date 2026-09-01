import { describe, expect, it } from "vitest";
import {
  getTopicFieldCatalog,
  getUndescribedCarriedTopics,
  humaniseFieldPath,
} from "./topicFieldCatalog";

describe("getTopicFieldCatalog()", () => {
  it("offers a key for every field of a carried Topic", () => {
    const keys = new Set(getTopicFieldCatalog().map((k) => k.key));
    expect(keys.has("career.status.economy.funds")).toBe(true);
    expect(keys.has("vessel.orbit.sma")).toBe(true);
  });

  it("includes the client-derived channels, which no generated map describes", () => {
    const keys = new Set(getTopicFieldCatalog().map((k) => k.key));
    expect(keys.has("vessel.state.altitudeAsl")).toBe(true);
    expect(keys.has("vessel.state.twr")).toBe(true);
    // The single largest block of the vocabulary. A regression that stopped
    // registering the declaration would leave the catalogue looking merely
    // shorter rather than broken, so the count is asserted rather than a
    // sample of it.
    const vesselState = getTopicFieldCatalog().filter(
      (k) => k.topic === "vessel.state",
    );
    expect(vesselState.length).toBeGreaterThan(50);
  });

  it("keys every entry by the path a read actually samples", () => {
    const funds = getTopicFieldCatalog().find(
      (k) => k.key === "career.status.economy.funds",
    );
    expect(funds).toMatchObject({
      topic: "career.status",
      fieldPath: "economy.funds",
      unit: "funds",
      kind: "quantity",
      group: "career.status",
    });
  });

  it("never offers a path under a collection, which no sample can reach", () => {
    const dead = getTopicFieldCatalog().filter(
      (k) =>
        k.key.startsWith("career.status.contracts.active.") ||
        k.key.startsWith("career.status.facilities."),
    );
    expect(dead).toEqual([]);
  });

  it("names the collections themselves, so the field is not simply missing", () => {
    const contracts = getTopicFieldCatalog().find(
      (k) => k.key === "career.status.contracts.active",
    );
    expect(contracts?.kind).toBe("collection");
    expect(contracts?.unit).toBeUndefined();
  });

  it("hangs no field path off a Topic with more than two segments", () => {
    // A raw field subtopic splits after the second segment, so a deeper Topic
    // would resolve, and subscribe, against a parent no channel publishes.
    const derived = new Set(["vessel.state", "spaceCenter.state"]);
    const offenders = getTopicFieldCatalog().filter(
      (k) => !derived.has(k.topic) && k.topic.split(".").length !== 2,
    );
    expect(offenders.map((k) => k.key)).toEqual([]);
  });

  it("carries a unit on every quantity, so a reading can be rendered", () => {
    const bare = getTopicFieldCatalog().filter(
      (k) => k.kind === "quantity" && k.unit === undefined,
    );
    expect(bare.map((k) => k.key)).toEqual([]);
  });

  it("is far larger than the hand-written catalogue it replaces", () => {
    // The retired table listed 145 live keys; this enumerates 558. A floor on
    // the VOCABULARY, so a walk that quietly stopped resolving fails here
    // rather than reporting a shorter list. Never lower this to make it pass:
    // teach the walk instead.
    expect(getTopicFieldCatalog().length).toBeGreaterThan(500);
  });
});

describe("getUndescribedCarriedTopics()", () => {
  it("names exactly the carried Topics nothing has annotated", () => {
    // Pinned rather than counted. A Topic that arrives with no unit metadata
    // would otherwise be absent from every picker in the app with nothing to
    // show it had been dropped, which is the failure this whole rebuild exists
    // to remove. Adding an entry here is a decision; it should never be a
    // silent one.
    //
    // The Uplink Topics are here because their client packages register their
    // units at module load and this package does not import them. They are
    // described once an app that loads the Uplink builds the catalogue.
    expect([...getUndescribedCarriedTopics()].sort()).toEqual(
      [
        // The three dv.* channels key their fields by RESOURCE NAME, so there is
        // no fixed field set for a declaration to enumerate.
        "dv.currentStageResource",
        "dv.currentStageResourceMax",
        "dv.legacyScalars",
        // Bare primitive channels: the Topic IS the value, so it has no fields.
        "crash.hasRecent",
        "recovery.hasRecent",
        "kos.processors",
        // Uplink Topics. Their client packages register units at module load and
        // this package does not import them, so they are described once an app
        // that loads the Uplink builds the catalogue.
        "kerbcast.available",
        "kerbcast.cameras",
        "scansat.available",
        "scansat.scanningVessels",
        // Three segments already, so a field path under one would be split
        // against a two-segment parent no channel publishes.
        "system.uplink.gates",
        "system.uplink.pending",
        // A row per declared channel, keyed by TOPIC NAME, so there is no fixed
        // field set for a declaration to enumerate. Same shape as the `dv.*`
        // entries above rather than the awaiting-a-declaration ones below: this
        // one cannot have a field declaration, it is not missing one.
        "system.channels",
        // Derived channels still awaiting a field declaration of their own, the
        // way `vessel.state` and `spaceCenter.state` have one.
        "system.state",
        "system.uplinkHealth",
        "system.uplinks",
      ].sort(),
    );
  });

  it("does not overlap the catalogue it excludes from", () => {
    const described = new Set(getTopicFieldCatalog().map((k) => k.topic));
    for (const topic of getUndescribedCarriedTopics()) {
      expect(described.has(topic)).toBe(false);
    }
  });
});

describe("humaniseFieldPath", () => {
  it("splits a camelCase field into words", () => {
    expect(humaniseFieldPath("landingTimeToImpact")).toBe(
      "Landing time to impact",
    );
    expect(humaniseFieldPath("sma")).toBe("Sma");
  });

  it("keeps a short form readable rather than sentence-casing it", () => {
    expect(humaniseFieldPath("twr")).toBe("TWR");
    expect(humaniseFieldPath("altitudeAsl")).toBe("Altitude ASL");
    expect(humaniseFieldPath("encounterUt")).toBe("Encounter UT");
    expect(humaniseFieldPath("landingPredictedLat")).toBe(
      "Landing predicted latitude",
    );
  });

  it("reads a nested path as one phrase", () => {
    expect(humaniseFieldPath("economy.funds")).toBe("Economy funds");
    expect(humaniseFieldPath("position.x")).toBe("Position x");
  });
});

describe("every catalogue key is readable", () => {
  it("resolves every offered key to a Topic something can sample", async () => {
    // The invariant the whole rebuild rests on: a picker must never offer a key
    // whose read returns nothing, because that failure is invisible. Asserted
    // against the real resolution rather than trusting the walk that built it.
    // This caught sixteen vector-component keys whose unit lives on a dotted
    // leaf, which the path judgement could not match while the read could.
    const { resolveValueTopic } = await import("@ksp-gonogo/sitrep-client");
    const unresolvable = getTopicFieldCatalog().filter(
      (entry) => resolveValueTopic("data", entry.key) === undefined,
    );
    expect(unresolvable.map((entry) => entry.key)).toEqual([]);
  });
});

describe("one name per value", () => {
  it("offers the canonical kinematic name and not its wire twin", async () => {
    const { redirectKinematicSubtopic } = await import(
      "@ksp-gonogo/sitrep-client"
    );
    const keys = new Set(getTopicFieldCatalog().map((entry) => entry.key));
    expect(keys.has("vessel.state.altitudeAsl")).toBe(true);
    // Real on the wire, and redirected on read. Offering both would put two
    // names for one altitude in front of the operator.
    expect(keys.has("vessel.flight.altitudeAsl")).toBe(false);
    expect(keys.has("vessel.flight.orbitalSpeed")).toBe(false);

    const redirected = getTopicFieldCatalog().filter(
      (entry) => redirectKinematicSubtopic(entry.key) !== entry.key,
    );
    expect(redirected.map((entry) => entry.key)).toEqual([]);
  });

  it("leaves a non-kinematic field of the same Topic alone", () => {
    // Nothing derives a twin for these, so there is no duplication to collapse
    // and dropping them would lose real vocabulary.
    const keys = new Set(getTopicFieldCatalog().map((entry) => entry.key));
    expect(keys.has("vessel.flight.mach")).toBe(true);
  });
});

describe("a derived channel is offered only when its inputs are carried", () => {
  it("offers vessel.state, whose inputs are promoted", () => {
    const topics = new Set(getTopicFieldCatalog().map((entry) => entry.topic));
    expect(topics.has("vessel.state")).toBe(true);
  });

  it("would exclude it if they were not", async () => {
    // The gate itself, exercised rather than assumed. A derived channel's NAME
    // never appears in the carried list, only the raw Topics it computes from,
    // so a channel can be registered and enumerate a full field set while
    // resolving to nothing forever. Offering those fields would put keys in
    // front of an operator that can never carry a value.
    //
    // This is what the retired mapped-AND-carried gate caught. That gate read
    // the migration table so it retired with it; two real instances had shipped
    // before it existed.
    const {
      isTopicCarried,
      PRODUCTION_DERIVED_CHANNELS,
      TimelineStore,
      ViewClock,
    } = await import("@ksp-gonogo/sitrep-client");
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    for (const channel of PRODUCTION_DERIVED_CHANNELS) {
      store.registerDerivedChannel(channel);
    }
    expect(isTopicCarried(store, new Set<string>(), "vessel.state")).toBe(
      false,
    );
  });
});
