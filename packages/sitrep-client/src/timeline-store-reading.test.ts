import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function point<T = number>(
  validAt: number,
  payload: T | null,
): TimelinePoint<T> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

function store(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
}

/**
 * The fixture topic is `vessel.orbit`, which the contract declares NOTHING
 * reckonable on, and that is deliberate: these tests are about the store's
 * identity, staleness and tombstone mechanics, and a topic carrying a
 * `[SitrepReckonable]` mark answers its value-bearing `"none"` arms with a
 * `declined` that would appear in every shape assertion below without being
 * what any of them is asking about. The decline has its own describe block.
 */
describe("TimelineStore.sampleReading", () => {
  it("returns the SAME object for repeat reads within one frame", () => {
    // `useSyncExternalStore` compares snapshots by reference, so a reading
    // rebuilt on every getSnapshot call is an infinite render loop, not merely
    // a wasted allocation. This is the property that makes the union usable
    // from a hook at all.
    const s = store();
    s.ingest("vessel.orbit", point(10, 5));
    s.beginFrame();

    const first = s.sampleReading("vessel.orbit");
    const second = s.sampleReading("vessel.orbit");
    expect(second).toBe(first);
  });

  it("builds a fresh reading once the frame advances", () => {
    const s = store();
    s.ingest("vessel.orbit", point(10, 5));
    s.beginFrame();
    const first = s.sampleReading("vessel.orbit");

    s.ingest("vessel.orbit", point(11, 6));
    s.beginFrame();
    const second = s.sampleReading("vessel.orbit");

    expect(second).not.toBe(first);
    expect(second).toEqual({
      state: "observed",
      reckoning: "none",
      value: 6,
      atUt: value("ut", 11),
    });
  });

  it("agrees with the value and status reads for the same frame", () => {
    const s = store();
    s.ingest("vessel.orbit", point(10, 5));
    s.beginFrame();

    const frame = s.currentFrame();
    expect(s.sampleReading("vessel.orbit", frame)).toEqual({
      state: "observed",
      reckoning: "none",
      value: s.sample<number>("vessel.orbit", frame)?.payload,
      atUt: value("ut", 10),
    });
    expect(s.sampleStatus("vessel.orbit", frame)).toBe("live");
  });

  it("is pending for a topic that has never produced a point", () => {
    const s = store();
    s.beginFrame();
    expect(s.sampleReading("vessel.orbit")).toEqual({
      state: "pending",
      reckoning: "none",
    });
  });

  it("reports the link going down as stale, keeping the last value", () => {
    const s = store();
    s.ingest("vessel.orbit", point(10, 5));
    s.beginFrame();
    expect(s.sampleReading("vessel.orbit")).toEqual({
      state: "observed",
      reckoning: "none",
      value: 5,
      atUt: value("ut", 10),
    });

    s.setTransportConnected(false);
    s.beginFrame();
    expect(s.sampleReading("vessel.orbit")).toEqual({
      state: "stale",
      reckoning: "none",
      grade: "disconnected",
      value: 5,
      asOfUt: value("ut", 10),
    });
  });

  it("reports a tombstone as a confirmed absence, with its own age", () => {
    const s = store();
    s.ingest("vessel.orbit", point(10, null));
    s.beginFrame();
    expect(s.sampleReading("vessel.orbit")).toEqual({
      state: "absent",
      reckoning: "none",
      atUt: value("ut", 10),
    });
  });
});

/**
 * A topic the CONTRACT declares reckonable is the one place `reckoning: "none"`
 * on a value-bearing arm is not the honest default. The mark promises the wire
 * carries the model's inputs, so nothing answering is a specific refusal, and
 * the refusal names the input in the contract's own spelling.
 */
describe("TimelineStore.sampleReading, on a declared-reckonable topic", () => {
  it("names the declared input that never arrived", () => {
    // vessel.target.relativePosition is declared linear-dead-reckoning from
    // `relativeVelocity`, which this payload does not carry.
    const s = store();
    s.ingest(
      "vessel.target",
      point<Record<string, unknown>>(10, { name: "Mun Station" }),
    );
    s.beginFrame();

    expect(s.sampleReading("vessel.target")).toMatchObject({
      state: "observed",
      reckoning: "none",
      declined: { reason: "input-absent", input: "relativeVelocity" },
    });
  });

  it("spells a cross-topic input the way the contract does", () => {
    // vessel.flight.altitudeAsl declares @vessel.orbit and @system.bodies, and
    // the @ is what a widget renders: the string the operator sees and the
    // string the contract carries are the same string.
    const s = store();
    s.ingest("vessel.flight", point<Record<string, unknown>>(10, {}));
    s.beginFrame();

    expect(s.sampleReading("vessel.flight")).toMatchObject({
      declined: { reason: "input-absent", input: "@vessel.orbit" },
    });
  });

  it("says the model is missing when nothing is registered to run", () => {
    // The distinction the reason vocabulary exists for: an input that never
    // arrived is a data problem an operator can wait out, and a model nobody
    // registered is not. Reporting the second as the first would send them
    // looking for a channel that is already flowing.
    //
    // Core registers a vanilla for every marked Topic, so the registry is
    // cleared here to reach the branch at all: what it now describes is a build
    // that dropped core's reckoner module, not the normal case.
    clearReckoners();
    const s = store();
    s.ingest(
      "vessel.target",
      point<Record<string, unknown>>(10, {
        relativePosition: { x: 1 },
        relativeVelocity: { x: 1 },
      }),
    );
    s.beginFrame();

    expect(s.sampleReading("vessel.target")).toMatchObject({
      declined: { reason: "model-inapplicable" },
    });
    registerCoreReckoners();
  });

  it("leaves a topic the contract declares nothing about untouched", () => {
    const s = store();
    s.ingest("vessel.orbit", point(10, 5));
    s.beginFrame();

    expect(s.sampleReading("vessel.orbit")).not.toHaveProperty("declined");
  });

  it("rebuilds the reading when a missing input arrives", () => {
    // The decline is a function of ANOTHER topic's data, so freezing a reading
    // on its own point identity alone would hold "no orbit yet" through the
    // frame the orbit lands on.
    const s = store();
    s.ingest("vessel.flight", point<Record<string, unknown>>(10, {}));
    s.beginFrame();
    const before = s.sampleReading("vessel.flight");

    s.ingest("vessel.orbit", point<Record<string, unknown>>(10, { mu: 1 }));
    s.beginFrame();
    const after = s.sampleReading("vessel.flight");

    expect(after).not.toBe(before);
    expect(after).toMatchObject({
      declined: { reason: "input-absent", input: "@system.bodies" },
    });
  });
});
