import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import { parseServerMessage } from "../client";
import type { ClientMessage, ServerMessage } from "../envelope";
import { TelemetryClient } from "./client";
import "./core-reckoners";
import { DelayAuthority } from "./delay-authority";
import { estimateOneWayDelaySeconds } from "./delay-estimate";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/** A transport the recording is delivered through, subscribing nothing of its own. */
class RecordedTransport implements Transport {
  status: TransportStatus = "connected";
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  send(_message: ClientMessage) {}
  onMessage(listener: (m: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatusChange() {
    return () => {};
  }
  deliver(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }
}

/**
 * A switch from MkI to Mun Probe, replayed from frames recorded off a real
 * game through the same store, delay authority and view clock the app builds.
 * `linked-craft` is a switch to a craft with a link (a 30 s delay); `unlinked-craft`
 * is a switch to one with none. Times are milliseconds from the click.
 */
interface Row {
  ms: number;
  frame: string | object;
}

/** Whether a recorded frame is a delivery of the craft's own reading with no delay at all: its stamp says it arrived the instant it was made. */
function arrivedAtOnce(row: Row): boolean {
  const frame = row.frame as {
    topic?: string;
    meta?: { validAt?: number; deliveredAt?: number };
    payload?: { meta?: { source?: string } } | null;
  };
  const named = frame.payload?.meta?.source;
  return (
    frame.topic?.startsWith("vessel.") === true &&
    typeof named === "string" &&
    named.includes("6667a929") &&
    (frame.meta?.deliveredAt ?? 0) - (frame.meta?.validAt ?? 0) < 1
  );
}

function replay(name: string, options: { withoutEarlyCopy?: boolean } = {}) {
  const rows: Row[] = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "__fixtures__/switch",
      `${name}.jsonl`,
    ),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row: Row) => !(options.withoutEarlyCopy && arrivedAtOnce(row)));
  let wallMs = rows[0].ms;
  const authority = new DelayAuthority();
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => wallMs / 1000,
      warpRate: () => 1,
      delaySeconds: authority.delaySeconds,
      delayEpoch: authority.delayEpoch,
    }),
  );
  const transport = new RecordedTransport();
  const client = new TelemetryClient(transport);
  client.attachStore(store);
  authority.attach(client);
  for (const topic of new Set(
    rows.map((r) => (r.frame as { topic: string }).topic),
  )) {
    client.subscribe(topic, () => {});
  }
  let next = 0;
  const advanceTo = (ms: number) => {
    while (next < rows.length && rows[next].ms <= ms) {
      wallMs = rows[next].ms;
      transport.deliver(parseServerMessage(JSON.stringify(rows[next].frame)));
      store.beginFrame();
      next++;
    }
    wallMs = ms;
    store.beginFrame();
    return {
      orbit: store.sampleReading<{ sma: unknown }>(
        "vessel.orbit",
        store.currentFrame(),
      ),
      catalogOrbit: store.isCatalogFallback(
        "vessel.orbit",
        store.currentFrame(),
      ),
    };
  };
  return { advanceTo, store };
}

/** The scene and bodies the game last sent, read as the dashboard reads them. */
function sceneAndBodies(store: TimelineStore) {
  const frame = store.currentFrame();
  return {
    scene: store.sampleReading<{ scene: string }>("spaceCenter.scene", frame),
    bodies: store.sampleReading<unknown>("trackingStation.bodies", frame),
  };
}

