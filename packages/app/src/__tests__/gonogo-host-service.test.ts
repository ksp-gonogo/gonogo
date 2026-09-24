import { clearRegistry } from "@ksp-gonogo/core";
import type {
  FrameToken,
  TimelinePoint,
  TopicReading,
} from "@ksp-gonogo/sitrep-client";
import {
  readingFrom,
  StubTransport,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoNoGoHostService } from "../goNoGo/GoNoGoHostService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import type { SettingsService } from "../settings";
import { __resetSharedAudioContextForTests } from "../sound/audio";
import {
  __resetSoundEnabledForTests,
  initSoundSettings,
} from "../sound/soundSettings";
import { installFakeAudio, makeSoundService } from "../test/fakeAudio";
import { asHostService } from "../test/peerFakes";

// ---------------------------------------------------------------------------
// Fakes: small stand-ins so we can drive events deterministically
// ---------------------------------------------------------------------------

class FakeHost {
  broadcasts: PeerMessage[] = [];
  private listeners = {
    connect: new Set<(peerId: string) => void>(),
    disconnect: new Set<(peerId: string) => void>(),
    stationInfo: new Set<
      (
        peerId: string,
        info: { name: string; version?: string; buildTime?: string },
      ) => void
    >(),
    vote: new Set<(peerId: string, status: "go" | "no-go" | null) => void>(),
    abort: new Set<(peerId: string) => void>(),
  };

  broadcast(msg: PeerMessage): void {
    this.broadcasts.push(msg);
  }

  onPeerConnect(cb: (peerId: string) => void) {
    this.listeners.connect.add(cb);
    return () => this.listeners.connect.delete(cb);
  }
  onPeerDisconnect(cb: (peerId: string) => void) {
    this.listeners.disconnect.add(cb);
    return () => this.listeners.disconnect.delete(cb);
  }
  onStationInfo(
    cb: (
      peerId: string,
      info: { name: string; version?: string; buildTime?: string },
    ) => void,
  ) {
    this.listeners.stationInfo.add(cb);
    return () => this.listeners.stationInfo.delete(cb);
  }
  onGonogoVote(cb: (peerId: string, status: "go" | "no-go" | null) => void) {
    this.listeners.vote.add(cb);
    return () => this.listeners.vote.delete(cb);
  }
  onGonogoAbort(cb: (peerId: string) => void) {
    this.listeners.abort.add(cb);
    return () => this.listeners.abort.delete(cb);
  }

  // Drivers used by tests to simulate incoming events
  fireConnect(peerId: string) {
    for (const cb of this.listeners.connect) cb(peerId);
  }
  fireDisconnect(peerId: string) {
    for (const cb of this.listeners.disconnect) cb(peerId);
  }
  fireStationInfo(peerId: string, name: string) {
    for (const cb of this.listeners.stationInfo) cb(peerId, { name });
  }
  fireVote(peerId: string, status: "go" | "no-go" | null) {
    for (const cb of this.listeners.vote) cb(peerId, status);
  }
  fireAbort(peerId: string) {
    for (const cb of this.listeners.abort) cb(peerId);
  }

  asHost(): PeerHostService {
    return asHostService(this);
  }
}

/**
 * Stands in for the store a mounted `TelemetryProvider` registers, so launch
 * state is driven the way the app drives it: `vessel.state.met` sampled off an
 * ingested frame.
 *
 * There is deliberately no `DataSource` behind this. The service's legacy
 * fallback asks for the id `"data"`, and the app registers no source under
 * that id, so a fake one here would exercise a branch the app cannot reach.
 */
class FakeTimelineStore {
  private met: number | null = null;
  private frameListeners = new Set<() => void>();

  sample<T>(topic: string): TimelinePoint<T> | undefined {
    if (topic !== "vessel.state") return undefined;
    return {
      validAt: 0,
      epoch: 0,
      meta: {} as TimelinePoint<T>["meta"],
      payload: { met: this.met } as T,
    };
  }
  /*
   * Built from this store's OWN `sample` through the real `readingFrom`, so the
   * two reads cannot disagree: `vessel.state` carries the MET it just emitted
   * and reads live, and every other topic is pending because nothing has
   * arrived on it. Hand-writing the union here would let the fake answer a
   * currency question this store has no way to know.
   */
  sampleReading<T>(topic: string): TopicReading<T> {
    return readingFrom<T>(this.sample<T>(topic), "live", 0);
  }

