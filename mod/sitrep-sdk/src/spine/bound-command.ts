import type {
  AnyBoundCommand,
  BoundCommand,
  BoundCommandOptions,
  CommandSetOptions,
  CommandSetResult,
  UseCommandResult,
  ValueCommand,
} from "../api/types";
import type { AnyCommandReply } from "../commands";
import type { SendStatus } from "./send-status";

/** What binding a command needs of a handle: a way to send it. */
interface SendsCommand {
  dangerouslySendWithoutInput(
    args?: never,
    opts?: { label?: string; topic?: string },
  ): Promise<unknown>;
}

type ArgsOf<Handle> = Handle extends {
  dangerouslySendWithoutInput(args?: infer Args, ...rest: never[]): unknown;
}
  ? Args
  : never;

type ReplyOf<Handle> = Handle extends {
  dangerouslySendWithoutInput(...rest: never[]): Promise<infer Reply>;
}
  ? Reply
  : never;

/**
 * Binds `handle` to its arguments and the things that happen around the press.
 * Useful for naming what one control sends. Used by `useCommand`'s `with`, and
 * by a kit input given a bare handle.
 *
 * @category Commands
 */
export function bindCommand<Handle extends SendsCommand>(
  handle: Handle,
  args: ArgsOf<Handle> | (() => ArgsOf<Handle>) | undefined,
  options: BoundCommandOptions<ArgsOf<Handle>, ReplyOf<Handle>> = {},
): BoundCommand<ArgsOf<Handle>, ReplyOf<Handle>, Handle> {
  return { kind: "bound", handle, args, options };
}

/**
 * Binds `handle` to a way to turn an input's value into arguments. Useful for
 * an input that sets a value. Used by `useCommand`'s `toArgs`.
 *
 * @category Commands
 */
export function bindValue<Value, Handle extends SendsCommand>(
  handle: Handle,
  toArgs: (value: Value) => ArgsOf<Handle> | undefined,
  options: BoundCommandOptions<ArgsOf<Handle>, ReplyOf<Handle>> = {},
): ValueCommand<Value, ArgsOf<Handle>, ReplyOf<Handle>, Handle> {
  return { kind: "value", handle, toArgs, options };
}

/**
 * The arguments a bound command sends now: its `args` called when it is a
 * function. Useful for a control that reads the arguments at the press.
 *
 * @category Commands
 */
export function argsOf<Args>(
  // biome-ignore lint/suspicious/noExplicitAny: any handle and reply
  command: BoundCommand<Args, any, any>,
): Args | undefined {
  const args = command.args;
  return typeof args === "function" ? (args as () => Args)() : args;
}

function worstSendStatus(
  statuses: readonly (SendStatus | undefined)[],
): SendStatus | undefined {
  const known = statuses.filter((s): s is SendStatus => s !== undefined);
  return (
    known.find((s) => s.arrival === "likely-lost") ??
    known.find((s) => s.sends === "held") ??
    known[0]
  );
}

function foldStatus(
  members: readonly UseCommandResult[],
): UseCommandResult["status"] {
  const statuses = members.map((m) => m.status);
  return (
    statuses.find((s) => s.phase === "in-flight" && s.accepted !== true) ??
    statuses.find((s) => s.phase === "in-flight") ??
    statuses.find((s) => s.phase !== "idle") ?? { phase: "idle" }
  );
}

/**
 * One handle standing for every member's, so an input reads a set like one
 * command: its face is sent until every member is answered, refused if any is
 * refused, held or expected to be lost if any is, and blocked if any is.
 */
