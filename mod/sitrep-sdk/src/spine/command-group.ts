import type { AnyCommandReply } from "../commands";
import type { TelemetryClient } from "./client";
import {
  JOURNEY_TOPIC,
  PENDING_TOPIC,
  readJourney,
  readPendingLane,
} from "./comms-journey";
import {
  sendUplinkAction,
  UPLINK_CANCEL_COMMAND,
  type UplinkActionOutcome,
} from "./held-command-actions";

/**
 * One `send` captured by {@link sendTogether}: everything the frame needs, and
 * the hook's own bookkeeping to run once the frame has gone.
 *
 * @internal
 */
export interface CapturedSend {
  client: TelemetryClient;
  command: string;
  args: unknown;
  label?: string;
  topic?: string;
  vantage?: string;
  /** Whether the command is never delayed, which a group cannot carry. */
  instant: boolean;
  /** Starts the hook's tracking for the dispatch and returns the promise it hands its caller. */
  track(requestId: string, result: Promise<unknown>): Promise<AnyCommandReply>;
}

/**
 * Where a group sent with {@link sendTogether} has got to, folded over its members.
 *
 * @category Commands
 */
export type CommandGroupPhase = "in-flight" | "confirmed" | "failed" | "lost";

/**
 * Commands sent together with {@link sendTogether}: one message, one place in
 * the craft's command order, delivered whole or not at all.
 *
 * @category Commands
 */
export interface CommandGroupHandle {
  /** The group's id. */
  readonly id: string;
  /** The request id of each member, in the order they run. */
  readonly requestIds: readonly string[];
  /** Where the group has got to: `in-flight` until every member is answered, then `confirmed`, or `failed` or `lost` if any member was. */
  readonly status: CommandGroupPhase;
  /** Every member's reply, in order. Rejects with the first member's rejection. */
  readonly result: Promise<AnyCommandReply[]>;
  /** Stops the whole group while it is held or travelling, from the command centre that sent it. */
  cancel(): Promise<UplinkActionOutcome>;
}

interface Deferred {
  promise: Promise<AnyCommandReply>;
  resolve(value: AnyCommandReply): void;
  reject(reason: unknown): void;
}

