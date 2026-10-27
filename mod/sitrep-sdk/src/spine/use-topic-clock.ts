import { useMemo, useSyncExternalStore } from "react";
import { Staleness } from "../__generated__/contract";
import type { TelemetryClient } from "./client";
import {
  useTelemetryClientOptional,
  useViewClockOptional,
  type ViewClockView,
} from "./context";
import { ViewClock } from "./view-clock";

/**
 * Whether a Topic's own samples are arriving: `"unknown"` before the first one,
 * `"live"` while they keep coming, `"silent"` once the game has run on for
 * {@link TOPIC_SILENCE_SECONDS} of UT without a new one.
 *
 * @category Delay and vantage
 */
export type TopicLinkState = "unknown" | "live" | "silent";

/**
 * UT seconds without a new live sample after which a Topic's link reads
 * `"silent"`. Counted in game time, so a paused game never reads as silent.
 */
export const TOPIC_SILENCE_SECONDS = 5;

/**
 * A clock for one Topic: what {@link useTopicClock} returns.
 *
 * @category Delay and vantage
 */
export interface TopicClockState {
  /**
   * The clock to release this Topic's media against, or `undefined` with no
   * telemetry stream mounted. It stands at `-Infinity` until the first sample
   * arrives, so media released against it is held, never shown early.
   */
  readonly clock: ViewClockView | undefined;
  /** Whether the Topic's samples are arriving. */
  readonly link: TopicLinkState;
  /**
   * The one-way delay in seconds the Topic's newest live sample was held for,
   * or `undefined` before one has arrived. It is the last delay seen, so it is
   * still present while `link` is `"silent"`.
   */
  readonly delaySeconds: number | undefined;
}

const NO_STREAM: TopicClockState = {
  clock: undefined,
  link: "unknown",
  delaySeconds: undefined,
};

/*
 * One clock per (client, topic), fed only by that Topic's own arrivals.
 *
 * The shared view clock holds every delayed Topic back by the active craft's
 * delay, so a feed released against it borrows that delay whatever site it
 * stands at. The mod already holds each per-site Topic for its own site's
 * delay before sending it, so the Topic's own samples carry the delay: a
 * sample's `deliveredAt - validAt` is the delay it was held for, and a
 * ViewClock that sees only those samples reports a confirmed edge at that
 * site's own delay.
 *
 * A replayed (recorded) sample describes the past and is delivered while the
 * craft may still be out of contact, so it moves neither the delay nor the
 * liveness instant.
 */
class TopicClockSource {
  private delaySeconds = 0;
  private heard = false;
  private lastDeliveredAt: number | undefined;
  private current: TopicClockState;
  private readonly listeners = new Set<() => void>();
  private release: (() => void) | undefined;
  private releaseFrames: (() => void) | undefined;

  readonly clock: ViewClock;

  constructor(
    private readonly client: TelemetryClient,
    private readonly topic: string,
    private readonly view: ViewClockView | undefined,
  ) {
    this.clock = new ViewClock({ delaySeconds: () => this.delaySeconds });
    this.current = NO_SAMPLES(this.clock);
  }

  snapshot = (): TopicClockState => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.topic !== "") {
      this.release = this.client.subscribeFrames(this.topic, (_v, meta) => {
        if (!meta) return;
        const replayed = meta.staleness === Staleness.Recorded;
        this.clock.observeSample(
          meta.validAt,
          meta.deliveredAt,
          meta.timelineEpoch,
          replayed,
        );
        if (!replayed) {
          this.delaySeconds = Math.max(0, meta.deliveredAt - meta.validAt);
          this.heard = true;
          this.lastDeliveredAt = Math.max(
            this.lastDeliveredAt ?? Number.NEGATIVE_INFINITY,
            meta.deliveredAt,
          );
        }
        this.refresh();
      });
      this.releaseFrames = this.view?.onFrame(() => this.refresh());
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.release?.();
        this.release = undefined;
        this.releaseFrames?.();
        this.releaseFrames = undefined;
      }
    };
  };

  private linkNow(): TopicLinkState {
    if (this.lastDeliveredAt === undefined) return "unknown";
    const present = this.presentUt();
    if (present === undefined) return "unknown";
    return present - this.lastDeliveredAt > TOPIC_SILENCE_SECONDS
      ? "silent"
      : "live";
  }

  /** The game's present as the shared clock last heard it, or undefined before it has heard anything. */
  private presentUt(): number | undefined {
    const view = this.view;
    if (!view || !Number.isFinite(view.confirmedEdgeUt())) return undefined;
    const ut = view.utNowEstimate();
    return Number.isFinite(ut) ? ut : undefined;
  }

  private refresh(): void {
    const link = this.linkNow();
    const delaySeconds = this.heard ? this.delaySeconds : undefined;
    if (
      link === this.current.link &&
      delaySeconds === this.current.delaySeconds
    ) {
      return;
    }
    this.current = { clock: this.clock, link, delaySeconds };
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * The clock and link state of one Topic read at its own delay, for a feed whose
 * site is not the active craft's. Useful for releasing a camera's video at the
 * delay of the place the camera stands and drawing it dark while its link is
 * silent, where the shared view clock would hold every camera to the active
 * craft's delay. Used by the camera feed for a camera on another craft or at a
 * ground station.
 *
 * Read `topic` as a Topic whose Uplink declared it delivered per site; the
 * clock follows that Topic's own arrivals, so a Topic held at the active
 * craft's delay yields that delay. The Topic stays subscribed while the caller
 * is mounted. `link` is `"unknown"` until a first sample arrives, and while
 * the Topic has never arrived the clock stands at `-Infinity`, so media is held
 * and never shown live. With no stream mounted the clock is `undefined`.
 *
 * @category Delay and vantage
 */
export function useTopicClock(topic: string): TopicClockState {
  const client = useTelemetryClientOptional();
  const view = useViewClockOptional();

  const source = useMemo(
    () => (client ? new TopicClockSource(client, topic, view) : undefined),
    [client, topic, view],
  );

  return useSyncExternalStore(
    source?.subscribe ?? NOOP_SUBSCRIBE,
    source?.snapshot ?? noStream,
  );
}

const NO_SAMPLES = (clock: ViewClock): TopicClockState => ({
  clock,
  link: "unknown",
  delaySeconds: undefined,
});

const NOOP_SUBSCRIBE = (): (() => void) => () => {};
const noStream = (): TopicClockState => NO_STREAM;
