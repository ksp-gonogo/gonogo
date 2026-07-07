/**
 * Courier is the reference delay engine for both TELEMETRY (streams) and
 * COMMANDS (round-trip request/response).
 *
 * Streams: a sample recorded at UT `V` for a node/topic is delivered to a
 * subscribing Vantage at UT `V + network.delayTo(vantage, node)`, scheduled
 * on the Clock and read back through that node's Archive at the vantage's
 * own cursor.
 *
 * Commands: symmetric uplink/downlink. A command dispatched at `t0` travels
 * uplink and executes on the node at `t0 + up`, then its confirmation
 * travels downlink and is delivered back to the vantage at
 * `t0 + up + down` (up === down === network.delayTo(vantage, node)). If the
 * node is unreachable at dispatch time, the command is dropped with honest
 * silence — no execute, no response.
 */
import {
  type CommandResponse,
  type Meta,
  Quality,
  Staleness,
  type StreamData,
} from "@gonogo/sitrep-sdk";
import { Archive } from "./archive";
import type { Clock } from "./clock";
import type { Network } from "./stub-network";

interface Subscriber {
  vantage: string;
  onData: (msg: StreamData<unknown>) => void;
}

type CommandHandler = (command: string, args: unknown, node: string) => unknown;

export class Courier {
  private readonly clock: Clock;
  private readonly network: Network;
  // node -> Archive (one archive per node, shared across all topics on it).
  private readonly archives = new Map<string, Archive>();
  // node -> topic -> subscribers for that (node, topic) pair. Nested map
  // (rather than a string-concat key) so there's no collision risk between
  // e.g. node "a" topic "bc" and node "ab" topic "c".
  private readonly subscribers = new Map<
    string,
    Map<string, Set<Subscriber>>
  >();
  private seq = 0;
  private commandHandler: CommandHandler = () => undefined;

  constructor(deps: { clock: Clock; network: Network }) {
    this.clock = deps.clock;
    this.network = deps.network;
  }

  /** Set the handler invoked (on the vessel, at uplink UT) to execute a dispatched command. */
  setCommandHandler(fn: CommandHandler): void {
    this.commandHandler = fn;
  }

  /**
   * Expected wall-clock (UT) duration of a full command round trip between
   * `vantage` and `node`: uplink + downlink, i.e. twice the one-way delay.
   * Used by callers (e.g. client-side loss inference, Task 8) to size an ETA
   * timeout without duplicating the uplink===downlink assumption baked into
   * `dispatchCommand`.
   */
  roundTripEta(node: string, vantage: string): number {
    return 2 * this.network.delayTo(vantage, node);
  }

  /**
   * Dispatch a command from `vantage` to `node`. Symmetric uplink/downlink:
   * the command travels uplink and executes at `t0 + up`, then the
   * confirmation travels downlink and is delivered at `t0 + up + down`
   * (up === down === network.delayTo(vantage, node)).
   *
   * Honest silence on loss: if `node` is unreachable from `vantage` at
   * dispatch time, the command is dropped entirely — the handler never
   * runs and `onResponse` never fires. The client is expected to infer
   * loss via ETA timeout rather than an explicit error response.
   */
  dispatchCommand(
    node: string,
    requestId: string,
    command: string,
    args: unknown,
    vantage: string,
    onResponse: (msg: CommandResponse<unknown>) => void,
  ): void {
    if (!this.network.reachable(vantage, node)) {
      return;
    }

    const up = this.network.delayTo(vantage, node);
    const down = up;
    const t0 = this.clock.now();
    const executeUt = t0 + up;
    const confirmUt = executeUt + down;

    this.clock.schedule(executeUt, () => {
      const result = this.commandHandler(command, args, node);
      this.clock.schedule(confirmUt, () => {
        onResponse(
          this.commandResponse(
            requestId,
            result,
            node,
            vantage,
            executeUt,
            confirmUt,
          ),
        );
      });
    });
  }

  /** Record a SCET-stamped sample and schedule its delayed delivery to every current subscriber. */
  record(node: string, topic: string, value: unknown, validAtUt: number): void {
    this.archiveFor(node).record(topic, value, validAtUt);

    const subs = this.subscribers.get(node)?.get(topic);
    if (!subs) {
      return;
    }

    // Snapshot the current subscriber set: later subscribes/unsubscribes
    // must not affect delivery of this already-recorded sample.
    for (const subscriber of [...subs]) {
      const delay = this.network.delayTo(subscriber.vantage, node);
      // Capture this delivery's own fire-UT now: under a single large
      // advanceTo() jump, several deliveries can drain in the same batch,
      // and each must read/report its own arrival time rather than
      // whatever clock.now() happens to be when it fires (see deliver()).
      const fireUt = validAtUt + delay;
      this.clock.schedule(fireUt, () => {
        if (!subs.has(subscriber)) {
          // Unsubscribed before the delivery fired.
          return;
        }
        this.deliver(node, topic, subscriber, fireUt);
      });
    }
  }

