import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTrueNowTopic, parseServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { makeMeta, StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * An Uplink channel's delay role reaches the reader from the running mod, not
 * from a scan of this repo.
 *
 * The roles block is read off `mod/golden-fixtures/delay-roles-roster.json`,
 * which `SystemUplinksCarriesEveryDeclaredDelayRole` holds equal to what a real
 * `ChannelEngine` puts on `system.uplinks` for test Uplinks declaring those
 * roles, so neither half can drift without the other going red. It then goes
 * through `parseServerMessage` and a real `TelemetryClient` into the store,
 * which is the whole production path short of the socket.
 */

// src -> sitrep-client -> packages -> repo root
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = join(ROOT, "mod", "golden-fixtures", "delay-roles-roster.json");

function stringList(block: Record<string, unknown>, name: string): string[] {
  const list = block[name];
  if (!Array.isArray(list) || !list.every((e) => typeof e === "string")) {
    throw new Error(`fixture delayRoles.${name} is not a list of topics`);
  }
  return list;
}

/** The fixture, checked field by field so a malformed file fails here rather than as a wrong lane. */
function readFixture() {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`${FIXTURE} is not an object`);
  }
  const { topic, delayRoles } = parsed as Record<string, unknown>;
  if (typeof topic !== "string" || delayRoles === null) {
    throw new Error(`${FIXTURE} names no topic or no delayRoles block`);
  }
  if (typeof delayRoles !== "object") {
    throw new Error(`${FIXTURE} delayRoles is not an object`);
  }
  const block = delayRoles as Record<string, unknown>;
  return {
    topic,
    delayRoles: {
      trueNow: stringList(block, "trueNow"),
      heldAtHome: stringList(block, "heldAtHome"),
      trueNowPrefixes: stringList(block, "trueNowPrefixes"),
    },
  };
}

const fixture = readFixture();

/** One-way light time to the active craft, seconds. A craft four minutes out. */
const OWLT = 240;
const UT_NOW = 10_000;

const HELD_AT_HOME = "rp1.programs";
const LINK_TRUE_NOW = "comms.linkMargin";
const SECOND_TRUE_NOW = "comms.dataRate";
const DYNAMIC_TRUE_NOW = "uplinktest.live.alpha";
const DELAYED = "vessel.flight";

function wire(topic: string, payload: unknown, validAt: number): string {
  return JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: makeMeta({ validAt, deliveredAt: UT_NOW, vantage: "KSC" }),
  });
}

/**
 * A ground centre reading a distant active craft: the client's delayed lane is
 * a whole light-time behind, and the mod has already delivered the home node's
 * value at the true now because a ground centre is no distance from home.
 */
function connect(roster: Record<string, unknown> | undefined) {
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => OWLT,
  });
  const store = new TimelineStore(clock);
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  client.attachStore(store);
  const deliver = (topic: string, payload: unknown, validAt: number) =>
    transport.emitRaw(parseServerMessage(wire(topic, payload, validAt)));

  if (roster) {
    deliver(fixture.topic, { uplinks: [], ...roster }, UT_NOW);
  }
  deliver(DELAYED, { altitudeAsl: 70_000 }, UT_NOW);
  return { store, deliver };
}

describe("an Uplink channel's delay role, carried on system.uplinks", () => {
  it("reads an rp1 held-at-home value at the home node's delivery, with no light-time taken off", () => {
    const { store, deliver } = connect({ delayRoles: fixture.delayRoles });
    deliver(HELD_AT_HOME, { programs: ["earth-orbit"] }, UT_NOW);
    store.beginFrame();

    expect(store.currentFrame().viewUt).toBe(UT_NOW - OWLT);
    expect(store.sample(HELD_AT_HOME)?.validAt).toBe(UT_NOW);
  });

  it.each([
    LINK_TRUE_NOW,
    SECOND_TRUE_NOW,
  ])("reads the TrueNow channel %s current", (topic) => {
    const { store, deliver } = connect({ delayRoles: fixture.delayRoles });
    deliver(topic, { value: 1 }, UT_NOW);
    store.beginFrame();

    expect(store.sample(topic)?.validAt).toBe(UT_NOW);
  });

  it("reads a topic under a TrueNow dynamic namespace current", () => {
    const { store, deliver } = connect({ delayRoles: fixture.delayRoles });
    deliver(DYNAMIC_TRUE_NOW, { value: 1 }, UT_NOW);
    store.beginFrame();

    expect(store.sample(DYNAMIC_TRUE_NOW)?.validAt).toBe(UT_NOW);
  });

  it("still holds a craft's state back a light-time", () => {
    const { store, deliver } = connect({ delayRoles: fixture.delayRoles });
    deliver(DELAYED, { altitudeAsl: 80_000 }, UT_NOW);
    store.beginFrame();

    expect(store.sample(DELAYED)).toBeUndefined();
  });

  it("takes the running mod's word over the generated core table", () => {
    /* `time.warp` is TrueNow in the generated table. A mod that states its roles
       and does not list it has declared it delayed, and the mod is the one
       running the channel. */
    const { store, deliver } = connect({ delayRoles: fixture.delayRoles });
    deliver("time.warp", { warpRate: 1 }, UT_NOW);
    store.beginFrame();

    expect(store.sample("time.warp")).toBeUndefined();
  });

  it("agrees with the generated core table on every channel the engine declares itself", () => {
    /* The fallback and the authority overlap on core channels. The engine's own
       `system.*` built-ins are the half a KSP-free engine can put on the wire,
       so they are the half pinned here; the fallback also only answers until a
       roster arrives, after which a disagreement could not reach a read. */
    const engineBuiltIns = fixture.delayRoles.trueNow.filter((topic) =>
      topic.startsWith("system."),
    );
    expect(engineBuiltIns.length).toBeGreaterThan(0);
    for (const topic of engineBuiltIns) {
      expect(isTrueNowTopic(topic), topic).toBe(true);
    }
  });

  it("falls back to the generated core table for a mod that states no roles", () => {
    const { store, deliver } = connect({});
    deliver("time.warp", { warpRate: 1 }, UT_NOW);
    deliver(HELD_AT_HOME, { programs: [] }, UT_NOW);
    store.beginFrame();

    expect(store.sample("time.warp")?.validAt).toBe(UT_NOW);
    expect(store.sample(HELD_AT_HOME)).toBeUndefined();
  });
});
