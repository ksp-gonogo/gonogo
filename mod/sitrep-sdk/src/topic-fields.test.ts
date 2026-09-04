import { describe, expect, it } from "vitest";
import { DEFAULT_SITREP_CARRIED_TOPICS } from "./default-carried-topics";
import { isKnownFieldPath } from "./spine/map-topic";
// Imported for the module-load side effect as much as for the value: this is
// what registers `vessel.state`'s hand-declared field metadata, and the
// enumeration below can only see it once that module has run.
import { vesselStateChannel } from "./spine/vessel-state";
import { enumerateTopicFields } from "./topic-fields";

describe("enumerateTopicFields", () => {
  it("walks a nested singular shape down to its leaves", () => {
    const paths = enumerateTopicFields("career.status").map((f) => f.path);
    expect(paths).toContain("economy.funds");
    expect(paths).toContain("economy.science");
  });

  it("carries the declared unit and the kind it implies", () => {
    const funds = enumerateTopicFields("career.status").find(
      (f) => f.path === "economy.funds",
    );
    expect(funds).toEqual({
      path: "economy.funds",
      unit: "funds",
      kind: "quantity",
    });
  });

  it("classifies a non-quantity token by what a reader gets, not by its name", () => {
    const byPath = new Map(
      enumerateTopicFields("vessel.identity").map((f) => [f.path, f]),
    );
    expect(byPath.get("name")?.kind).toBe("text");
    expect(byPath.get("situation")?.kind).toBe("enum");
    expect(byPath.get("launchUt")?.kind).toBe("quantity");
    // An id is a string a reader gets back, so it classifies as text: the
    // separate token only records that the string names something.
    expect(byPath.get("vesselId")?.kind).toBe("text");
  });

  it("reaches a Vec3 leaf, which carries the unit of the field holding it", () => {
    const byPath = new Map(
      enumerateTopicFields("vessel.orbit.truth").map((f) => [f.path, f]),
    );
    expect(byPath.get("position.x")).toEqual({
      path: "position.x",
      unit: "m",
      kind: "quantity",
    });
    expect(byPath.get("frameRotating")?.kind).toBe("flag");
  });

  it("descends a singular nested shape but stops at a plural sibling", () => {
    const paths = enumerateTopicFields("vessel.orbit").map((f) => f.path);
    // `arc` is one TrajectoryArc, so its own fields are reachable.
    expect(paths.some((p) => p.startsWith("arc."))).toBe(true);
    // `patches` is `OrbitPatch[]`, so the collection itself is the deepest
    // thing a sample of `vessel.orbit` can reach.
    expect(paths).toContain("patches");
    expect(paths.some((p) => p.startsWith("patches."))).toBe(false);
  });

  it("stops at a dictionary rather than guessing the key that follows", () => {
    // The dictionary moved to its own channel when the facility ladder gained a
    // staleness of its own; the rule it demonstrates did not move with it.
    const facilities = enumerateTopicFields("career.facilities").filter((f) =>
      f.path.startsWith("facilities"),
    );
    expect(facilities).toEqual([{ path: "facilities", kind: "collection" }]);
  });

  it("stops at a LIST too: an element field is not a readable path", () => {
    // `career.status.contracts.active` is `CareerContract[]`. Sampling the
    // topic yields the array, so `contracts.active.agent` reads a field off an
    // array and resolves to nothing. Offering it in a picker is a dead pick.
    const contracts = enumerateTopicFields("career.status").filter((f) =>
      f.path.startsWith("contracts."),
    );
    expect(contracts).toEqual([
      { path: "contracts.active", kind: "collection" },
      { path: "contracts.completedRecent", kind: "collection" },
      { path: "contracts.offered", kind: "collection" },
    ]);
  });

  it("returns nothing for a topic no metadata describes", () => {
    expect(enumerateTopicFields("no.such.topic")).toEqual([]);
  });

  it("enumerates a field for the great majority of carried topics", () => {
    // A floor on the VOCABULARY, not on a legacy key count: it reads the
    // number of carried topics the walk can say anything about at all. A walk
    // that silently stopped resolving would drop this to nothing.
    const described = DEFAULT_SITREP_CARRIED_TOPICS.filter(
      (t) => enumerateTopicFields(t).length > 0,
    );
    expect(described.length).toBeGreaterThan(
      DEFAULT_SITREP_CARRIED_TOPICS.length * 0.7,
    );
  });
});

