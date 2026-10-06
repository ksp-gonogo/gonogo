import type { Meta } from "./__generated__/contract";

/**
 * The derived-channel authoring contract.
 *
 * An Uplink contributes derived channels: it declares a topic, the inputs it reads,
 * and a pure `derive` that answers for one view time. Writing one means naming a
 * `TimelinePoint` and a `DerivedGet`, so both belong on the surface a
 * third-party author actually has.
 *
 * They lived in `@ksp-gonogo/sitrep-client` until the Uplink isolation rule made the
 * consequence visible: a bundled Uplink contributes a resource-projection channel
 * and could only do it by importing app-internal types, which is precisely the thing
 * an outside author cannot do. Nothing here needs the store; it is the
 * vocabulary for talking to it, and the store itself stays app-side.
 */

/**
 * One received sample of a Topic: its value, when it is valid, and what is
 * known about where it came from. A reckoner and a derived channel receive
 * these.
 *
 * @category Processors
 */
export interface TimelinePoint<Payload = unknown> {
  /** The UT the value is valid at. */
  validAt: number;
  /** The value, or `null` when the game confirmed there is none. */
  payload: Payload | null;
  /** Where the sample came from and how good it is, such as its source craft. */
  meta: Meta;
  /** The timeline generation it was received in; loading a save starts a new one. */
  epoch: number;
}

/**
 * How a derived channel's `derive` reads its inputs: `get(topic)` returns that
 * Topic's sample at the same view time `derive` was called for, including its
 * `meta`. There is no way to ask for any other time, so every input is from
 * one instant. Another derived channel can be read the same way.
 *
 * @category Processors
 */
export type DerivedGet = <Payload = unknown>(
  topic: string,
) => TimelinePoint<Payload> | undefined;

/**
 * A Topic computed on the client from other Topics, registered on the timeline
 * store so it is read like any other.
 *
 * @category Processors
 */
export interface DerivedChannelDefinition<Payload> {
  /** The topic this channel registers as, e.g. `"system.state"`. */
  topic: string;
  /** The Topics `derive` reads. Listing them does not subscribe to them. */
  inputs: string[];
  /**
   * Computes the channel's value at `viewUt`. The same inputs must give the
   * same result, so a replay draws the same thing. Return `undefined` while an
   * input has not arrived yet, and `null` when the value is confirmed absent;
   * never a made-up zero.
   */
  derive: (get: DerivedGet, viewUt: number) => Payload | null | undefined;
  /** Whether each field of the value can also be read as its own Topic, such as `system.state.bodyCount`. */
  fields?: boolean;
}
