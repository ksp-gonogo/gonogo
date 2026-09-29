import { COMMAND_IDS, splitRawFieldSubtopic } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  getTopicFieldCatalog,
  getUndescribedTopics,
  humaniseFieldPath,
} from "./topicFieldCatalog";

describe("getTopicFieldCatalog()", () => {
  it("offers a key for every field of a contract Topic", () => {
    const keys = new Set(getTopicFieldCatalog().map((k) => k.key));
    expect(keys.has("career.status.balances.funds")).toBe(true);
    expect(keys.has("vessel.orbit.sma")).toBe(true);
  });

  it("includes the client-derived channels, which no generated map describes", () => {
    /* The whole of the declaration rather than a sample of it: a regression
       that dropped one field would leave the catalogue looking merely shorter
       rather than broken. */
    const spaceCenter = getTopicFieldCatalog()
      .filter((k) => k.topic === "spaceCenter.state")
      .map((k) => k.key)
      .sort();
    expect(spaceCenter).toEqual([
      "spaceCenter.state.padOccupied",
      "spaceCenter.state.padVesselTitle",
    ]);
  });

  it("keys every entry by the path a read actually samples", () => {
    const funds = getTopicFieldCatalog().find(
      (k) => k.key === "career.status.balances.funds",
    );
    expect(funds).toMatchObject({
      topic: "career.status",
      fieldPath: "balances.funds",
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

  it("offers no key whose read would land on a different Topic", () => {
    // A raw field subtopic splits at the longest KNOWN Topic id the key starts
    // with, so depth alone says nothing: what matters is that the split gives
    // back the Topic the entry was built from. An entry that failed this would
    // subscribe and sample somewhere else, and show the operator nothing.
    const derived = new Set(["spaceCenter.state"]);
    const offenders = getTopicFieldCatalog().filter(
      (k) =>
        !derived.has(k.topic) &&
        splitRawFieldSubtopic(k.key)?.rawTopic !== k.topic,
    );
    expect(offenders.map((k) => k.key)).toEqual([]);
  });

  it("offers the fields of a three-segment Topic, which is a Topic like any other", () => {
    // `alarm.scet.fired` is the case that paid for the longest-match split: the
    // contract annotates every one of its fields, and while the split landed
    // after the second segment every key under it resolved to a `fired.*` path
    // into `alarm.scet`, which is an ARRAY and has no such field. So the picker
    // could not offer an annotated instant that the wire genuinely carries.
    const fired = getTopicFieldCatalog().filter(
      (k) => k.topic === "alarm.scet.fired",
    );
    expect(fired.map((k) => k.key).sort()).toEqual([
      "alarm.scet.fired.actionsWithheld",
      "alarm.scet.fired.firedAtUt",
      "alarm.scet.fired.id",
      "alarm.scet.fired.vantage",
    ]);
    expect(
      fired.find((k) => k.key === "alarm.scet.fired.firedAtUt"),
    ).toMatchObject({ fieldPath: "firedAtUt", unit: "ut" });
  });

  it("carries a unit on every quantity, so a reading can be rendered", () => {
    const bare = getTopicFieldCatalog().filter(
      (k) => k.kind === "quantity" && k.unit === undefined,
    );
    expect(bare.map((k) => k.key)).toEqual([]);
  });

  it("is far larger than the hand-written catalogue it replaces", () => {
    // The retired table listed 145 live keys; this enumerates 392, counting
    // only keys a read can fill, so nothing under a collection Topic. A floor
    // on the VOCABULARY, so a walk that quietly stopped resolving fails here
    // rather than reporting a shorter list. Never lower this to make it pass:
    // teach the walk instead.
    expect(getTopicFieldCatalog().length).toBeGreaterThan(380);
  });
});

describe("getUndescribedTopics()", () => {
  it("names exactly the Topics nothing has annotated", () => {
    // Pinned rather than counted. A Topic that arrives with no unit metadata
    // would otherwise be absent from every picker in the app with nothing to
    // show it had been dropped, which is the failure this whole rebuild exists
    // to remove. Adding an entry here is a decision; it should never be a
    // silent one.
    expect([...getUndescribedTopics()].sort()).toEqual(
      [
        // Both dv.* channels key their fields by RESOURCE NAME, so there is no fixed field set for a declaration to enumerate.
        "dv.currentStageResource",
        "dv.currentStageResourceMax",
        // Bare primitive channels: the Topic IS the value, so it has no fields.
        "crash.hasRecent",
        "recovery.hasRecent",
        // A string carrying a JSON document: the Topic IS the value, so it has no fields.
        "system.units",
        // A binary-lane topic: raw Opus frames, not a JSON payload with fields to describe.
        "commcast.radio",
        // Nothing annotates this one's fields. Its three segments are no
        // longer the reason: the split resolves a Topic of any depth now, and
        // its sibling `system.uplink.pending` is described.
        "system.uplink.gates",
        // A row per declared channel, keyed by TOPIC NAME, so there is no fixed
        // field set for a declaration to enumerate. Same shape as the `dv.*`
        // entries above rather than the awaiting-a-declaration ones below: this
        // one cannot have a field declaration, it is not missing one.
        "system.channels",
        // Derived channels still awaiting a field declaration of their own, the way `spaceCenter.state` has one.
        "system.state",
        "system.uplinkHealth",
        "system.uplinks",
      ].sort(),
    );
  });

  it("says nothing about a command, which is a control and not a reading", () => {
    /* An Uplink can register an id that is also a command, which puts it in
       front of this walk. A command has no payload to enumerate and no
       declaration could give it one, so calling it undescribed would report a
       permanent gap that is not a gap. */
    const planted = ["alarm.scet.arm", "time.setWarpIndex"];
    const undescribed = new Set(getUndescribedTopics(planted));
    const catalogued = new Set(
      getTopicFieldCatalog(planted).map((k) => k.topic),
    );
    // The plant has to still BE a command, or this asserts over nothing.
    expect(COMMAND_IDS).toEqual(expect.arrayContaining(planted));
    for (const id of planted) {
      expect(undescribed.has(id)).toBe(false);
      expect(catalogued.has(id)).toBe(false);
    }
  });

  it("does not overlap the catalogue it excludes from", () => {
    const described = new Set(getTopicFieldCatalog().map((k) => k.topic));
    for (const topic of getUndescribedTopics()) {
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
    expect(humaniseFieldPath("balances.funds")).toBe("Balances funds");
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
      (entry) => resolveValueTopic(entry.key) === undefined,
    );
    expect(unresolvable.map((entry) => entry.key)).toEqual([]);
  });
});

describe("a derived channel is offered like any other Topic", () => {
  it("offers spaceCenter.state", () => {
    const topics = new Set(getTopicFieldCatalog().map((entry) => entry.topic));
    expect(topics.has("spaceCenter.state")).toBe(true);
  });
});
