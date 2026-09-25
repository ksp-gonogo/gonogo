/**
 * The launch state through the REAL derivation: a real `TimelineStore` with
 * `vesselStateChannel`, fed the frames the mod sends for a craft that has left
 * the pad and is under physics. The sibling suite drives `met` directly, which
 * cannot see a derivation that nulls it in the measured basis.
 */

import {
  StubTransport,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import {
  PropagationHorizonKind,
  Quality,
  Situation,
  TrajectoryKind,
} from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoNoGoHostService } from "../goNoGo/GoNoGoHostService";
import type { PeerHostService } from "../peer/PeerHostService";
import { __resetSharedAudioContextForTests } from "../sound/audio";
import { __resetSoundEnabledForTests } from "../sound/soundSettings";
import { installFakeAudio } from "../test/fakeAudio";

const VESSEL = "8de0da0e-f691-4327-98bf-fb37cc322b92";
const LAUNCH_UT = 1_000;
const VIEW_UT = 1_042;

function fakeHost() {
  const connect = new Set<(peerId: string) => void>();
  const info = new Set<(peerId: string, i: { name: string }) => void>();
  const abort = new Set<(peerId: string) => void>();
  return {
    broadcast() {},
    onPeerConnect(cb: (peerId: string) => void) {
      connect.add(cb);
      return () => connect.delete(cb);
    },
    onPeerDisconnect: () => () => {},
    onStationInfo(cb: (peerId: string, i: { name: string }) => void) {
      info.add(cb);
      return () => info.delete(cb);
    },
    onGonogoVote: () => () => {},
    onGonogoAbort(cb: (peerId: string) => void) {
      abort.add(cb);
      return () => abort.delete(cb);
    },
    join(peerId: string, name: string) {
      for (const cb of connect) cb(peerId);
      for (const cb of info) cb(peerId, { name });
    },
    pressAbort(peerId: string) {
      for (const cb of abort) cb(peerId);
    },
  };
}

describe("GoNoGoHostService on an ascent under physics", () => {
  let transport: StubTransport;
  let client: TelemetryClient;
  let store: TimelineStore;
  let host: ReturnType<typeof fakeHost>;
  let svc: GoNoGoHostService;
  let dispatched: string[];

  beforeEach(() => {
    __resetSharedAudioContextForTests();
    installFakeAudio();
    __resetSoundEnabledForTests();
    transport = new StubTransport();
    client = new TelemetryClient(transport);
    const clock = new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    clock.scrubTo(VIEW_UT);
    store = new TimelineStore(clock);
    store.registerDerivedChannel(vesselStateChannel);
    client.attachStore(store);
    for (const topic of ["vessel.orbit", "vessel.flight", "vessel.identity"]) {
      client.subscribe(topic, () => {});
    }
    dispatched = [];
    transport.setCommandHandler((command) => {
      dispatched.push(command);
      return null;
    });
    setActiveTelemetryClientForTests(client);
    host = fakeHost();
    svc = new GoNoGoHostService(host as unknown as PeerHostService);
    setActiveTimelineStoreForTests(store);
  });

  afterEach(() => {
    svc.dispose();
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
    client.dispose();
  });

  function emitAscentFrame(): void {
    const meta = { source: `vessel:${VESSEL}`, quality: Quality.Loaded };
    transport.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 420_000,
        ecc: 0.6,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: VIEW_UT,
        mu: 3.5316e12,
        patches: [],
        horizon: {
          kind: PropagationHorizonKind.Unbounded,
          trajectoryKind: TrajectoryKind.Analytic,
        },
        meta,
      },
      { quality: Quality.Loaded, validAt: VIEW_UT },
    );
    transport.emit(
      "vessel.flight",
      {
        latitude: -0.1,
        longitude: -74.6,
        altitudeAsl: 8_400,
        altitudeTerrain: 8_320,
        verticalSpeed: 310,
        surfaceSpeed: 420,
        orbitalSpeed: 560,
        gForce: 2.1,
        dynamicPressureKPa: 18,
        mach: 1.3,
        atmDensity: 0.4,
        meta,
      },
      { quality: Quality.Loaded, validAt: VIEW_UT },
    );
    transport.emit(
      "vessel.identity",
      {
        vesselId: VESSEL,
        name: "Sally-Hut 1",
        vesselType: 0,
        situation: Situation.Flying,
        parentBodyIndex: 1,
        launchUt: LAUNCH_UT,
        meta,
      },
      { quality: Quality.Loaded, validAt: VIEW_UT },
    );
    store.beginFrame();
  }

  it("reports launched for a craft that has lifted off and is under physics, with the abort gate open", async () => {
    host.join("peer-1", "FLIGHT");

    emitAscentFrame();

    expect(svc.getSnapshot().launched).toBe(true);
    host.pressAbort("peer-1");
    await Promise.resolve();
    await Promise.resolve();
    expect(svc.getSnapshot().abort?.stationName).toBe("FLIGHT");
    expect(dispatched).toContain("vessel.control.setAbort");
  });
});