  /** Never inspected: this store's `sample` ignores the frame it is handed. */
  currentFrame(): FrameToken {
    return {} as FrameToken;
  }
  subscribeFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  /** Driver: a newly ingested frame carrying this MET. */
  emitMet(met: number | null): void {
    this.met = met;
    for (const cb of [...this.frameListeners]) cb();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * `TelemetryClient.dispatch` hands the command to the transport across a
 * microtask, so a synchronous assertion right after the trigger sees an empty
 * list. Two turns is enough and matches what the alarm host's own tests drain.
 */
async function drainDispatch(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * The service's most recent broadcast at the given type, or a failure naming
 * what it sent instead. `PeerMessage` is a discriminated union, so narrowing on
 * `type` is what gives the assertions below the fields they read.
 */
function lastBroadcast<T extends PeerMessage["type"]>(
  host: FakeHost,
  type: T,
): Extract<PeerMessage, { type: T }> {
  const msg = host.broadcasts.at(-1);
  if (!msg || msg.type !== type) {
    throw new Error(
      `expected a ${type} broadcast, got: ${msg?.type ?? "none"}`,
    );
  }
  return msg as Extract<PeerMessage, { type: T }>;
}

describe("GoNoGoHostService", () => {
  let host: FakeHost;
  let timeline: FakeTimelineStore;
  let svc: GoNoGoHostService;
  let oscillators: ReturnType<typeof installFakeAudio>;
  let unsubSound: (() => void) | null = null;
  let soundSvc: SettingsService | null = null;

  function useSound(enabled: boolean): void {
    unsubSound?.();
    soundSvc?.dispose();
    soundSvc = makeSoundService(enabled);
    unsubSound = initSoundSettings(soundSvc);
  }

  let dispatched: Array<{ command: string; args: unknown }>;
  /** Every abort actually sent, which is what "fired once" means now. */
  const abortDispatches = () =>
    dispatched.filter((d) => d.command === "vessel.control.setAbort");
  let transport: StubTransport;
  let telemetryClient: TelemetryClient | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    clearRegistry();
    // The service dispatches its two commands through the stream, naming each
    // one directly, so what a test can observe is the command that arrived at
    // the transport rather than a `DataSource.execute` string.
    dispatched = [];
    transport = new StubTransport();
    telemetryClient = new TelemetryClient(transport);
    const store = new TimelineStore(
      new ViewClock({
        nowWall: () => 0,
        warpRate: () => 1,
        delaySeconds: () => 0,
      }),
    );
    telemetryClient.attachStore(store);
    transport.setCommandHandler((command, args) => {
      dispatched.push({ command, args });
      return null;
    });
    setActiveTelemetryClientForTests(telemetryClient);
    // Sound on by default; the host fires the T-0 + abort tones internally.
    __resetSharedAudioContextForTests();
    oscillators = installFakeAudio();
    __resetSoundEnabledForTests();
    useSound(true);
    host = new FakeHost();
    /*
     * `MainScreen`'s order: the service is built in a `useState` initialiser
     * during the first render, and the provider that registers the store is a
     * child whose effect has not run yet. Constructing it store-first is the
     * one arrangement the app never uses, and it hides a subscription that
     * never attaches.
     */
    svc = new GoNoGoHostService(host.asHost());
    timeline = new FakeTimelineStore();
    setActiveTimelineStoreForTests(timeline);
  });

  afterEach(() => {
    setActiveTelemetryClientForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    telemetryClient?.dispose();
    svc.dispose();
    unsubSound?.();
    unsubSound = null;
    soundSvc?.dispose();
    soundSvc = null;
    __resetSoundEnabledForTests();
    vi.useRealTimers();
    clearRegistry();
  });

  it("reports connected stations and their votes", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    host.fireVote("peer-1", "no-go");
    const snap = svc.getSnapshot();
    expect(snap.stations).toEqual([
      { peerId: "peer-1", name: "CAPCOM", status: "no-go" },
    ]);
  });

  it("starts a countdown when all connected stations vote GO", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireStationInfo("peer-1", "A");
    host.fireStationInfo("peer-2", "B");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).toBeNull();
    host.fireVote("peer-2", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    const countdownStart = lastBroadcast(host, "gonogo-countdown-start");
    expect(countdownStart.t0Ms).toBeGreaterThan(Date.now());
  });

