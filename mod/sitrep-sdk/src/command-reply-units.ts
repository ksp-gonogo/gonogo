// The inbound half of a command's units, and the one table in the SDK that
// restates a generated fact by hand.
//
// A channel payload gets its units back in `parseServerMessage`, which knows
// the TOPIC and can therefore ask `unitsForTopic` what each field is. A command
// reply arrives on `command-response`, which carries a `requestId` and nothing
// else: the only way back to a type is through the command that was dispatched.
// `GeneratedCommandReplyMap` holds exactly that mapping and is a TS interface,
// so it is gone by runtime and cannot be asked.
//
// Hence a table of type NAMES, which `unitsForType` can take. It is written out
// rather than generated because `EmitCommandMap` lives in `Sitrep.Contract` and
// emitting a runtime twin of the reply map is a contract-codegen change; see
// `command-reply-units.test.ts`, which reads the generated interface and fails
// on any divergence, so the copy cannot drift even while it is a copy.
//
// UPLINK-OWNED COMMANDS ARE NOT COVERED. An Uplink's reply types live in its own
// contract slice with its own generated map and the same runtime gap, so the
// registration an Uplink would need is the same one this table stands in for.
// Its replies hydrate the day the codegen emits the map; until then a reply of
// an Uplink command passes through bare, which is what every reply did before
// this file existed.

import { unitsForType } from "./units";
import { type WireOf, wrapTypePayload } from "./wrap-units";

/**
 * Command id → the generated type its dispatch RESOLVES with, spelled exactly as
 * `GeneratedCommandReplyMap` spells it.
 *
 * Verbatim on purpose. The sync test compares these strings to the ones it parses
 * out of the generated file with no normalising step of its own, so there is no
 * transformation in which a difference could hide.
 */
export const COMMAND_REPLY_TYPES: Record<string, string> = {
  "alarm.scet.arm": "CommandResult",
  "alarm.scet.disarm": "CommandResult",
  "career.contract.accept": "CommandResult",
  "career.contract.cancel": "CommandResult",
  "career.contract.decline": "CommandResult",
  "career.crew.fire": "CommandResult",
  "career.crew.hire": "CommandResult",
  "career.facility.upgrade": "CommandResult",
  "career.strategy.activate": "CommandResult",
  "career.strategy.deactivate": "CommandResult",
  "career.tech.unlock": "CommandResult",
  "comms.setSimulationDelayPolicy": "CommandResult",
  "ksp.launch": "CommandResult",
  "ksp.recover": "CommandResult",
  "ksp.revertToEditor": "CommandResult",
  "ksp.revertToLaunch": "CommandResult",
  "ksp.switchVessel": "CommandResult",
  "ksp.toTrackingStation": "CommandResult",
  "robotics.rotor.reverse": "CommandResult",
  "robotics.rotor.setBrake": "CommandResult",
  "robotics.rotor.setLock": "CommandResult",
  "robotics.rotor.setMotor": "CommandResult",
  "robotics.rotor.setRpmLimit": "CommandResult",
  "robotics.rotor.setTorqueLimit": "CommandResult",
  "robotics.servo.setLock": "CommandResult",
  "robotics.servo.setMotor": "CommandResult",
  "robotics.servo.setTarget": "CommandResult",
  "science.experiment.deploy": "CommandResult",
  "science.experiment.transmit": "CommandResult",
  "system.bodies.statesAt": "BodyStatesReply",
  "system.frame.set": "CommandResult",
  "time.setPaused": "CommandResult",
  "time.setWarpIndex": "CommandResult",
  "vessel.control.setAbort": "CommandResult",
  "vessel.control.setActionGroup": "CommandResult",
  "vessel.control.setAxes": "CommandResult",
  "vessel.control.setBrakes": "CommandResult",
  "vessel.control.setFlyByWire": "CommandResult",
  "vessel.control.setGear": "CommandResult",
  "vessel.control.setLights": "CommandResult",
  "vessel.control.setRcs": "CommandResult",
  "vessel.control.setSas": "CommandResult",
  "vessel.control.setSasMode": "CommandResult",
  "vessel.control.setThrottle": "CommandResult",
  "vessel.control.stage": "CommandResultOf<number>",
  "vessel.invokePartAction": "CommandResult",
  "vessel.maneuver.add": "CommandResultOf<string>",
  "vessel.maneuver.plan.send": "CommandResult",
  "vessel.maneuver.remove": "CommandResult",
  "vessel.maneuver.update": "CommandResult",
  "vessel.repair": "CommandResultOf<RepairOutcome>",
  "vessel.target.clear": "CommandResult",
  "vessel.target.set": "CommandResult",
  "vessel.trajectory.forVantage": "VantagePlanReply",
};

/**
 * `CommandResultOf<T>` is the envelope, and its quantities are T's, one level
 * down on `payload`. The envelope itself declares none: it is transport, and
 * `generated.test.ts` exempts it for that reason.
 */
const RESULT_ENVELOPE = /^CommandResultOf<(.+)>$/;

/**
 * Give a command reply's declared quantities their units, in place.
 *
 * The write-side twin of what `parseServerMessage` does to a `stream-data`
 * frame, and the reason a `VantagePlanReply.seededAtUt` typed `Value<"ut">` is
 * now one at runtime as well. Before this, every command whose Result type
 * declared a quantity resolved a bare number wearing a `Value`'s type, and a
 * caller reaching a `Value` method on it threw.
 *
 * A command the table has never heard of, a primitive result, and a payload of
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