describe("a switch from MkI to Mun Probe, from recorded frames", () => {
  it("shows the linked craft's own orbit as soon as the mod sends it, before its delay is known", () => {
    const { advanceTo } = replay("linked-craft");

    // Before the switch: MkI, in the atmosphere, which the orbit model does not carry.
    expect(advanceTo(1_000).orbit.state).not.toBe("pending");

    // 5 s: the game has named Mun Probe, and Mun Probe's own orbit has arrived, stamped now. The delay to it is not known yet.
    const five = advanceTo(5_000);
    expect(five.catalogOrbit).toBe(false);
    expect(five.orbit.state === "observed" || five.orbit.state === "held").toBe(
      true,
    );
    expect(five.orbit.reckoning.status).toBe("available");

    // And it stays, through the 30 s the delay takes to be learned.
    for (const ms of [15_000, 35_000]) {
      const read = advanceTo(ms);
      expect(
        read.orbit.state === "observed" || read.orbit.state === "held",
      ).toBe(true);
    }
  });

  it("waits for the delayed copy when the mod sends nothing early, modelling the catalog's orbit in the meantime and showing the craft's own once it lands", () => {
    const { advanceTo } = replay("linked-craft", { withoutEarlyCopy: true });
    advanceTo(1_000);

    // Nothing of the craft's own has crossed yet, and the bodies are not known: nothing to show but the wait.
    expect(advanceTo(5_000).orbit.state).toBe("pending");

    // Once the bodies are known the catalog's orbit stands in, modelled.
    const meanwhile = advanceTo(20_000);
    expect(meanwhile.catalogOrbit).toBe(true);
    expect(meanwhile.orbit.reckoning.status).toBe("available");

    // The delayed copy lands about 31 s after the switch and replaces it.
    const landed = advanceTo(37_000);
    expect(landed.catalogOrbit).toBe(false);
    expect(landed.orbit.state).toBe("observed");
  });

  it("models the unlinked craft's catalog orbit instead of declining it for want of history", () => {
    const { advanceTo } = replay("unlinked-craft");
    advanceTo(1_000);

    // Once the bodies are known, the craft sends nothing and the catalog's orbit stands in, modelled.
    for (const ms of [15_000, 35_000, 45_000]) {
      const read = advanceTo(ms);
      expect(read.catalogOrbit).toBe(true);
      expect(read.orbit.state).toBe("held");
      expect(read.orbit.reckoning.status).toBe("available");
    }
  });

  it("keeps the scene and the bodies through the game's load, which the mod does not send again until its next keyframe", () => {
    const { advanceTo, store } = replay("switch-with-scene");
    advanceTo(1_000);
    for (const ms of [5_000, 10_000, 20_000]) {
      advanceTo(ms);
      const { scene, bodies } = sceneAndBodies(store);
      expect(scene.state === "observed" || scene.state === "held").toBe(true);
      expect(bodies.state === "observed" || bodies.state === "held").toBe(true);
    }
  });

  it("models the catalog's orbit as soon as the catalog arrives, in the same replay", () => {
    const { advanceTo } = replay("switch-with-scene");
    advanceTo(1_000);
    const read = advanceTo(8_000);
    expect(read.catalogOrbit).toBe(true);
    expect(read.orbit.reckoning.status).toBe("available");
  });

  it("has what the first-signal estimate needs, so the strip can name a figure from the catalog's arrival and not from the next keyframe", () => {
    const { advanceTo, store } = replay("switch-with-scene");
    advanceTo(1_000);
    advanceTo(8_000);
    const frame = store.currentFrame();
    const held = <Payload>(topic: string): Payload | undefined => {
      const reading = store.sampleReading<Payload>(topic, frame);
      return reading.state === "observed" || reading.state === "held"
        ? reading.value
        : undefined;
    };
    const active = held<{ vesselId: string }>("ksp.activeVessel");
    const seconds = estimateOneWayDelaySeconds({
      /* The rig's light is slowed, so one metre takes the figure the game's own comms.delay frames measured. */
      secondsPerMetre: 2.4923e-6,
      roster: held("commandCentre.roster"),
      bodies: held("trackingStation.bodies"),
      catalog: held("trackingStation.catalog"),
      vesselId: active?.vesselId ?? "",
      atUt: 7_143,
    });
    expect(seconds).not.toBeNull();
    expect(seconds).toBeGreaterThan(27);
    expect(seconds).toBeLessThan(31);
  });
});