  it("cancels the countdown when a vote flips to NO-GO", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireVote("peer-1", "no-go");
    expect(svc.getSnapshot().countdown).toBeNull();
    const cancel = lastBroadcast(host, "gonogo-countdown-cancel");
    expect(cancel.reason).toContain("no-go");
  });

  it("cancels the countdown when a new peer joins mid-countdown", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireConnect("peer-2");
    expect(svc.getSnapshot().countdown).toBeNull();
    const cancel = lastBroadcast(host, "gonogo-countdown-cancel");
    expect(cancel.reason).toContain("new station");
  });

  it("cancels the countdown when a peer disconnects mid-countdown", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireVote("peer-1", "go");
    host.fireVote("peer-2", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireDisconnect("peer-2");
    expect(svc.getSnapshot().countdown).toBeNull();
  });

  it("stages at T-0 when triggerStageAtZero is on (default)", async () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    expect(dispatched.map((d) => d.command)).toContain("vessel.control.stage");
  });

  it("does not stage at T-0 when triggerStageAtZero is off", async () => {
    svc.setConfig({ countdownLengthMs: 5_000, triggerStageAtZero: false });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    expect(dispatched.map((d) => d.command)).not.toContain(
      "vessel.control.stage",
    );
  });

  it("plays the T-0 commit tone when the countdown reaches zero", () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(oscillators).toHaveLength(0);
    vi.advanceTimersByTime(5_001);
    expect(oscillators.length).toBeGreaterThan(0);
  });

  it("stays silent at T-0 when sound is disabled", () => {
    useSound(false);
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    expect(oscillators).toHaveLength(0);
  });

  it("marks launched when the stream MET goes positive", () => {
    expect(svc.getSnapshot().launched).toBe(false);
    timeline.emitMet(1.5);
    expect(svc.getSnapshot().launched).toBe(true);
  });

  it("ignores abort messages pre-launch", async () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    host.fireAbort("peer-1");
    expect(svc.getSnapshot().abort).toBeNull();
    await drainDispatch();
    expect(dispatched.map((d) => d.command)).not.toContain(
      "vessel.control.setAbort",
    );
  });

  it("aborts and records station name + peerId when a station aborts post-launch", async () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    await drainDispatch();
    expect(dispatched).toContainEqual({
      command: "vessel.control.setAbort",
      args: { enabled: true },
    });
    const snap = svc.getSnapshot();
    expect(snap.abort?.stationName).toBe("CAPCOM");
    expect(snap.abort?.peerId).toBe("peer-1");
    const notify = lastBroadcast(host, "gonogo-abort-notify");
    expect(notify.stationName).toBe("CAPCOM");
  });

  it("plays the abort alert tone on the genuine first abort, but not on re-notify", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    const afterFirst = oscillators.length;
    expect(afterFirst).toBeGreaterThan(0);
    // A re-notification (station reconnect after host refresh) must not chime
    // again: mirrors the f.abort no-double-fire guarantee.
    host.fireAbort("peer-1");
    expect(oscillators.length).toBe(afterFirst);
  });

  it("re-notifies (doesn't re-fire) when an already-aborted station resends", async () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    await drainDispatch();
    expect(abortDispatches()).toHaveLength(1);
    // Second abort (e.g. station reconnecting after host refresh) should
    // rebroadcast attribution but NOT abort again.
    host.broadcasts.length = 0;
    host.fireAbort("peer-1");
    await drainDispatch();
    expect(abortDispatches()).toHaveLength(1);
    const notify = lastBroadcast(host, "gonogo-abort-notify");
    expect(notify.stationName).toBe("CAPCOM");
  });

  it("second station aborting after first is ignored (first-abort-wins)", async () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireStationInfo("peer-1", "A");
    host.fireStationInfo("peer-2", "B");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    host.fireAbort("peer-2");
    await drainDispatch();
    expect(abortDispatches()).toHaveLength(1);
    expect(svc.getSnapshot().abort?.stationName).toBe("A");
  });

  it("clears abort on revert (MET back to 0)", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    expect(svc.getSnapshot().abort).not.toBeNull();
    timeline.emitMet(0);
    expect(svc.getSnapshot().abort).toBeNull();
  });

  it("cancels a running countdown if launch is somehow detected", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    timeline.emitMet(1);
    expect(svc.getSnapshot().countdown).toBeNull();
  });
});