describe("isKnownFieldPath plurality", () => {
  it("accepts a scalar leaf under a singular nested shape", () => {
    expect(isKnownFieldPath("career.status.economy.funds")).toBe(true);
  });

  it("refuses a field read off a LIST", () => {
    // The shape map records a list as its ELEMENT type, which is right for the
    // payload wrap (it maps over the elements) and wrong for a path judgement:
    // the path names a field of an element, and nothing can sample it.
    expect(isKnownFieldPath("career.status.contracts.active.agent")).toBe(
      false,
    );
  });

  it("refuses a field read off a dictionary", () => {
    expect(isKnownFieldPath("career.status.facilities.level")).toBe(false);
  });
});

describe("enumerateTopicFields on a client-derived channel", () => {
  it("describes vessel.state, which no generated map knows about", () => {
    const fields = enumerateTopicFields(vesselStateChannel.topic);
    const byPath = new Map(fields.map((f) => [f.path, f]));
    // The channel is computed client-side, so this can only work through the
    // hand declaration in `vessel-state.ts`. An empty result here means that
    // declaration stopped being registered, which would silently empty the
    // largest part of the picker's vocabulary.
    expect(fields.length).toBeGreaterThan(50);
    expect(byPath.get("altitudeAsl")).toEqual({
      path: "altitudeAsl",
      unit: "m",
      kind: "quantity",
    });
    expect(byPath.get("twr")?.kind).toBe("quantity");
    expect(byPath.get("isEVA")?.kind).toBe("flag");
    expect(byPath.get("situationName")?.kind).toBe("text");
    // A UT instant, not an interval: the unit distinguishes them.
    expect(byPath.get("encounterUt")?.unit).toBe("ut");
    // The vector's unit is on its components, which are what a reader indexes.
    expect(byPath.get("position.x")?.unit).toBe("m");
    expect(byPath.get("position")).toBeUndefined();
    // A collection is named but not descended into.
    expect(byPath.get("actionGroupsNamed")?.kind).toBe("collection");
  });

  it("offers every quantity on vessel.state as a threshold subject", () => {
    const quantities = enumerateTopicFields(vesselStateChannel.topic).filter(
      (f) => f.kind === "quantity",
    );
    expect(quantities.length).toBeGreaterThan(30);
  });
});

describe("isKnownFieldPath on a registered topic", () => {
  it("accepts a derived channel's field that no legacy table ever named", () => {
    // `vessel.state.basis` has no entry in the retiring migration table, so the
    // only thing that can vouch for it is the field metadata the channel
    // registers for itself. A judgement that read the generated maps directly
    // would be blind to that, and to every Uplink-registered Topic with it.
    void vesselStateChannel;
    expect(isKnownFieldPath("vessel.state.basis")).toBe(true);
    expect(isKnownFieldPath("vessel.state.subjectId")).toBe(true);
  });

  it("still refuses a field the channel does not declare", () => {
    void vesselStateChannel;
    expect(isKnownFieldPath("vessel.state.notAField")).toBe(false);
  });
});

describe("isKnownFieldPath on a vector component", () => {
  it("accepts a component of a vector field", () => {
    // A vector's unit sits on DOTTED leaf keys in the unit map
    // (`"relativePosition.x": "m"`) rather than on a nested shape, because the
    // shared vector type carries no unit of its own. A walk that only ever
    // consumed one segment at a time could never match one, while the read
    // resolves it perfectly well by walking into the payload.
    expect(isKnownFieldPath("vessel.target.relativePosition.x")).toBe(true);
    expect(isKnownFieldPath("vessel.dock.relativeVelocity.z")).toBe(true);
  });

  it("accepts a vector component on a derived channel too", () => {
    void vesselStateChannel;
    expect(isKnownFieldPath("vessel.state.position.y")).toBe(true);
  });

  it("refuses a component the vector does not have", () => {
    expect(isKnownFieldPath("vessel.target.relativePosition.w")).toBe(false);
  });
});
