import { describe, expect, it } from "vitest";
import { DEFAULT_SITREP_CARRIED_TOPICS } from "./default-carried-topics";
import { isKnownFieldPath } from "./spine/map-topic";
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
    const facilities = enumerateTopicFields("career.status").filter((f) =>
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
