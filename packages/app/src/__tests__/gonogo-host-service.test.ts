import { clearRegistry } from "@ksp-gonogo/core";
import type {
  FrameToken,
  TimelinePoint,
  TopicReading,
} from "@ksp-gonogo/sitrep-client";
import {
  readingFrom,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  PropagationHorizonKind,
  Quality,
  Situation,
  TrajectoryKind,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GONOGO_CONFIG,
  GoNoGoHostService,
} from "../goNoGo/GoNoGoHostService";
import { ON_GO_NONE } from "../goNoGo/onGo";
import { HostJobs } from "../hosting/HostJobs";
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

// Fakes: small stand-ins so we can drive events deterministically.
class FakeHost {
  broadcasts: PeerMessage[] = [];
  sent: Array<{ peerId: string; msg: PeerMessage }> = [];
  protected listeners = {
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

  /**
   * A poll message goes to each screen voting in its centre, one send per
   * screen; it is recorded once among the broadcasts, as a message every voter
   * was told.
   */
  sendToPeer(peerId: string, msg: PeerMessage): void {
    this.sent.push({ peerId, msg });
    if (msg.type !== "gonogo-on-go" && this.broadcasts.at(-1) !== msg) {
      this.broadcasts.push(msg);
    }
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

const VIEW_UT = 1_000;

/**
 * Stands in for the store a mounted `TelemetryProvider` registers, so launch
 * state is driven the way the app drives it: `vessel.identity` sampled off an
 * ingested frame, its `launchUt` measured against the view clock `VIEW_UT`
 * registers and its `situation` saying whether the craft is on the pad.
 */
class FakeTimelineStore {
  private met: number | null = null;
  private onPad = false;
  private vesselId = "vessel-a";
  private epoch = 0;
  private identityReady = true;
  /** The epoch the real store's clock keeps, which the service reads to tell a new timeline from one more frame. */
  readonly clock = { getEpoch: () => this.epoch };
  private frameListeners = new Set<() => void>();

  sample<Payload>(topic: string): TimelinePoint<Payload> | undefined {
    if (topic !== "vessel.identity" || !this.identityReady) return undefined;
    return {
      validAt: 0,
      epoch: 0,
      meta: {} as TimelinePoint<Payload>["meta"],
      payload: {
        vesselId: this.vesselId,
        situation: this.onPad ? Situation.PreLaunch : Situation.Flying,
        launchUt:
          this.onPad || this.met === null
            ? null
            : value("ut", VIEW_UT - this.met),
      } as Payload,
    };
  }
  /*
   * Built from this store's OWN `sample` through the real `readingFrom`, so the
   * two reads cannot disagree: `vessel.identity` carries what it just emitted
   * and reads live, and every other topic is pending because nothing has
   * arrived on it. Hand-writing the union here would let the fake answer a
   * currency question this store has no way to know.
   */
  sampleReading<Payload>(topic: string): TopicReading<Payload> {
    return readingFrom<Payload>(this.sample<Payload>(topic), "live", {
      reckonUt: 0,
      receivedUt: 0,
    });
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

  /** Driver: a newly ingested frame whose liftoff puts the view clock this far past it. */
  emitMet(met: number | null): void {
    this.met = met;
    this.onPad = false;
    this.emit();
  }

  /** Driver: a newly ingested frame with the craft back on the pad, which carries no launch clock. */
  emitOnPad(): void {
    this.onPad = true;
    this.emit();
  }

  /** Driver: a store that has been built but has not yet been sent its first sample. */
  withholdSamples(): void {
    this.identityReady = false;
    this.epoch = 0;
  }

  /** Driver: the stream's first sample reaches the store, carrying the epoch the game is already on. */
  deliverFirstSample(epoch: number): void {
    this.identityReady = true;
    this.epoch = epoch;
    this.emit();
  }

  /** Driver: the game starts a new timeline (a revert, a quickload), and the next frame carries the higher epoch. */
  emitNewTimeline(): void {
    this.epoch++;
    this.emit();
  }

  /** Driver: a newly ingested frame whose craft is a different vessel, as a new flight or a quickload brings. */
  emitVessel(vesselId: string): void {
    this.vesselId = vesselId;
    this.emit();
  }

  private emit(): void {
    for (const cb of [...this.frameListeners]) cb();
  }
}

/**
 * `TelemetryClient.dispatch` hands the command to the transport across a
 * microtask, so a synchronous assertion right after the trigger sees an empty
 * list. Two turns is enough and matches what the alarm host's own tests drain.
 */
async function drainDispatch(): Promise<void> {
  // A command's outcome crosses several promise hops before the service acts on it.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * The service's most recent broadcast at the given type, or a failure naming
 * what it sent instead. `PeerMessage` is a discriminated union, so narrowing on
 * `type` is what gives the assertions below the fields they read.
 */
function lastBroadcast<MessageType extends PeerMessage["type"]>(
  host: FakeHost,
  type: MessageType,
): Extract<PeerMessage, { type: MessageType }> {
  const msg = host.broadcasts.at(-1);
  if (!msg || msg.type !== type) {
    throw new Error(
      `expected a ${type} broadcast, got: ${msg?.type ?? "none"}`,
    );
  }
  return msg as Extract<PeerMessage, { type: MessageType }>;
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
  let store: TimelineStore;

  beforeEach(() => {
    vi.useFakeTimers();
    clearRegistry();
    // The service dispatches its two commands through the stream, so the test observes the command that arrived at the transport.
    dispatched = [];
    transport = new StubTransport();
    telemetryClient = new TelemetryClient(transport);
    store = new TimelineStore(
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
    setActiveViewClockForTests({ viewUt: () => VIEW_UT });
  });

  afterEach(() => {
    setActiveTelemetryClientForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveViewClockForTests(undefined);
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

  it("tells a station that joins mid-countdown how long is left", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(4_000);
    host.fireConnect("late");
    const start = host.sent.find(
      (m) => m.peerId === "late" && m.msg.type === "gonogo-countdown-start",
    );
    expect(start?.msg).toEqual({
      type: "gonogo-countdown-start",
      remainingMs: DEFAULT_GONOGO_CONFIG.countdownLengthMs - 4_000,
    });
  });

  it("sends a joining station no countdown when none is running", () => {
    host.fireConnect("late");
    expect(host.sent.some((m) => m.msg.type === "gonogo-countdown-start")).toBe(
      false,
    );
  });

  it("starts a countdown when all connected stations vote GO", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireStationInfo("peer-1", "A");
    host.fireStationInfo("peer-2", "B");
    host.fireVote("peer-2", "no-go");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).toBeNull();
    host.fireVote("peer-2", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    const countdownStart = lastBroadcast(host, "gonogo-countdown-start");
    expect(countdownStart.remainingMs).toBe(
      DEFAULT_GONOGO_CONFIG.countdownLengthMs,
    );
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

  it("is not blocked by a connected screen that has no GO/NO-GO widget", () => {
    host.fireConnect("peer-1");
    host.fireConnect("no-widget");
    host.fireVote("no-widget", null);
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
  });

  it("stops counting a screen that removes its widget mid-poll", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireVote("peer-1", "go");
    host.fireVote("peer-2", "no-go");
    expect(svc.getSnapshot().countdown).toBeNull();
    host.fireVote("peer-2", null);
    expect(svc.getSnapshot().countdown).not.toBeNull();
  });

  it("never reads zero votes as all GO", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireVote("peer-1", null);
    host.fireVote("peer-2", null);
    expect(svc.getSnapshot().countdown).toBeNull();

    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireVote("peer-1", null);
    expect(svc.getSnapshot().countdown).toBeNull();
    expect(lastBroadcast(host, "gonogo-countdown-cancel").reason).toContain(
      "withdrawn",
    );
  });

  it("keeps counting down when a screen with no vote joins, and stops when that screen votes NO-GO", () => {
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireConnect("peer-2");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireVote("peer-2", "no-go");
    expect(svc.getSnapshot().countdown).toBeNull();
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

  it("holds the countdown with the station that dropped, and tells every screen", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireStationInfo("peer-2", "FVJ4");
    host.fireVote("peer-1", "go");
    host.fireVote("peer-2", "go");
    host.fireDisconnect("peer-2");
    expect(lastBroadcast(host, "gonogo-countdown-cancel").hold).toEqual({
      cause: "dropped",
      station: "FVJ4",
    });
    expect(svc.getSnapshot().notice).toEqual({
      kind: "held",
      cause: "dropped",
      station: "FVJ4",
    });
    host.fireConnect("peer-3");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().notice).toBeNull();
  });

  it("names the station that voted NO-GO in the hold", () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "9A35");
    host.fireVote("peer-1", "go");
    host.fireVote("peer-1", "no-go");
    expect(svc.getSnapshot().notice).toEqual({
      kind: "held",
      cause: "no-go",
      station: "9A35",
    });
  });

  it("reports the action sent when T-0 is reached", async () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    expect(lastBroadcast(host, "gonogo-outcome")).toEqual({
      type: "gonogo-outcome",
      action: "Stage",
      sent: true,
    });
    expect(svc.getSnapshot().notice).toEqual({
      kind: "outcome",
      action: "Stage",
      sent: true,
    });
  });

  it("reports the action not sent when the game refuses it at T-0", async () => {
    transport.setCommandHandler(() => {
      throw new Error("no vessel");
    });
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    expect(lastBroadcast(host, "gonogo-outcome")).toMatchObject({
      action: "Stage",
      sent: false,
    });
  });

  it("keeps counting down when a screen that never voted disconnects", () => {
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
    host.fireDisconnect("peer-2");
    expect(svc.getSnapshot().countdown).not.toBeNull();
  });

  it("stages at T-0 by default", async () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    expect(dispatched.map((d) => d.command)).toContain("vessel.control.stage");
  });

  it("starts no second countdown and stages once when a GO is repeated before the launch is seen", async () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireConnect("peer-2");
    host.fireVote("peer-1", "go");
    host.fireVote("peer-2", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    const stages = () =>
      dispatched.filter((d) => d.command === "vessel.control.stage");
    expect(stages()).toHaveLength(1);
    // Signal delay: the craft's mission time has not arrived, so nothing reads as launched yet.
    expect(svc.getSnapshot().launched).toBe(false);

    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).toBeNull();
    vi.advanceTimersByTime(10_000);
    await drainDispatch();
    expect(stages()).toHaveLength(1);
  });

  it("counts down again after T-0 only once a vote has left GO and returned", async () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    host.fireVote("peer-1", "no-go");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
  });