  /**
   * Subscribe a Vantage to a (node, topic) stream. Immediately delivers a
   * catch-up of the latest already-arrived value (if any), schedules
   * delivery of every sample still in flight to this vantage (recorded
   * before the subscribe but not yet arrived), then returns an unsubscribe
   * function.
   */
  subscribeStream(
    node: string,
    topic: string,
    vantage: string,
    onData: (msg: StreamData<unknown>) => void,
  ): () => void {
    const subscriber: Subscriber = { vantage, onData };

    let byTopic = this.subscribers.get(node);
    if (!byTopic) {
      byTopic = new Map<string, Set<Subscriber>>();
      this.subscribers.set(node, byTopic);
    }
    let subs = byTopic.get(topic);
    if (!subs) {
      subs = new Set<Subscriber>();
      byTopic.set(topic, subs);
    }
    subs.add(subscriber);

    const delay = this.network.delayTo(vantage, node);
    const now = this.clock.now();

    // Catch-up: deliver whatever has already "arrived" at this vantage.
    this.deliver(node, topic, subscriber, now);

    // Also schedule delivery for every sample recorded before this
    // subscribe that is still in flight (validAt + delay > now). Without
    // this, a subscriber joining mid-transit gets neither the catch-up
    // (which only returns already-arrived samples) nor a record-time
    // schedule (record() only schedules for subscribers present at the
    // time it ran) — a permanent miss. "Arrived" (<= now, handled by the
    // catch-up above) and "in flight" (> now, handled here) are disjoint,
    // so this never double-delivers.
    for (const sample of this.archiveFor(node).samples(topic)) {
      const fireUt = sample.validAt + delay;
      if (fireUt <= now) {
        continue;
      }
      this.clock.schedule(fireUt, () => {
        if (!subs.has(subscriber)) {
          return;
        }
        this.deliver(node, topic, subscriber, fireUt);
      });
    }

    return () => {
      subs?.delete(subscriber);
    };
  }

  /**
   * Deliver to `subscriber` as of `fireUt` — the UT this delivery was
   * scheduled to fire at (or `clock.now()` for a synchronous catch-up).
   * Callers MUST pass the delivery's own scheduled fire-UT rather than
   * re-reading `clock.now()`: ManualClock.advanceTo() sets `now` to the
   * target UT before draining callbacks, so several deliveries firing
   * within one advanceTo() call would otherwise all read the same `now()`
   * and compute the same scene, delivering the latest sample repeatedly
   * and silently dropping earlier ones.
   */
  private deliver(
    node: string,
    topic: string,
    subscriber: Subscriber,
    fireUt: number,
  ): void {
    // Recomputed here rather than reusing the delay captured at record()/
    // subscribe() time — this assumes the delay is unchanged between when
    // the delivery was scheduled and when it fires (true for M3's static
    // point-to-point model). A dynamic/mid-flight delay change is M3b,
    // where the archive's freeze clamp (see readAtVantage) would engage.
    const delay = this.network.delayTo(subscriber.vantage, node);
    const sample = this.archiveFor(node).readAtVantage(
      topic,
      subscriber.vantage,
      delay,
      fireUt,
    );
    if (!sample) {
      return;
    }
    subscriber.onData(
      this.streamData(node, topic, subscriber.vantage, sample, fireUt),
    );
  }

  private streamData(
    node: string,
    topic: string,
    vantage: string,
    sample: { value: unknown; validAt: number },
    deliveredAt: number,
  ): StreamData<unknown> {
    return {
      type: "stream-data",
      topic,
      payload: sample.value,
      meta: this.makeMeta(node, vantage, sample.validAt, deliveredAt),
    };
  }

  private commandResponse(
    requestId: string,
    result: unknown,
    node: string,
    vantage: string,
    validAt: number,
    deliveredAt: number,
  ): CommandResponse<unknown> {
    return {
      type: "command-response",
      requestId,
      result,
      meta: this.makeMeta(node, vantage, validAt, deliveredAt),
    };
  }

  private makeMeta(
    node: string,
    vantage: string,
    validAt: number,
    deliveredAt: number,
  ): Meta {
    return {
      source: node,
      validAt,
      seq: this.nextSeq(),
      deliveredAt,
      vantage,
      quality: Quality.OnRails,
      active: true,
      staleness: Staleness.Fresh,
      // Always 0 here: timelineEpoch (M2, local_docs/telemetry-mod/m2-sdk-delay-design.md
      // §1.1/§7.6) is incremented on a quickload/timeline-rewind, and
      // resetTimeline itself is a C#-ONLY addition with no TS reference
      // (same rationale as Sitrep.Core's SnapshotCommands/RestoreCommands
      // and ResetTimeline -- see their doc comments) -- this reference
      // Courier structurally never rewinds, so its epoch never advances.
      timelineEpoch: 0,
    };
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private archiveFor(node: string): Archive {
    let archive = this.archives.get(node);
    if (!archive) {
      archive = new Archive();
      this.archives.set(node, archive);
    }
    return archive;
  }
}
