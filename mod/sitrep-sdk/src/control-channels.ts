// Runtime accessor for the bidirectional control channels.
//
// A control axis is declared ONCE in C# ([SitrepControlChannel] on a read topic
// field) and codegen emits BOTH wire halves paired by id into
// ./__generated__/control-channels.ts: the read topic + field (the confirmed
// readback, i.e. the echo) and the write command + its typed args (the delayed
// uplink). The wire keeps those TWO keys separate. This module is the hand-written
// accessor that wraps a row into ONE handle a consumer holds, mirroring units.ts's
// accessor-on-generated-data shape so the generated file stays free to change.
//
// The handle composes with the SDK's existing command lifecycle: a caller
// dispatches `writeCommand` through `useCommand` and reads `readTopic`'s
// `readField` through `useTelemetry` for the echo. This module provides only the
// unified handle; pairing the two calls is the caller's, and the app tracks the
// round trip through the command's own `confirmed` phase rather than through
// anything here.

import {
  GENERATED_CONTROL_CHANNELS,
  type GeneratedControlChannel,
  type GeneratedControlChannelId,
} from "./__generated__/control-channels";
import { isTopicId, type TopicId } from "./topics";

/**
 * The id of a control channel: a control such as the throttle or SAS, which is
 * set with a command and read back from a Topic.
 *
 * @category Commands
 */
export type ControlChannelId = GeneratedControlChannelId;

/**
 * One control channel's two halves: the command that sets the control, and the
 * Topic field that reports what the craft has actually set it to. Send with
 * {@link useCommand} on `writeCommand`, and read the craft's value with
 * {@link useTelemetry} on `readTopic`.
 *
 * @category Commands
 */
export interface ControlChannelHandle {
  /** The channel id, e.g. `"vessel.control.throttle"`. */
  readonly id: string;
  /** The Topic that reports the value the craft has set. */
  readonly readTopic: TopicId;
  /** The field of `readTopic`'s payload holding that value. */
  readonly readField: string;
  /** The command that sets the control, sent at the signal delay. */
  readonly writeCommand: string;
  /**
   * Returns the arguments for `writeCommand` that set the control to `value`.
   * A number for a control such as the throttle; a boolean for a switch such
   * as SAS or the landing gear. A mode is set by its member's number.
   */
  toArgs(value: number | boolean): Record<string, number | boolean>;
}

const BY_ID: ReadonlyMap<string, GeneratedControlChannel> = new Map(
  GENERATED_CONTROL_CHANNELS.map((channel) => [channel.id, channel]),
);

/**
 * Returns the control channel with this id, or `undefined` when there is none.
 *
 * @category Commands
 */
export function getControlChannel(
  id: string,
): ControlChannelHandle | undefined {
  const row = BY_ID.get(id);
  if (!row) return undefined;
  if (!isTopicId(row.readTopic)) return undefined;

  const readTopic: TopicId = row.readTopic;
  const { readField, writeCommand, valueField } = row;
  return {
    id: row.id,
    readTopic,
    readField,
    writeCommand,
    toArgs: (value: number | boolean) => ({ [valueField]: value }),
  };
}

/**
 * Returns the id of every control channel.
 *
 * @category Commands
 */
export function controlChannelIds(): readonly string[] {
  return GENERATED_CONTROL_CHANNELS.map((channel) => channel.id);
}