function foldHandles(members: readonly AnyBoundCommand[]): UseCommandResult {
  const handles: UseCommandResult[] = members.map((m) => m.handle);
  const first = handles[0];
  const gates = handles.map((h) => h.gate);
  const blockedGate = gates.find((g) => g?.blocked === true);
  const concat = <
    Key extends
      | "inFlight"
      | "warnings"
      | "refusals"
      | "losses"
      | "founds"
      | "undelivered"
      | "failures",
  >(
    key: Key,
  ) => handles.flatMap((h) => h[key] as unknown[]) as UseCommandResult[Key];
  const folded: UseCommandResult = {
    dangerouslySendWithoutInput: () =>
      runSet(members, {}).then(() => ({ success: true }) as AnyCommandReply),
    status: foldStatus(handles),
    inFlight: concat("inFlight"),
    warnings: concat("warnings"),
    tags: first?.tags as UseCommandResult["tags"],
    effectiveDelaySeconds: handles.reduce<number | null>(
      (max, h) =>
        h.effectiveDelaySeconds === null
          ? max
          : Math.max(max ?? 0, h.effectiveDelaySeconds),
      null,
    ),
    delayReading: first?.delayReading ?? null,
    delayMode: first?.delayMode ?? null,
    sendStatus: worstSendStatus(handles.map((h) => h.sendStatus)),
    dismiss: (id) => {
      for (const h of handles) h.dismiss(id);
    },
    railed: handles.length > 0 && handles.every((h) => h.railed),
    refusals: concat("refusals"),
    losses: concat("losses"),
    founds: concat("founds"),
    undelivered: concat("undelivered"),
    streamDown: handles.some((h) => h.streamDown),
    failures: concat("failures"),
    gate: blockedGate ?? gates.find((g) => g !== undefined),
    gateFor: () => blockedGate ?? gates.find((g) => g !== undefined),
    with: (args, options) => bindCommand(folded, args, options),
    toArgs: (toArgs, options) => bindValue(folded, toArgs, options),
  };
  return folded;
}

/**
 * Sends every member of a set, in `order`, and reports how it went. Useful for
 * a control that clears every node or commits two commands with one press.
 * Used by `commandSet`'s handle and by a kit input pressing a set.
 *
 * @category Commands
 */
export async function runSet(
  members: readonly AnyBoundCommand[],
  set: CommandSetOptions,
): Promise<CommandSetResult> {
  const result: CommandSetResult = {
    total: members.length,
    confirmed: 0,
    failed: 0,
  };
  const send = (member: AnyBoundCommand) => {
    const args = argsOf(member);
    member.options.before?.(args);
    const label = member.options.label;
    return member.handle
      .dangerouslySendWithoutInput(args, label ? { label } : undefined)
      .then(
        (reply: unknown) => {
          result.confirmed++;
          member.options.onConfirmed?.(reply);
        },
        (error: unknown) => {
          result.failed++;
          result.firstError ??= error;
          member.options.onRejected?.(error);
          return Promise.reject(error);
        },
      );
  };
  if (set.order === "one-at-a-time") {
    for (const member of members) {
      try {
        await send(member);
      } catch {
        if (set.stopAtFirstFailure) break;
      }
    }
  } else {
    await Promise.allSettled(members.map(send));
  }
  set.onSettled?.(result);
  return result;
}

/**
 * Several commands sent by one press, in the order given, and shown on the
 * control as one. Useful for an action such as clearing every node. Taken by
 * the `command` prop of a kit input. Each command keeps its own row on the delay
 * rail. `at-once` sends them together; `one-at-a-time` waits for each answer
 * and carries on past a refusal unless `stopAtFirstFailure` is set. A member
 * that is `false`, `null` or `undefined` is left out, so a conditional member
 * can be written inline.
 *
 * @category Commands
 */
export function commandSet(
  members: readonly (AnyBoundCommand | false | null | undefined)[],
  set: CommandSetOptions = {},
): BoundCommand {
  const listed = members.filter(
    (m): m is AnyBoundCommand => m !== false && m != null,
  );
  return {
    kind: "bound",
    handle: foldHandles(listed),
    args: undefined,
    options: {},
    members: listed,
    set,
  };
}
