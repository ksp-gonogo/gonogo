import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * Raw wire topics are multi-field RECORDS
 * (`"time.warp"` carries `{ warpRate, warpRateIndex, warpMode, paused }` as
 * ONE payload: confirmed against the real
 * `local_docs/telemetry-mod/recordings/reference-wire-fixture.json`), but
 * The retired flat key vocabulary mapped old per-field keys to
 * dotted SUBTOPIC strings (`"t.currentRate" -> "time.warp.warpRate"`) for
 * nearly every raw channel (`vessel.flight.*`, `vessel.orbit.*`,
 * `vessel.control.*`, `time.warp.*`, ...): everything except the handful of
 * `vessel.state.*` entries, which ride the DERIVED-channel `fields: true`
 * mechanism (`vessel-state.ts`).
 *
 * Without the resolution this file exercises, `TimelineStore` would only
 * expose `"<parent>.<field>"` subtopic reads for a REGISTERED DERIVED
 * channel (`resolveDerivedTopic`): nothing would ever resolve a RAW
 * multi-field topic's dotted subtopic, because nothing ever publishes to the
 * literal wire topic `"time.warp.warpRate"`. A mapped raw-field key would
 * carry (once promoted to the carried-channels allowlist) forever, since
 * `sample()`'s raw path looked up a `ClientTimeline` keyed by the exact
 * dotted string, which nothing ever ingests: the read shim's "mapped ->
 * stream" routing would silently be a dead end for every raw-record mapping
 * in the whole migration table, not just `time.warp`.
 *
 * The fix: `TimelineStore` ALSO resolves a dotted topic (3+ dot-segments, no
 * derived-channel match) against the timeline of the LONGEST KNOWN Topic id
 * the key starts with, walking the remaining segments as a nested field path
 * into that record's payload. Exercised here with `time.warp` (WarpControl's
 * own channel) and a synthetic nested example mirroring
 * `vessel.thermal.hottestPart.skinTemp` (that vocabulary's one already-mapped
 * 4-segment/2-level-nested entry) to prove the mechanism isn't accidentally
 * 1-level-only, and with `alarm.scet.fired`, a Topic that is itself three
 * segments long, to prove the split is not simply "after the second".
 */

interface WarpPayload {
  warpRate: number;
  warpRateIndex: number;
  warpMode: number;
  paused: boolean;
}

function warpPoint(
  payload: WarpPayload | null,
  overrides: { validAt?: number; epoch?: number } = {},
): TimelinePoint<WarpPayload | null> {
  const validAt = overrides.validAt ?? 0;
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt, source: "game" }),
    epoch: overrides.epoch ?? 0,
  };
}

function newStore(): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  return new TimelineStore(clock);
}