  it("fires nothing at T-0 when the choice is nothing", async () => {
    svc.setConfig({ countdownLengthMs: 5_000, onGo: ON_GO_NONE });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    expect(dispatched.map((d) => d.command)).not.toContain(
      "vessel.control.stage",
    );
  });

  it("does not stage at T-0 when another action is chosen, and leaves a refused one restartable", async () => {
    svc.setConfig({ countdownLengthMs: 5_000, onGo: "AG3" });
    host.fireConnect("peer-1");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    // No vessel.control reading has arrived, so a custom group has nothing to invert and nothing is sent.
    expect(dispatched).toHaveLength(0);
    host.fireVote("peer-1", "no-go");
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
  });

  it("tells every station what fires at T-0 when the choice changes", () => {
    host.broadcasts.length = 0;
    svc.setConfig({ onGo: "Gear", onGoLabel: "Gear" });
    expect(host.broadcasts).toContainEqual({
      type: "gonogo-on-go",
      label: "Gear",
    });
    host.broadcasts.length = 0;
    svc.setConfig({ onGo: ON_GO_NONE, onGoLabel: null });
    expect(host.broadcasts).toContainEqual({
      type: "gonogo-on-go",
      label: null,
    });
  });

  it("tells a station that joins what fires at T-0", () => {
    host.fireConnect("peer-9");
    expect(host.sent).toContainEqual({
      peerId: "peer-9",
      msg: { type: "gonogo-on-go", label: "Stage" },
    });
  });

