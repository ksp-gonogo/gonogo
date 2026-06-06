import type { DataKey, DataSource, DataSourceStatus } from "@gonogo/core";
import { clearRegistry, registerDataSource } from "@gonogo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoNoGoHostService } from "../goNoGo/GoNoGoHostService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { SettingsService } from "../settings";
import { __resetSharedAudioContextForTests } from "../sound/audio";
import {
  __resetSoundEnabledForTests,
  initSoundSettings,
} from "../sound/soundSettings";
import { installFakeAudio, makeSoundService } from "../test/fakeAudio";

// ---------------------------------------------------------------------------
// Fakes — small stand-ins so we can drive events deterministically
// ---------------------------------------------------------------------------

class FakeHost {
  broadcasts: unknown[] = [];
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

  broadcast(msg: unknown): void {
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
    return this as unknown as PeerHostService;
  }
}

class FakeDataSource implements DataSource {
  readonly id = "data";
  readonly name = "data";
  status: DataSourceStatus = "connected";
  executed: string[] = [];
  private subs = new Map<string, Set<(v: unknown) => void>>();

  async connect() {}
  disconnect() {}
  schema(): DataKey[] {
    return [{ key: "v.missionTime" }];
  }
  subscribe(key: string, cb: (v: unknown) => void) {
    let bucket = this.subs.get(key);
    if (!bucket) {
      bucket = new Set();
      this.subs.set(key, bucket);
    }
    bucket.add(cb);
    return () => bucket?.delete(cb);
  }
  onStatusChange() {
    return () => {};
  }
  async execute(action: string) {
    this.executed.push(action);
  }
  configSchema() {
    return [];
  }
  configure() {}
  getConfig() {
    return {};
  }

  // Driver
  emit(key: string, value: unknown) {
    const bucket = this.subs.get(key);
    if (!bucket) return;
    for (const cb of bucket) cb(value);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoNoGoHostService", () => {
  let host: FakeHost;
  let ds: FakeDataSource;
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

  beforeEach(() => {
    vi.useFakeTimers();
    clearRegistry();
    // Sound on by default; the host fires the T-0 + abort tones internally.
    __resetSharedAudioContextForTests();
    oscillators = installFakeAudio();
    __resetSoundEnabledForTests();
    useSound(true);
    host = new FakeHost();
    ds = new FakeDataSource();
    registerDataSource(ds);
    svc = new GoNoGoHostService(host.asHost(), "data");
  });

  afterEach(() => {
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
    const countdownStart = host.broadcasts.at(-1) as {
      type: string;
      t0Ms: number;
    };
    expect(countdownStart.type).toBe("gonogo-countdown-start");
    expect(countdownStart.t0Ms).toBeGreaterThan(Date.now());
  });

  it("cancels the countdown when a vote flips to NO-GO", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireVote("peer-1", "no-go");
    expect(svc.getSnapshot().countdown).toBeNull();
    const cancel = host.broadcasts.at(-1) as { type: string; reason?: string };
    expect(cancel.type).toBe("gonogo-countdown-cancel");
    expect(cancel.reason).toContain("no-go");
  });

  it("cancels the countdown when a new peer joins mid-countdown", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireConnect("peer-2");
    expect(svc.getSnapshot().countdown).toBeNull();
    const cancel = host.broadcasts.at(-1) as { type: string; reason?: string };
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

  it("fires f.stage at T-0 when triggerStageAtZero is on (default)", () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    expect(ds.executed).toContain("f.stage");
  });

  it("does not fire f.stage at T-0 when triggerStageAtZero is off", () => {
    svc.setConfig({ countdownLengthMs: 5_000, triggerStageAtZero: false });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    expect(ds.executed).not.toContain("f.stage");
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

  it("marks launched when v.missionTime goes positive", () => {
    expect(svc.getSnapshot().launched).toBe(false);
    ds.emit("v.missionTime", 1.5);
    expect(svc.getSnapshot().launched).toBe(true);
  });

  it("ignores abort messages pre-launch", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    host.fireAbort("peer-1");
    expect(svc.getSnapshot().abort).toBeNull();
    expect(ds.executed).not.toContain("f.abort");
  });

  it("executes f.abort and records station name + peerId when a station aborts post-launch", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    ds.emit("v.missionTime", 10);
    host.fireAbort("peer-1");
    expect(ds.executed).toContain("f.abort");
    const snap = svc.getSnapshot();
    expect(snap.abort?.stationName).toBe("CAPCOM");
    expect(snap.abort?.peerId).toBe("peer-1");
    const notify = host.broadcasts.at(-1) as {
      type: string;
      stationName: string;
    };
    expect(notify.type).toBe("gonogo-abort-notify");
    expect(notify.stationName).toBe("CAPCOM");
  });

  it("plays the abort alert tone on the genuine first abort, but not on re-notify", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    ds.emit("v.missionTime", 10);
    host.fireAbort("peer-1");
    const afterFirst = oscillators.length;
    expect(afterFirst).toBeGreaterThan(0);
    // A re-notification (station reconnect after host refresh) must not chime
    // again — mirrors the f.abort no-double-fire guarantee.
    host.fireAbort("peer-1");
    expect(oscillators.length).toBe(afterFirst);
  });

  it("re-notifies (doesn't re-fire) when an already-aborted station resends", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    ds.emit("v.missionTime", 10);
    host.fireAbort("peer-1");
    expect(ds.executed.filter((a) => a === "f.abort")).toHaveLength(1);
    // Second abort (e.g. station reconnecting after host refresh) should
    // rebroadcast attribution but NOT toggle f.abort again.
    host.broadcasts.length = 0;
    host.fireAbort("peer-1");
    expect(ds.executed.filter((a) => a === "f.abort")).toHaveLength(1);
    const notify = host.broadcasts.at(-1) as {
      type: string;
      stationName: string;
    };
    expect(notify.type).toBe("gonogo-abort-notify");
    expect(notify.stationName).toBe("CAPCOM");
  });

  it("second station aborting after first is ignored (first-abort-wins)", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireStationInfo("peer-1", "A");
    host.fireStationInfo("peer-2", "B");
    ds.emit("v.missionTime", 10);
    host.fireAbort("peer-1");
    host.fireAbort("peer-2");
    expect(ds.executed.filter((a) => a === "f.abort")).toHaveLength(1);
    expect(svc.getSnapshot().abort?.stationName).toBe("A");
  });

  it("clears abort on revert (missionTime back to 0)", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    ds.emit("v.missionTime", 10);
    host.fireAbort("peer-1");
    expect(svc.getSnapshot().abort).not.toBeNull();
    ds.emit("v.missionTime", 0);
    expect(svc.getSnapshot().abort).toBeNull();
  });

  it("cancels a running countdown if launch is somehow detected", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    ds.emit("v.missionTime", 1);
    expect(svc.getSnapshot().countdown).toBeNull();
  });
});