describe("TimelineStore: raw record field-subtopic resolution", () => {
  it("resolves a mapped field off a raw multi-field record after the record itself is ingested", () => {
    const store = newStore();
    store.ingest(
      "time.warp",
      warpPoint({
        warpRate: 5,
        warpRateIndex: 2,
        warpMode: 0,
        paused: false,
      }),
    );
    const token = store.beginFrame();

    expect(store.sample<number>("time.warp.warpRate", token)?.payload).toBe(5);
    expect(
      store.sample<number>("time.warp.warpRateIndex", token)?.payload,
    ).toBe(2);
    expect(store.sample<number>("time.warp.warpMode", token)?.payload).toBe(0);
    expect(store.sample<boolean>("time.warp.paused", token)?.payload).toBe(
      false,
    );

    // The parent's own whole-record read is unaffected by field reads.
    expect(store.sample<WarpPayload>("time.warp", token)?.payload).toEqual({
      warpRate: 5,
      warpRateIndex: 2,
      warpMode: 0,
      paused: false,
    });
  });

  it("resolves a 2-level nested field path (mirrors the shipped vessel.thermal.hottestPart.skinTemp mapping)", () => {
    const store = newStore();
    store.ingest("vessel.thermal", {
      validAt: 0,
      payload: { hottestPart: { skinTemp: 450.5, skinMaxTemp: 1200 } },
      meta: makeMeta({ validAt: 0, deliveredAt: 0 }),
      epoch: 0,
    });
    const token = store.beginFrame();

    expect(
      store.sample<number>("vessel.thermal.hottestPart.skinTemp", token)
        ?.payload,
    ).toBe(450.5);
    expect(
      store.sample<number>("vessel.thermal.hottestPart.skinMaxTemp", token)
        ?.payload,
    ).toBe(1200);
  });

  it("is 'not whole yet' (undefined) before the parent raw topic has ever received a point", () => {
    const store = newStore();
    const token = store.beginFrame();
    expect(store.sample<number>("time.warp.warpRate", token)).toBeUndefined();
  });

  it("propagates a tombstoned parent (payload: null) as a null field read, not a fabricated value", () => {
    const store = newStore();
    store.ingest("time.warp", warpPoint(null));
    const token = store.beginFrame();

    const field = store.sample<number>("time.warp.warpRate", token);
    expect(field?.payload).toBeNull();
  });

  it("an unknown field name on a whole, live record reads undefined rather than throwing", () => {
    const store = newStore();
    store.ingest(
      "time.warp",
      warpPoint({
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      }),
    );
    const token = store.beginFrame();

    expect(
      store.sample<unknown>("time.warp.notARealField", token),
    ).toBeUndefined();
  });

  it("resolveSubscriptionTopics resolves a raw field subtopic down to the REAL wire topic, not the literal dotted string", () => {
    const store = newStore();
    expect(store.resolveSubscriptionTopics("time.warp.warpRate")).toEqual([
      "time.warp",
    ]);
    expect(
      store.resolveSubscriptionTopics("vessel.thermal.hottestPart.skinTemp"),
    ).toEqual(["vessel.thermal"]);
  });

  it("sampleStatus for a raw field subtopic mirrors the real parent topic's status", () => {
    const store = newStore();
    const before = store.beginFrame();
    // Nothing ingested yet: the real parent topic reads "resyncing"; the
    // field subtopic must report the SAME thing, not permanently "live" or
    // a distinct made-up status.
    expect(store.sampleStatus("time.warp.warpRate", before)).toBe(
      store.sampleStatus("time.warp", before),
    );
    expect(store.sampleStatus("time.warp.warpRate", before)).toBe("resyncing");

    store.ingest(
      "time.warp",
      warpPoint({
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      }),
    );
    const after = store.beginFrame();
    expect(store.sampleStatus("time.warp.warpRate", after)).toBe("live");
    expect(store.sampleStatus("time.warp.warpRate", after)).toBe(
      store.sampleStatus("time.warp", after),
    );
  });

  it("a genuinely 2-segment raw topic (no field to split) is unaffected; reads its own literal timeline exactly as before", () => {
    const store = newStore();
    store.ingest("vessel.orbit", {
      validAt: 0,
      payload: { sma: 700_000 },
      meta: makeMeta({ validAt: 0, deliveredAt: 0 }),
      epoch: 0,
    });
    const token = store.beginFrame();
    expect(
      store.sample<{ sma: number }>("vessel.orbit", token)?.payload,
    ).toEqual({ sma: 700_000 });
  });

  it("a genuinely 3-segment TOPIC is its own wire topic, and carries a field path of its own", () => {
    // `alarm.scet.fired` is a Topic, not a `.fired` field of the `alarm.scet`
    // ARRAY. The split lands at the longest known Topic id, so the topic reads
    // and subscribes as itself and `alarm.scet.fired.firedAtUt` reads the field
    // off it, where splitting after the second segment gave both of them
    // `alarm.scet` and a path nothing could fill.
    const store = newStore();
    expect(store.resolveSubscriptionTopics("alarm.scet.fired")).toEqual([
      "alarm.scet.fired",
    ]);
    expect(
      store.resolveSubscriptionTopics("alarm.scet.fired.firedAtUt"),
    ).toEqual(["alarm.scet.fired"]);

    store.ingest("alarm.scet.fired", {
      validAt: 0,
      payload: { id: "burn-1", firedAtUt: 1234.5 },
      meta: makeMeta({ validAt: 0, deliveredAt: 0 }),
      epoch: 0,
    });
    const token = store.beginFrame();
    expect(
      store.sample<number>("alarm.scet.fired.firedAtUt", token)?.payload,
    ).toBe(1234.5);
  });

  it("keeps the engine-declared 3-segment topics whole, which a hand-kept exemption set used to do", () => {
    // `system.uplink.pending` was exempted by name because there is no
    // `system.uplink` record for `.pending` to be a field of. It is a known
    // Topic id, so the longest-match split now answers for it, and for
    // `system.uplink.gates`, which the exemption set never named and which
    // therefore used to resolve to that non-existent parent.
    const store = newStore();
    expect(store.resolveSubscriptionTopics("system.uplink.pending")).toEqual([
      "system.uplink.pending",
    ]);
    expect(store.resolveSubscriptionTopics("system.uplink.gates")).toEqual([
      "system.uplink.gates",
    ]);
  });
});