  it("clears the votes and tells every station when the countdown reaches T-0", async () => {
    svc.setConfig({ countdownLengthMs: 5_000 });
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "A");
    host.fireVote("peer-1", "go");
    host.broadcasts.length = 0;
    vi.advanceTimersByTime(5_001);
    await drainDispatch();
    expect(host.broadcasts).toContainEqual({
      type: "gonogo-reset",
      reopened: false,
    });
    expect(svc.getSnapshot().stations).toEqual([
      { peerId: "peer-1", name: "A", status: null },
    ]);
  });

  it("tells a station that joins a reopened poll, so a reload keeps its vote", () => {
    host.fireConnect("peer-1");
    timeline.emitMet(10);
    svc.reset();
    host.sent.length = 0;
    host.fireConnect("peer-2");
    expect(host.sent).toContainEqual({
      peerId: "peer-2",
      msg: { type: "gonogo-reset", reopened: true },
    });
  });

  it("tells every station the poll is closed again when the craft is back on the pad", () => {
    host.fireConnect("peer-1");
    timeline.emitMet(10);
    svc.reset();
    host.broadcasts.length = 0;
    timeline.emitMet(0);
    expect(host.broadcasts).toContainEqual({
      type: "gonogo-reset",
      reopened: false,
    });
  });

  describe("reset", () => {
    it("cancels a running countdown the way a NO-GO does, without a tone", () => {
      host.fireConnect("peer-1");
      host.fireVote("peer-1", "go");
      expect(svc.getSnapshot().countdown).not.toBeNull();
      host.broadcasts.length = 0;
      svc.reset();
      expect(svc.getSnapshot().countdown).toBeNull();
      expect(host.broadcasts).toContainEqual({
        type: "gonogo-countdown-cancel",
        reason: "reset",
        hold: { cause: "reset" },
      });
      vi.advanceTimersByTime(60_000);
      expect(oscillators).toHaveLength(0);
    });

    it("clears every vote and the T-0 commit, keeps the chosen action, and tells every station", async () => {
      svc.setConfig({
        countdownLengthMs: 5_000,
        onGo: "Gear",
        onGoLabel: "Gear",
      });
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      host.fireVote("peer-1", "go");
      vi.advanceTimersByTime(5_001);
      await drainDispatch();
      host.broadcasts.length = 0;
      svc.reset();
      expect(svc.getSnapshot().stations).toEqual([
        { peerId: "peer-1", name: "A", status: null },
      ]);
      expect(svc.getSnapshot().config.onGo).toBe("Gear");
      expect(host.broadcasts).toContainEqual({
        type: "gonogo-reset",
        reopened: false,
      });
      host.fireVote("peer-1", "go");
      expect(svc.getSnapshot().countdown).not.toBeNull();
    });

    it("re-opens the poll after launch, so a later event can be counted down", () => {
      host.fireConnect("peer-1");
      timeline.emitMet(10);
      expect(svc.getSnapshot().launched).toBe(true);
      host.fireVote("peer-1", "go");
      expect(svc.getSnapshot().countdown).toBeNull();
      host.broadcasts.length = 0;
      svc.reset();
      expect(svc.getSnapshot().reopened).toBe(true);
      expect(host.broadcasts).toContainEqual({
        type: "gonogo-reset",
        reopened: true,
      });
      host.fireVote("peer-1", "go");
      expect(svc.getSnapshot().countdown).not.toBeNull();
      // The next frame of a launched craft does not cancel the new countdown.
      timeline.emitMet(11);
      expect(svc.getSnapshot().countdown).not.toBeNull();
    });

    it("leaves the abort available and its attribution in place, and closes the poll again on a revert", async () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "Booster");
      timeline.emitMet(10);
      host.fireAbort("peer-1");
      await drainDispatch();
      expect(svc.getSnapshot().abort?.stationName).toBe("Booster");
      svc.reset();
      expect(svc.getSnapshot().abort?.stationName).toBe("Booster");
      host.fireAbort("peer-1");
      expect(svc.getSnapshot().launched).toBe(true);
      timeline.emitMet(0);
      expect(svc.getSnapshot().reopened).toBe(false);
      expect(svc.getSnapshot().abort).toBeNull();
    });
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

  it("records no abort the game refused, announces nothing, and sends the next press again", async () => {
    let refuse = true;
    transport.setCommandHandler((command, args) => {
      dispatched.push({ command, args });
      if (refuse) throw new Error("no vessel to abort");
      return null;
    });
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    timeline.emitMet(10);
    const broadcastsBefore = host.broadcasts.length;

    host.fireAbort("peer-1");
    await drainDispatch();
    expect(abortDispatches()).toHaveLength(1);
    expect(svc.getSnapshot().abort).toBeNull();
    expect(host.broadcasts.length).toBe(broadcastsBefore);
    expect(oscillators).toHaveLength(0);

    refuse = false;
    host.fireAbort("peer-1");
    await drainDispatch();
    expect(abortDispatches()).toHaveLength(2);
    expect(svc.getSnapshot().abort?.stationName).toBe("CAPCOM");
    expect(lastBroadcast(host, "gonogo-abort-notify").stationName).toBe(
      "CAPCOM",
    );
  });

  it("records no abort when there is no stream to send it on", async () => {
    setActiveTelemetryClientForTests(undefined);
    host.fireConnect("peer-1");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    await drainDispatch();
    expect(svc.getSnapshot().abort).toBeNull();
    expect(oscillators).toHaveLength(0);
  });

  it("plays the abort alert tone on the genuine first abort, but not on re-notify", async () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    await drainDispatch();
    const afterFirst = oscillators.length;
    expect(afterFirst).toBeGreaterThan(0);
    // A re-notification (station reconnect after host refresh) must not chime again: mirrors the f.abort no-double-fire guarantee.
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
    // Second abort (e.g. station reconnecting after host refresh) should rebroadcast attribution but NOT abort again.
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

  it("clears abort on revert (MET back to 0)", async () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "CAPCOM");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    await drainDispatch();
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

  it("drops the staging notice once the launch is seen, so the header stops reading stage sent", async () => {
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "A");
    host.fireVote("peer-1", "go");
    vi.advanceTimersByTime(DEFAULT_GONOGO_CONFIG.countdownLengthMs + 1);
    await drainDispatch();
    expect(svc.getSnapshot().notice).toMatchObject({ kind: "outcome" });
    timeline.emitMet(4);
    expect(svc.getSnapshot().notice).toBeNull();
  });

  describe("a new timeline", () => {
    /* Stages at T-0, then the game reverts before any frame showed a positive mission time. */
    async function stagedThenReverted(): Promise<void> {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      timeline.emitMet(null);
      host.fireVote("peer-1", "go");
      vi.advanceTimersByTime(DEFAULT_GONOGO_CONFIG.countdownLengthMs + 1);
      await drainDispatch();
      host.fireVote("peer-1", "no-go");
      expect(svc.getSnapshot().notice).toMatchObject({ kind: "outcome" });
      host.broadcasts.length = 0;
      timeline.emitNewTimeline();
    }

    it("clears the vote and the staging notice when the game reverts before a launch was seen", async () => {
      await stagedThenReverted();
      expect(svc.getSnapshot().notice).toBeNull();
      expect(svc.getSnapshot().stations).toEqual([
        { peerId: "peer-1", name: "A", status: null },
      ]);
    });

    it("tells every station to drop its vote and its staging banner", async () => {
      await stagedThenReverted();
      expect(host.broadcasts).toContainEqual({
        type: "gonogo-reset",
        reopened: false,
      });
    });

    it("lets the next poll count down after the revert", async () => {
      await stagedThenReverted();
      host.fireVote("peer-1", "go");
      expect(svc.getSnapshot().countdown).not.toBeNull();
    });

    it("keeps the votes when another craft takes the pad's place", () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      timeline.emitOnPad();
      host.fireVote("peer-1", "no-go");
      host.broadcasts.length = 0;
      timeline.emitVessel("vessel-b");
      expect(svc.getSnapshot().stations[0]?.status).toBe("no-go");
      expect(host.broadcasts).toEqual([]);
    });

    it("shows no outcome for a T-0 command that settles after the revert", async () => {
      transport.setCommandHandler(
        () => new Promise((resolve) => setTimeout(() => resolve(null), 5_000)),
      );
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      timeline.emitMet(null);
      host.fireVote("peer-1", "go");
      vi.advanceTimersByTime(DEFAULT_GONOGO_CONFIG.countdownLengthMs + 1);
      timeline.emitNewTimeline();
      await vi.advanceTimersByTimeAsync(6_000);
      await drainDispatch();
      expect(svc.getSnapshot().notice).toBeNull();
    });

    it("keeps a reopened poll's votes when the active vessel changes in flight", () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      timeline.emitMet(10);
      svc.reset();
      host.fireVote("peer-1", "no-go");
      host.broadcasts.length = 0;
      timeline.emitVessel("debris");
      expect(svc.getSnapshot().stations[0]?.status).toBe("no-go");
      expect(host.broadcasts).toEqual([]);
    });

    it("clears a staging notice left by a craft that never left the pad", async () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      timeline.emitOnPad();
      host.fireVote("peer-1", "go");
      vi.advanceTimersByTime(DEFAULT_GONOGO_CONFIG.countdownLengthMs + 1);
      await drainDispatch();
      expect(svc.getSnapshot().notice).toMatchObject({ kind: "outcome" });
      host.broadcasts.length = 0;
      timeline.emitNewTimeline();
      expect(svc.getSnapshot().notice).toBeNull();
      expect(host.broadcasts).toContainEqual({
        type: "gonogo-reset",
        reopened: false,
      });
      host.fireVote("peer-1", "go");
      expect(svc.getSnapshot().countdown).not.toBeNull();
    });

    it("lets an abort go out again after a quickload to before the first one", async () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "CAPCOM");
      timeline.emitMet(10);
      host.fireAbort("peer-1");
      await drainDispatch();
      expect(svc.getSnapshot().abort).not.toBeNull();
      const before = abortDispatches().length;
      timeline.emitNewTimeline();
      expect(svc.getSnapshot().abort).toBeNull();
      host.fireAbort("peer-1");
      await drainDispatch();
      expect(abortDispatches().length).toBe(before + 1);
    });

    it("closes a reopened poll when the game starts a new timeline", () => {
      host.fireConnect("peer-1");
      timeline.emitMet(10);
      svc.reset();
      expect(svc.getSnapshot().reopened).toBe(true);
      timeline.emitNewTimeline();
      expect(svc.getSnapshot().reopened).toBe(false);
    });

    it("starts over when the craft comes back to the pad after a flight the game did not announce as a new timeline", () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      timeline.emitMet(10);
      svc.reset();
      host.fireVote("peer-1", "go");
      host.broadcasts.length = 0;
      timeline.emitOnPad();
      expect(svc.getSnapshot().stations[0]?.status).toBeNull();
      expect(host.broadcasts).toContainEqual({
        type: "gonogo-reset",
        reopened: false,
      });
    });

    it("sees a revert that happened while a replay was showing", () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      timeline.emitOnPad();
      host.fireVote("peer-1", "no-go");
      const replay = new FakeTimelineStore();
      setActiveTimelineStoreForTests(replay);
      replay.emitOnPad();
      timeline.emitNewTimeline();
      setActiveTimelineStoreForTests(timeline);
      timeline.emitOnPad();
      expect(svc.getSnapshot().stations[0]?.status).toBeNull();
    });

    it("takes a store's first sample as its starting epoch, not as a new timeline", () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      const fresh = new FakeTimelineStore();
      fresh.withholdSamples();
      setActiveTimelineStoreForTests(fresh);
      fresh.emitOnPad();
      host.fireVote("peer-1", "no-go");
      fresh.deliverFirstSample(4);
      expect(svc.getSnapshot().stations[0]?.status).toBe("no-go");
    });

    describe("a replay taking over the stream", () => {
      function replayStore() {
        const replay = new FakeTimelineStore();
        replay.emitOnPad();
        return replay;
      }

      it("does not reset the live poll when a replay starts or ends", () => {
        host.fireConnect("peer-1");
        host.fireStationInfo("peer-1", "A");
        timeline.emitOnPad();
        host.fireVote("peer-1", "no-go");
        host.broadcasts.length = 0;
        const replay = replayStore();
        setActiveTimelineStoreForTests(replay);
        replay.emitOnPad();
        setActiveTimelineStoreForTests(timeline);
        timeline.emitOnPad();
        expect(svc.getSnapshot().stations[0]?.status).toBe("no-go");
        expect(host.broadcasts).toEqual([]);
      });

      it("still resets when the live store's own epoch goes up afterwards", () => {
        host.fireConnect("peer-1");
        host.fireStationInfo("peer-1", "A");
        timeline.emitOnPad();
        const replay = replayStore();
        setActiveTimelineStoreForTests(replay);
        replay.emitOnPad();
        setActiveTimelineStoreForTests(timeline);
        timeline.emitOnPad();
        host.fireVote("peer-1", "no-go");
        timeline.emitNewTimeline();
        expect(svc.getSnapshot().stations[0]?.status).toBeNull();
      });
    });

    it("keeps a vote across frames of the same craft, and across a station reconnecting", () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      host.fireConnect("peer-2");
      host.fireStationInfo("peer-2", "B");
      timeline.emitOnPad();
      host.fireVote("peer-1", "no-go");
      host.fireVote("peer-2", "go");
      timeline.emitOnPad();
      host.fireDisconnect("peer-2");
      host.fireConnect("peer-2");
      host.fireStationInfo("peer-2", "B");
      host.broadcasts.length = 0;
      timeline.emitOnPad();
      expect(svc.getSnapshot().stations[0]?.status).toBe("no-go");
      expect(host.broadcasts).toEqual([]);
    });

    it("does not reset on the first frame the host ever sees", () => {
      host.fireConnect("peer-1");
      host.fireStationInfo("peer-1", "A");
      host.fireVote("peer-1", "no-go");
      host.broadcasts.length = 0;
      timeline.emitOnPad();
      expect(svc.getSnapshot().stations[0]?.status).toBe("no-go");
      expect(host.broadcasts).toEqual([]);
    });
  });

  it("reads a craft back on the pad as not launched, which a revert to launch needs", () => {
    /* The stream sends no launch clock in PreLaunch, so `met` is null on the pad
       rather than 0, and the situation is the only thing left that says so. */
    host.fireConnect("peer-1");
    timeline.emitMet(10);
    host.fireAbort("peer-1");
    expect(svc.getSnapshot().launched).toBe(true);

    timeline.emitOnPad();

    expect(svc.getSnapshot().launched).toBe(false);
    expect(svc.getSnapshot().abort).toBeNull();
    host.fireVote("peer-1", "go");
    expect(svc.getSnapshot().countdown).not.toBeNull();
  });

  it("reports launched for a craft that has lifted off and is under physics, with the abort gate open", async () => {
    /*
     * The frames the mod sends for a craft that has left the pad, every one
     * stamped Loaded, rather than a driven `met`. Mission time is the view UT
     * less `vessel.identity.launchUt`, and a read that nulled it under physics
     * would leave the ascent unlaunched and the abort gate shut.
     */
    const ascentTransport = new StubTransport();
    const ascentClient = new TelemetryClient(ascentTransport);
    const clock = new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    clock.scrubTo(1_042);
    const ascentStore = new TimelineStore(clock);
    ascentClient.attachStore(ascentStore);
    for (const topic of ["vessel.orbit", "vessel.flight", "vessel.identity"]) {
      ascentClient.subscribe(topic, () => {});
    }
    const sent: string[] = [];
    ascentTransport.setCommandHandler((command) => {
      sent.push(command);
      return null;
    });
    setActiveTelemetryClientForTests(ascentClient);
    setActiveTimelineStoreForTests(ascentStore);
    setActiveViewClockForTests(clock);

    const vessel = "8de0da0e-f691-4327-98bf-fb37cc322b92";
    const meta = { source: `vessel:${vessel}`, quality: Quality.Loaded };
    const loaded = { quality: Quality.Loaded, validAt: 1_042 };
    ascentTransport.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 420_000,
        ecc: 0.6,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 1_042,
        mu: 3.5316e12,
        patches: [],
        horizon: {
          kind: PropagationHorizonKind.Unbounded,
          trajectoryKind: TrajectoryKind.Analytic,
        },
        meta,
      },
      loaded,
    );
    ascentTransport.emit(
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
      loaded,
    );
    ascentTransport.emit(
      "vessel.identity",
      {
        vesselId: vessel,
        name: "Sally-Hut 1",
        vesselType: 0,
        situation: Situation.Flying,
        parentBodyIndex: 1,
        launchUt: 1_000,
        meta,
      },
      loaded,
    );
    host.fireConnect("peer-1");
    host.fireStationInfo("peer-1", "FLIGHT");
    ascentStore.beginFrame();

    expect(svc.getSnapshot().launched).toBe(true);
    host.fireAbort("peer-1");
    await drainDispatch();
    expect(svc.getSnapshot().abort?.stationName).toBe("FLIGHT");
    expect(sent).toContain("vessel.control.setAbort");
    ascentClient.dispose();
  });

  describe("one poll per command centre", () => {
    const A = "ground:Outpost A";
    const B = "ground:Outpost B";

    /** A peer host that also says where each remote station's session stands. */
    class CentredHost extends FakeHost {
      readonly sessionCentre = new Map<string, string>();
      centreOf(peerId: string): string | null {
        return this.sessionCentre.get(peerId) ?? null;
      }
      onCentresChanged(_cb: () => void) {
        return () => {};
      }
      fireInfo(
        peerId: string,
        info: { name: string; seat?: "pilot"; centre?: string },
      ) {
        for (const cb of this.listeners.stationInfo) cb(peerId, info);
      }
    }

    let centred: CentredHost;
    let polls: GoNoGoHostService;
    let hostCentre: string | null;
    let jobsTransport: StubTransport;
    let jobs: HostJobs;

    beforeEach(() => {
      centred = new CentredHost();
      hostCentre = A;
      jobsTransport = new StubTransport();
      jobsTransport.setCommandHandler(() => null);
      jobs = new HostJobs();
      jobs.setClient(new TelemetryClient(jobsTransport));
      polls = new GoNoGoHostService(centred.asHost(), {
        hostCentre: () => hostCentre,
        commandFrom: (centre) => jobs.commandClientAt(centre),
      });
      polls.setConfig({ countdownLengthMs: 5_000 });
      centred.fireConnect("station-a");
      centred.sessionCentre.set("station-a", A);
      centred.fireInfo("station-a", { name: "ALPHA" });
      centred.fireConnect("local-b");
      centred.fireInfo("local-b", { name: "BRAVO", centre: B });
      centred.fireConnect("pilot");
      centred.fireInfo("pilot", { name: "PILOT", seat: "pilot" });
    });

    afterEach(() => {
      polls.dispose();
      jobs.client?.dispose();
    });

    const toldTo = (peerId: string) =>
      centred.sent.filter((s) => s.peerId === peerId).map((s) => s.msg.type);

    it("counts only the votes at its own centre, and tells only that centre's screens", () => {
      centred.fireVote("station-a", "go");
      centred.fireVote("local-b", "no-go");

      expect(polls.getSnapshot()).toMatchObject({
        centre: A,
        stations: [{ peerId: "station-a", status: "go" }],
      });
      expect(polls.getSnapshot().countdown).not.toBeNull();
      expect(toldTo("station-a")).toContain("gonogo-countdown-start");
      expect(toldTo("local-b")).not.toContain("gonogo-countdown-start");
      expect(toldTo("pilot")).not.toContain("gonogo-countdown-start");
    });

    it("shows a host at the other centre that centre's poll and none of the first", () => {
      centred.fireVote("station-a", "go");
      hostCentre = B;

      expect(polls.getSnapshot()).toMatchObject({
        centre: B,
        stations: [{ peerId: "local-b", status: null }],
        countdown: null,
      });
    });

    it("gives a pilot no poll, and a pilot's vote starts nothing", () => {
      centred.fireVote("pilot", "go");

      expect(polls.getSnapshot().countdown).toBeNull();
      expect(polls.getSnapshot().stations.map((s) => s.peerId)).not.toContain(
        "pilot",
      );
      hostCentre = null;
      expect(polls.getSnapshot()).toMatchObject({ centre: null, stations: [] });
    });

    it("sends the GO from its own centre through the jobs connection, while the screen's own display sits elsewhere", async () => {
      centred.fireVote("station-a", "go");
      vi.advanceTimersByTime(5_001);
      await drainDispatch();

      expect(jobsTransport.sentCommands).toEqual([
        expect.objectContaining({ vantage: A }),
      ]);
      expect(transport.sentCommands).toEqual([]);
    });

    it("never fires a poll still open when the host steps down", async () => {
      centred.fireVote("station-a", "go");
      polls.dispose();
      vi.advanceTimersByTime(10_000);
      await drainDispatch();

      expect(jobsTransport.sentCommands).toEqual([]);
      expect(transport.sentCommands).toEqual([]);
    });
  });
});
