import {
  type AdaptiveShedPayload,
  CameraLifecycle,
  type CameraState,
  type KerbcastClientEvents,
  type KerbcastConnectionState,
} from "@ksp-gonogo/kerbcast";
import { type EventOccurrence, EventTimeline } from "@ksp-gonogo/sitrep-sdk";

/**
 * The synthetic event-stream topic id the kerbcast Uplink publishes its
 * discrete occurrences under. Not a codegen'd wire topic, the Uplink
 * SYNTHESISES it from kerbcast's raw edges. An `event`
 * alarm targets `{ kind: "event", topic: KERBCAST_EVENTS_TOPIC, eventKind }`.
 */
export const KERBCAST_EVENTS_TOPIC = "kerbcast.events";

export type KerbcastEventKind =
  | "camera-added"
  | "camera-removed"
  | "signal-lost"
  | "stream-degraded";

export interface CameraAddedPayload {
  flightId: number;
  partTitle: string;
  cameraName: string;
  vesselName: string;
}
export interface CameraRemovedPayload {
  flightId: number;
}
export interface SignalLostPayload {
  /** The affected camera, when the loss is camera-scoped (destruction). */
  flightId?: number;
  /** Why the feed went dark: `camera-destroyed` | `scene-unloaded` | `connection-<state>`. */
  reason: string;
}
export interface StreamDegradedPayload {
  /** 0.0 perfect .. 1.0 max degradation. */
  level: number;
  kspFps: number;
  reason: string;
}

/**
 * Structural view of the kerbcast SDK client the producer needs, the edge
 * event bus plus the capture clock. `KerbcastClient` satisfies this; tests
 * drive a fake emitter so no WebRTC is needed.
 */
export interface KerbcastEdgeSource {
  on<K extends keyof KerbcastClientEvents>(
    event: K,
    handler: (payload: KerbcastClientEvents[K]) => void,
  ): () => void;
  readonly clock: { captureUt: number | null; epoch: number };
}

/**
 * Synthesises the reveal-gated `event` primitive from kerbcast's existing
 * discrete edges. This is the FIRST producer of the `event` stream primitive
 * (`EventTimeline` in `@ksp-gonogo/sitrep-sdk`); it owns the reveal/delay
 * semantics the kerbcast SDK deliberately doesn't carry.
 *
 * Occurrence timing: each edge is stamped with `client.clock.captureUt`, the
 * KSP UT the current video frame was captured at, i.e. live real-time. The
 * consumer reads `revealed(now)` at the operator's DELAYED view UT
 * (`getViewUt`), so an occurrence only becomes visible once the view clock
 * catches up past `captureUt`: the signal delay realised by construction, no
 * explicit delay term needed. Meta edges (`signal-lost`) are intentionally NOT
 * connectivity-gated: gating a signal-loss event on connectivity-at-its-own-ut
 * would drop the very event that reports the loss.
 *
 * Client rebuilds: `KerbcastDataSource` rebuilds its `KerbcastClient` on
 * reconnect / reconfigure / broker-attach, orphaning listeners on the old
 * instance. The producer is re-`attach`ed each rebuild (and `detach`ed on
 * teardown), and resets its camera baseline per attach so a reconnect doesn't
 * replay the whole camera set as fresh adds.
 */
export class KerbcastEventProducer {
  private readonly timeline: EventTimeline<KerbcastEventKind>;
  private client: KerbcastEdgeSource | null = null;
  private unsubs: Array<() => void> = [];
  /** Last-seen camera lifecycle by flightId. `null` until the first snapshot. */
  private knownCameras: Map<number, CameraLifecycle> | null = null;
  /** Guards spurious signal-lost on a fresh client's initial connecting phase. */
  private hasConnected = false;

  constructor(
    timeline: EventTimeline<KerbcastEventKind> = new EventTimeline(),
  ) {
    this.timeline = timeline;
  }

  /** The occurrence buffer: exposed for the host reader, tests, diagnostics. */
  get events(): EventTimeline<KerbcastEventKind> {
    return this.timeline;
  }

  /** Subscribe to a client's edges. Detaches any prior client first. */
  attach(client: KerbcastEdgeSource): void {
    this.detach();
    this.client = client;
    this.knownCameras = null;
    this.hasConnected = false;
    this.unsubs.push(
      client.on("cameras-change", (cams) => {
        this.onCameras(cams);
      }),
      client.on("adaptive-shed", (payload) => {
        this.onShed(payload);
      }),
      client.on("scene-change", (inFlight) => {
        this.onScene(inFlight);
      }),
      client.on("state-change", (state) => {
        this.onState(state);
      }),
    );
  }

  /** Unsubscribe from the current client. */
  detach(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.client = null;
  }

  /**
   * Occurrences revealed at the operator's (delayed) view UT `now`. Returns
   * empty when `now` is unknown (no stream mounted / pre-first-frame).
   */
  revealed(
    now: number | null | undefined,
  ): readonly EventOccurrence<KerbcastEventKind>[] {
    if (now == null) return [];
    return this.timeline.revealed({ now });
  }

  private onCameras(cams: readonly CameraState[]): void {
    const next = new Map<number, CameraLifecycle>();
    for (const c of cams)
      next.set(c.flightId, c.lifecycle ?? CameraLifecycle.Active);

    if (this.knownCameras === null) {
      // First snapshot after (re)connect: establish the baseline silently.
      // Cameras already present when we start watching aren't "added".
      this.knownCameras = next;
      return;
    }

    const prev = this.knownCameras;
    for (const c of cams) {
      const before = prev.get(c.flightId);
      if (before === undefined) {
        this.emit<CameraAddedPayload>("camera-added", {
          flightId: c.flightId,
          partTitle: c.partTitle,
          cameraName: c.cameraName,
          vesselName: c.vesselName,
        });
      } else if (
        before !== CameraLifecycle.Destroyed &&
        (c.lifecycle ?? CameraLifecycle.Active) === CameraLifecycle.Destroyed
      ) {
        this.emit<SignalLostPayload>("signal-lost", {
          flightId: c.flightId,
          reason: "camera-destroyed",
        });
      }
    }
    for (const flightId of prev.keys()) {
      if (!next.has(flightId)) {
        this.emit<CameraRemovedPayload>("camera-removed", { flightId });
      }
    }
    this.knownCameras = next;
  }

  private onShed(payload: AdaptiveShedPayload): void {
    // level 0 is a recovery-to-nominal shed; only a genuine degradation is an
    // event worth alarming on.
    if (payload.level > 0) {
      this.emit<StreamDegradedPayload>("stream-degraded", {
        level: payload.level,
        kspFps: payload.kspFps,
        reason: payload.reason,
      });
    }
  }

  private onScene(inFlight: boolean | undefined): void {
    if (inFlight === false) {
      this.emit<SignalLostPayload>("signal-lost", { reason: "scene-unloaded" });
    }
  }

  private onState(state: KerbcastConnectionState): void {
    if (state === "connected") {
      this.hasConnected = true;
      return;
    }
    if ((state === "failed" || state === "disconnected") && this.hasConnected) {
      this.emit<SignalLostPayload>("signal-lost", {
        reason: `connection-${state}`,
      });
    }
  }

  private emit<P>(kind: KerbcastEventKind, payload: P): void {
    const clock = this.client?.clock;
    // No capture UT yet (old sidecar, or before the first ~1Hz clock push):
    // there's no UT to place the occurrence on, so drop it rather than guess.
    if (!clock || clock.captureUt == null) return;
    this.timeline.append({
      ut: clock.captureUt,
      kind,
      payload,
      epoch: clock.epoch,
    });
  }
}