function deferred(): Deferred {
  let resolve!: (value: AnyCommandReply) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<AnyCommandReply>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Handled without being consumed, as a single send's promise is: a member nobody awaits must not raise an unhandled rejection.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

interface Member {
  send: CapturedSend;
  settle: Deferred;
}

/** The group a `sendTogether` callback is filling, if one is running. */
let openGroup: OpenGroup | null = null;

class OpenGroup {
  readonly members: Member[] = [];
  private refusal: unknown;
  private refused = false;

  capture(send: CapturedSend): Promise<AnyCommandReply> {
    const settle = deferred();
    this.members.push({ send, settle });
    return settle.promise;
  }

  /** A member was refused before it left, so the group is: nothing is sent and every member rejects with it. */
  poison(error: unknown): void {
    if (!this.refused) {
      this.refused = true;
      this.refusal = error;
    }
  }

  rejectAll(error: unknown): void {
    for (const member of this.members) member.settle.reject(error);
  }

  get poisoned(): { error: unknown } | null {
    return this.refused ? { error: this.refusal } : null;
  }
}

/**
 * The group a send should join, or null when none is open. The hook behind
 * `useCommand` asks this on every send.
 *
 * @internal
 */
export function openCommandGroup(): {
  capture(send: CapturedSend): Promise<AnyCommandReply>;
  poison(error: unknown): void;
} | null {
  return openGroup;
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * The implementation behind `sendTogether` on the SDK root, which holds its
 * author-facing account. Callbacks that return a promise, nest, or break the
 * one-craft, one-centre, delayed-only rules throw, with nothing sent.
 */
export function sendTogether(build: () => void): CommandGroupHandle {
  if (openGroup !== null) {
    throw new Error(
      "sendTogether cannot be nested inside another sendTogether",
    );
  }
  const group = new OpenGroup();
  openGroup = group;
  let returned: unknown;
  try {
    returned = build();
  } catch (error) {
    group.rejectAll(error);
    throw error;
  } finally {
    openGroup = null;
  }
  if (isThenable(returned)) {
    const error = new Error(
      "sendTogether's callback must be synchronous: an await inside it would let an unrelated send fall into the group",
    );
    group.rejectAll(error);
    throw error;
  }
  return closeGroup(group);
}

function closeGroup(group: OpenGroup): CommandGroupHandle {
  const { members } = group;
  const fail = (error: Error): never => {
    group.rejectAll(error);
    throw error;
  };
  if (members.length === 0) {
    throw new Error("sendTogether needs at least one send inside it");
  }
  const poisoned = group.poisoned;
  if (poisoned) {
    group.rejectAll(poisoned.error);
    return refusedGroup(members);
  }
  const { client, vantage } = members[0].send;
  if (members.some((m) => m.send.client !== client)) {
    fail(
      new Error("the commands in a group must share one telemetry connection"),
    );
  }
  if (members.some((m) => (m.send.vantage ?? "") !== (vantage ?? ""))) {
    fail(
      new Error(
        "the commands in a group must all be sent from one command centre",
      ),
    );
  }
  const instant = members.find((m) => m.send.instant);
  if (instant) {
    fail(
      new Error(
        `${JSON.stringify(instant.send.command)} is never delayed, so it cannot go in a group`,
      ),
    );
  }

  let dispatched: ReturnType<TelemetryClient["dispatchGroup"]>;
  try {
    dispatched = client.dispatchGroup(
      members.map((m) => ({
        command: m.send.command,
        args: m.send.args,
        label: m.send.label,
        topic: m.send.topic,
      })),
      vantage,
    );
  } catch (error) {
    group.rejectAll(error);
    throw error;
  }

  dispatched.members.forEach((sent, index) => {
    const { send, settle } = members[index];
    send.track(sent.requestId, sent.result).then(settle.resolve, settle.reject);
  });
  const requestIds = dispatched.members.map((m) => m.requestId);
  const result = Promise.all(members.map((m) => m.settle.promise));
  result.catch(() => undefined);

  return {
    id: dispatched.groupId,
    requestIds,
    get status(): CommandGroupPhase {
      return phaseOf(client, requestIds);
    },
    result,
    cancel: () => cancelGroup(client, requestIds[0]),
  };
}

function refusedGroup(members: readonly Member[]): CommandGroupHandle {
  const result = Promise.all(members.map((m) => m.settle.promise));
  result.catch(() => undefined);
  return {
    id: "",
    requestIds: [],
    status: "failed",
    result,
    cancel: () => Promise.resolve({ refusal: "the group was never sent" }),
  };
}

function phaseOf(
  client: TelemetryClient,
  requestIds: readonly string[],
): CommandGroupPhase {
  const phases = requestIds.map((id) => client.getCommand(id).phase);
  if (phases.some((p) => p === "failed" || p === "undelivered"))
    return "failed";
  if (phases.some((p) => p === "lost")) return "lost";
  if (phases.every((p) => p === "confirmed" || p === "found"))
    return "confirmed";
  return "in-flight";
}

/** Cancels the group's place on its lane, found by the request id of its first member. */
async function cancelGroup(
  client: TelemetryClient,
  firstRequestId: string,
): Promise<UplinkActionOutcome> {
  const lane = readPendingLane(client.getValue(PENDING_TOPIC), firstRequestId);
  const journey = readJourney(client.getValue(JOURNEY_TOPIC));
  if (!lane || !journey) {
    return { refusal: "the group is not held or travelling" };
  }
  return sendUplinkAction(client, journey.epoch, UPLINK_CANCEL_COMMAND, {
    craft: lane.craft,
    laneSeq: lane.laneSeq,
    andBehind: false,
  });
}
