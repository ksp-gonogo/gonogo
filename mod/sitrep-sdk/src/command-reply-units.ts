// The inbound half of a command's units.
//
// A channel payload gets its units back in `parseServerMessage`, which knows
// the TOPIC and can therefore ask `unitsForTopic` what each field is. A command
// reply arrives on `command-response`, which carries a `requestId` and nothing
// else: the only way back to a type is through the command that was dispatched.
// `GeneratedCommandReplyMap` holds exactly that mapping and is a TS interface,
// so it is gone by runtime; `GENERATED_COMMAND_REPLY_TYPES` is the same
// reflection's answer as a runtime value, and is what `unitsForType` can take.
//
// UPLINK-OWNED COMMANDS ARE NOT COVERED. An Uplink's reply types live in its own
// contract slice with its own generated map, and nothing registers that map with
// the SDK, so a reply of an Uplink command passes through bare.

import { GENERATED_COMMAND_REPLY_TYPES } from "./__generated__/command-map";
import { unitsForType } from "./units";
import { type WireOf, wrapTypePayload } from "./wrap-units";

/**
 * `CommandResultOf<T>` is the envelope, and its quantities are T's, one level
 * down on `payload`. The envelope itself declares none: it is transport, and
 * `generated.test.ts` exempts it for that reason.
 */
const RESULT_ENVELOPE = /^CommandResultOf<(.+)>$/;

const COMMAND_REPLY_TYPES: Record<string, string> =
  GENERATED_COMMAND_REPLY_TYPES;

/**
 * Give a command reply's declared quantities their units, in place.
 *
 * The write-side twin of what `parseServerMessage` does to a `stream-data`
 * frame: a `VantagePlanReply.seededAtUt` typed `Value<"ut">` is one at runtime
 * as well, so a caller reaching a `Value` method on it does not throw.
 *
 * A command the map has never heard of, a primitive result, and a payload of
 * a type with no declared units all pass straight through: the walk is
 * skipped rather than guessed at.
 */
export function wrapCommandReply<R>(command: string, result: WireOf<R>): R;
/* Same two-signature shape, and the same reason, as `dehydrateArgs`: the walk
   below is untyped and the overload states the conversion without an assertion
   out of `unknown`. */
export function wrapCommandReply(command: string, result: unknown): unknown {
  const declared = COMMAND_REPLY_TYPES[command];
  if (declared === undefined || result === null || typeof result !== "object") {
    return result;
  }
  const envelope = RESULT_ENVELOPE.exec(declared);
  if (envelope === null) return wrapTypePayload(declared, result);
  const inner = envelope[1];
  /* `CommandResultOf<number>` and `<string>` name a primitive rather than a
     generated shape, and nothing in the units registry answers for those. */
  if (Object.keys(unitsForType(inner)).length === 0) return result;
  const payload: unknown = Reflect.get(result, "payload");
  if (payload !== null && typeof payload === "object") {
    wrapTypePayload(inner, payload);
  }
  return result;
}
