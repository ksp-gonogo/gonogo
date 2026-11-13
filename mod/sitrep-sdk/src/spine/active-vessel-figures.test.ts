import { describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import "./core-reckoners";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function setup(
  extraTopics: string[] = [],
  delaySeconds: () => number = () => 0,
) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds,
    }),
  );
  client.attachStore(store);
  for (const topic of ["ksp.activeVessel", "vessel.flight", ...extraTopics]) {
    client.subscribe(topic, () => {});
  }
  const read = () => {
    store.beginFrame();
    return store.sampleReading<{ altitude: number }>(
      "vessel.flight",
      store.currentFrame(),
    );
  };
  return { transport, client, read, store };
}

const KERBIN = {
  index: 1,
  name: "Kerbin",
  radius: 600_000,
  gravParameter: 3.5316e12,
};
const PROBE_ORBIT = {
  sma: 700_000,
  ecc: 0.01,
  inc: 5,
  lan: 10,
  argPe: 20,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
};

describe("the active craft before its own telemetry arrives", () => {
  function catalogSetup(delaySeconds: () => number = () => 0) {
    const fixture = setup(
      [
        "vessel.orbit",
        "vessel.identity",
        "trackingStation.catalog",
        "trackingStation.bodies",
      ],
      delaySeconds,
    );
    const { transport } = fixture;
    transport.emit("trackingStation.bodies", { bodies: [KERBIN] });
    transport.emit("trackingStation.catalog", {
      entries: [
        {
          vesselId: "probe",
          name: "Mun Probe",
          vesselType: 3,
          situation: 32,
          bodyIndex: 1,
          orbit: PROBE_ORBIT,
        },
      ],
    });
    return fixture;
  }
  const readOrbit = (store: TimelineStore) => {
    store.beginFrame();
    return store.sampleReading<{ sma: unknown }>(
      "vessel.orbit",
      store.currentFrame(),
    );
  };

  it("reads the craft's catalog orbit as modelled, and names it from the catalog", () => {
    const { transport, client, store } = catalogSetup();
    transport.emit("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });

    const orbit = readOrbit(store);
    expect(orbit.state).toBe("held");
    expect(orbit.reckoning.status).toBe("available");
    store.beginFrame();
    const identity = store.sample("vessel.identity", store.currentFrame());
    expect(identity?.payload).toMatchObject({
      vesselId: "probe",
      name: "Mun Probe",
      vesselType: 3,
      situation: 32,
      parentBodyIndex: 1,
      launchUt: null,
    });
    client.dispose();
  });

  it("models the catalog orbit while the signal delay to the craft is not known yet", () => {
    const unknown = catalogSetup(() => Number.POSITIVE_INFINITY);
    unknown.transport.emit("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });
    const orbit = readOrbit(unknown.store);
    expect(orbit.state).toBe("held");
    expect(orbit.reckoning.status).toBe("available");
    unknown.client.dispose();
  });

  it("gives way to the craft's own orbit once it arrives", () => {
    const { transport, client, store } = catalogSetup();
    transport.emit("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });
    transport.emit(
      "vessel.orbit",
      {
        ...PROBE_ORBIT,
        sma: 900_000,
        referenceBodyIndex: 1,
        mu: 3.5316e12,
        patches: [],
        horizon: { kind: 0, trajectoryKind: 0 },
        meta: { source: "vessel:probe", quality: 0 },
      },
      { source: "ground:KSC" },
    );
    const orbit = readOrbit(store);
    expect(orbit.state).not.toBe("pending");
    expect(orbit.state === "observed" || orbit.state === "held").toBe(true);
    if (orbit.state === "observed" || orbit.state === "held") {
      expect(JSON.stringify(orbit.value.sma)).toContain("900000");
    }
    client.dispose();
  });

  it("stays blank for a craft the catalog does not carry, and while no craft is named", () => {
    const { transport, client, store } = catalogSetup();
    expect(readOrbit(store).state).toBe("pending");
    transport.emit("ksp.activeVessel", { vesselId: "stranger", name: "?" });
    expect(readOrbit(store).state).toBe("pending");
    client.dispose();
  });
});

describe("vessel figures while another vessel is the active one", () => {
  it("shows no figures from the previous craft once an unlinked craft is active, and its own once they arrive", () => {
    const { transport, client, read } = setup();
    transport.emit("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    transport.emit(
      "vessel.flight",
      { altitude: 80_000, meta: { source: "vessel:mk1" } },
      { source: "ground:KSC" },
    );
    expect(read().state).not.toBe("pending");

    transport.emit("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });
    expect(read().state).toBe("pending");

    transport.emit(
      "vessel.flight",
      { altitude: 1_200, meta: { source: "vessel:probe" } },
      { source: "ground:KSC" },
    );
    const arrived = read();
    expect(arrived.state).not.toBe("pending");
    client.dispose();
  });

  it("hides them from a raw sample too, which the orbit view reads", () => {
    const { transport, client } = setup();
    const sampleFlight = (store: TimelineStore) => {
      store.beginFrame();
      return store.sample("vessel.flight", store.currentFrame());
    };
    const store = new TimelineStore(
      new ViewClock({
        nowWall: () => 0,
        warpRate: () => 1,
        delaySeconds: () => 0,
      }),
    );
    client.attachStore(store);
    transport.emit("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    transport.emit(
      "vessel.flight",
      { altitude: 80_000, meta: { source: "vessel:mk1" } },
      { source: "ground:KSC" },
    );
    expect(sampleFlight(store)).toBeDefined();
    transport.emit("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });
    expect(sampleFlight(store)).toBeUndefined();
    client.dispose();
  });

  it("hides a craft's figures that sit on a topic outside the vessel namespace, such as stage delta-v", () => {
    const { transport, client, store } = setup(["dv.summary"]);
    const read = () => {
      store.beginFrame();
      return store.sampleReading("dv.summary", store.currentFrame());
    };
    transport.emit("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    transport.emit(
      "dv.summary",
      { totalDeltaV: 912.7, meta: { source: "vessel:mk1" } },
      { source: "ground:KSC" },
    );
    expect(read().state).not.toBe("pending");

    transport.emit("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });
    expect(read().state).toBe("pending");
    client.dispose();
  });

  it("leaves a linked craft's figures as they were", () => {
    const { transport, client, read } = setup();
    transport.emit("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    transport.emit(
      "vessel.flight",
      { altitude: 80_000, meta: { source: "vessel:mk1" } },
      { source: "ground:KSC" },
    );
    transport.emit("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    const reading = read();
    expect(reading.state).not.toBe("pending");
    client.dispose();
  });

  it("withholds nothing while no active vessel is known", () => {
    const { transport, client, read } = setup();
    transport.emit(
      "vessel.flight",
      { altitude: 80_000, meta: { source: "vessel:mk1" } },
      { source: "ground:KSC" },
    );
    expect(read().state).not.toBe("pending");
    client.dispose();
  });
});
