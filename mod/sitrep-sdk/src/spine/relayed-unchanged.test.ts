import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing/install-test-host";
import { makeMeta, StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";

describe("a frame relayed to a station", () => {
  afterEach(() => {
    resetTestHost();
    vi.restoreAllMocks();
  });

  /* PeerJS packs an undefined field as null, so a frame the host relayed with no list of unchanged fields reaches the station with `unchanged: null`. */
  it("is delivered when it carries unchanged: null, and keeps the fields it was sent", () => {
    installTestHost({});
    const failures = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const seen: unknown[] = [];
    client.subscribe("vessel.landing", (reading: unknown) =>
      seen.push(reading),
    );

    transport.emitRaw({
      type: "stream-data",
      topic: "vessel.landing",
      payload: { outcome: "a", siteHeights: [1, 2, 3] },
      unchanged: null,
      meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
    } as never);
    transport.emitRaw({
      type: "stream-data",
      topic: "vessel.landing",
      payload: { outcome: "b" },
      unchanged: ["siteHeights"],
      meta: makeMeta({ validAt: 2, deliveredAt: 2 }),
    } as never);

    expect(failures).not.toHaveBeenCalled();
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen[1])).toContain("[1,2,3]");
  });

  it("leaves no unchanged field on a frame it has filled in, so a relay of it sends none", () => {
    installTestHost({});
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("vessel.landing", () => {});
    const first = {
      type: "stream-data",
      topic: "vessel.landing",
      payload: { outcome: "a", siteHeights: [1, 2, 3] },
      meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
    };
    const second = {
      type: "stream-data",
      topic: "vessel.landing",
      payload: { outcome: "b" },
      unchanged: ["siteHeights"],
      meta: makeMeta({ validAt: 2, deliveredAt: 2 }),
    };

    transport.emitRaw(first as never);
    transport.emitRaw(second as never);

    expect("unchanged" in second).toBe(false);
  });
});
