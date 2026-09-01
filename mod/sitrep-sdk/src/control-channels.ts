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

/** The id of a declared bidirectional control channel. */
export type ControlChannelId = GeneratedControlChannelId;

/**
 * ONE handle unifying a control channel's two wire keys. `readTopic`/`readField`
 * carry the confirmed readback (the echo); `writeCommand`/`toArgs` are the delayed
 * uplink half.
 */
export interface ControlChannelHandle {
  /** The channel id, e.g. `"vessel.control.throttle"`. */
  readonly id: string;
  /** The read topic whose field carries the confirmed readback. */
  readonly readTopic: TopicId;
  /** The field on `readTopic`'s payload carrying the confirmed value. */
  readonly readField: string;
  /** The command a value is dispatched on (the delayed uplink). */
  readonly writeCommand: string;
  /**
   * Wrap a value into the write command's wire args.
   *
   * `boolean` alongside `number` because half the declared channels are
   * discrete: SAS, RCS, gear, brakes, lights and abort are switches, and an
   * enum mode is an ordinal. Numeric-only was a fact about which channels
   * happened to be declared first (the throttle and the six fly-by-wire axes),
   * never about what a control channel is.
   */
  toArgs(value: number | boolean): Record<string, number | boolean>;
}

const BY_ID: ReadonlyMap<string, GeneratedControlChannel> = new Map(
  GENERATED_CONTROL_CHANNELS.map((channel) => [channel.id, channel]),
);

/**
 * The handle for `id`, or `undefined` when no channel with that id is declared (or,
 * defensively, when its read topic is not a known `TopicId`, which a passing
 * control-channels-cs-sync test rules out for every first-party channel).
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

/** Every declared control-channel id. */
export function controlChannelIds(): readonly string[] {
  return GENERATED_CONTROL_CHANNELS.map((channel) => channel.id);
}
