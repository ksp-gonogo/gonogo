import type { UseCommandResult } from "../api/types";
import type { AnyCommandReply } from "../commands";
import { UNDECLARED_COMMAND_RAIL_TAGS } from "../rail-tags";
import { bindCommand, bindValue } from "../spine/bound-command";

/**
 * A command handle for a test: it records what was sent, answers each send as
 * the test says, and lets the test change any field a kit input reads.
 * Useful for testing a widget or an input against a command without a stream to
 * the mod. Returned by {@link createFakeCommand}.
 *
 * @category Test doubles
 */
export interface FakeCommand<Args = unknown, Reply = AnyCommandReply> {
  /** The handle to give to the code under test, or to take `with` and `toArgs` from. */
  readonly handle: UseCommandResult<Args, Reply>;
  /** Every send so far, in order. */
  readonly sent: { args: Args | undefined; label?: string; topic?: string }[];
  /** Answers every held send with `reply`, and returns how many it answered. */
  confirm(reply?: Reply): number;
  /** Rejects every held send as the game refusing it, with the game's own words in `detail`. */
  refuse(detail?: string): number;
  /** Rejects every held send as having got no reply. */
  lose(): number;
  /** Changes fields of the handle in place, such as `status`, `gate` or `streamDown`. */
  patch(fields: Partial<UseCommandResult<Args, Reply>>): void;
}

/**
 * Options for {@link createFakeCommand}: whether a send is answered at once
 * with `reply` or held until the test confirms, refuses or loses it.
 *
 * @category Test doubles
 */
export interface FakeCommandOptions<Reply = AnyCommandReply> {
  /** `"hold"` keeps each send pending. Default `"confirm"`. */
  answer?: "confirm" | "hold";
  /** The reply a confirmed send resolves with. Default `{ success: true }`. */
  reply?: Reply;
}

/**
 * Makes a {@link FakeCommand}. Useful for testing a widget's use of a command,
 * or a kit input given a `with` or `toArgs` of it, with no stream to the mod.
 *
 * @category Test doubles
 */
export function createFakeCommand<Args = unknown, Reply = AnyCommandReply>(
  options: FakeCommandOptions<Reply> = {},
): FakeCommand<Args, Reply> {
  const reply = options.reply ?? ({ success: true } as Reply);
  const sent: FakeCommand<Args, Reply>["sent"] = [];
  const held: { resolve(r: Reply): void; reject(e: unknown): void }[] = [];
  const handle: UseCommandResult<Args, Reply> = {
    dangerouslySendWithoutInput: (args, opts) => {
      sent.push({ args, ...opts });
      if (options.answer !== "hold") return Promise.resolve(reply);
      return new Promise<Reply>((resolve, reject) => {
        held.push({ resolve, reject });
      });
    },
    status: { phase: "idle" },
    inFlight: [],
    warnings: [],
    tags: UNDECLARED_COMMAND_RAIL_TAGS,
    effectiveDelaySeconds: 0,
    delayReading: null,
    delayMode: null,
    sendStatus: undefined,
    dismiss: () => {},
    railed: false,
    refusals: [],
    losses: [],
    founds: [],
    undelivered: [],
    streamDown: false,
    failures: [],
    gateFor: () => handle.gate,
    with: (args, opts) => bindCommand(handle, args, opts),
    toArgs: (toArgs, opts) => bindValue(handle, toArgs, opts),
  };
  const settle = (act: (h: (typeof held)[number]) => void) => {
    const pending = held.splice(0);
    for (const h of pending) act(h);
    return pending.length;
  };
  return {
    handle,
    sent,
    confirm: (r) => settle((h) => h.resolve(r ?? reply)),
    refuse: (detail) =>
      settle((h) =>
        h.reject(
          Object.assign(new Error("refused"), {
            code: "E_REFUSED",
            errorCode: "wrongState",
            detail,
          }),
        ),
      ),
    lose: () =>
      settle((h) =>
        h.reject(Object.assign(new Error("lost"), { code: "E_LOST" })),
      ),
    patch: (fields) => {
      Object.assign(handle, fields);
    },
  };
}
