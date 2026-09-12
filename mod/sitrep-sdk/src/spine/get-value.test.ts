import { afterEach, describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import {
  getValue,
  PRODUCTION_DERIVED_CHANNELS,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
} from "./context";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * The stream as production assembles it: a `StubTransport` whose `emit` runs
 * the same `wrapTopicPayload` the real decode does, so a quantity field reaches
 * the store as a `Value` rather than as the bare number a hand-built fixture
 * would carry.
 *
 * `publish` takes a WHOLE Topic record, which is the only shape the wire has.
 * A field is then read back off it by its dotted path, through the store's raw
 * field-subtopic walk, exactly as an operator-picked `dataKey` is.
 */
function streamHarness(): (topic: string, payload: unknown) => void {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    store.registerDerivedChannel(channel);
  }
  client.attachStore(store);
  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);
  setActiveViewClockForTests({ viewUt: () => 1000 });

  const subscribed = new Set<string>();
  return (topic, payload) => {
    if (!subscribed.has(topic)) {
      subscribed.add(topic);
      client.subscribe(topic, () => {});
    }
    transport.emit(topic, payload);
    store.beginFrame();
  };
}

afterEach(() => {
  setActiveViewClockForTests(undefined);
  setActiveTimelineStoreForTests(undefined);
  setActiveTelemetryClientForTests(undefined);
});

describe("getValue over a field of a published parent Topic", () => {
  it("reads a unit-carrying field as its magnitude", () => {
    const publish = streamHarness();
    publish("vessel.flight", { altitudeAsl: 5000, verticalSpeed: -12.5 });

    expect(getValue("data", "vessel.flight.verticalSpeed")).toBe(-12.5);
  });

  /**
   * A nested record's field, where the unit is declared on the nested shape
   * rather than on the Topic. `career.status.economy.funds` is the case an
   * operator meets first: it is a career threshold, and the whole `economy`
   * record arrives under one Topic.
   */
  it("reads a unit-carrying field of a nested record", () => {
    const publish = streamHarness();
    publish("career.status", { economy: { funds: 12345, science: 40 } });

    expect(getValue("data", "career.status.economy.funds")).toBe(12345);
  });

  /**
   * The other half of the same picker: a raw field the contract declares
   * without a unit, so nothing wraps it and it arrives as the bare number it
   * always was. Pinned beside the two above so a fix for them cannot be one
   * that only answers for a `Value`.
   */
  it("still reads a field the contract declares no unit for", () => {
    const publish = streamHarness();
    publish("alarm.scet", { condition: { threshold: 7 } });

    expect(getValue("data", "alarm.scet.condition.threshold")).toBe(7);
  });

  it("answers undefined for a field that carries no number at all", () => {
    const publish = streamHarness();
    publish("vessel.identity", { name: "Kerbal I" });

    expect(getValue("data", "vessel.identity.name")).toBeUndefined();
  });
});
