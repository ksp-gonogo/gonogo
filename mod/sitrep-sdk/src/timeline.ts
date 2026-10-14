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
 * known about where it came from. Useful for working out a figure for the
 * operator from what the vessel last sent. A reckoner (the model that carries a
 * Topic forward between samples, registered with
 * {@link UplinkClientHandle.registerReckoner}) and a derived channel
 * ({@link DerivedChannelDefinition}) receive these, and the plotted data hooks
 * read them.
 *
 * @typeParam Payload - The Topic's payload type, as the reader expects it.
 *
 * @category Processors
 */
export interface TimelinePoint<Payload = unknown> {
  /** The UT the value is valid at. */
  validAt: number;
  /** The value, or `null` when the game confirmed there is none. */
  payload: Payload | null;
  /** Where the sample came from and how good it is, such as its source vessel. */
  meta: Meta;
  /** The timeline generation it was received in; loading a save starts a new one. */
  epoch: number;
}

/**
 * The function a derived channel's `derive` reads its inputs with.
 * `get(topic)` returns that Topic's sample at the view time `derive` was called
 * for, including its `meta`, so a derived figure is built from inputs of one
 * instant. Useful for combining several Topics into a figure shown to the
 * operator. Used by the app's own derived channels, such as the one that
 * computes the delta-v of each stage.
 *
 * `Payload` is the input Topic's payload type, which the caller names:
 * `get<VesselOrbit>("vessel.orbit")`. A time other than the view time cannot be
 * asked for. Another derived channel can be read the same way.
 *
 * @category Processors
 */
export type DerivedGet = <Payload = unknown>(
  topic: string,
) => TimelinePoint<Payload> | undefined;

/**
 * A Topic computed on the client from other Topics, registered with
 * {@link UplinkClientHandle.registerDerivedChannel}. Useful for showing the
 * operator a figure that needs more than one Topic, such as a state worked out
 * from several readings. It joins the timeline store, the app's record of every
 * Topic's samples over game time. A widget reads it by its id with
 * {@link useStream}, which takes any string. {@link useTelemetry} and a widget's
 * `channels` accept only a {@link TopicId} or one of the {@link
 * DERIVED_CHANNEL_IDS}, which is the app's own list, so an Uplink's channel is
 * not listed in `channels` and is read with `useStream`. The app registers its
 * own derived channels from a list of these.
 *
 * @example A channel that says whether the vessel is descending
 * ```ts
 * import {
 *   defineUplinkClient,
 *   type TopicPayload,
 * } from "@ksp-gonogo/sitrep-sdk";
 *
 * const DESCENT = defineUplinkClient({
 *   id: "descent",
 *   version: "1.0.0",
 *   name: "Descent",
 *   description: "Derives descent facts from the vessel's flight state.",
 * });
 *
 * DESCENT.registerDerivedChannel<{ descending: boolean }>({
 *   topic: "descent.state",
 *   inputs: ["vessel.flight"],
 *   derive: (get) => {
 *     const flight = get<TopicPayload<"vessel.flight">>("vessel.flight");
 *     // Not arrived yet: say nothing, so readers show "waiting".
 *     if (flight === undefined) return undefined;
 *     // The game confirmed there is no flight data.
 *     if (flight.payload === null) return null;
 *     return { descending: flight.payload.verticalSpeed.isNegative() };
 *   },
 * });
 * ```
 *
 * @category Processors
 */
export interface DerivedChannelDefinition<Payload> {
  /** The topic this channel registers as, e.g. `"system.state"`. */
  topic: string;
  /** The Topics `derive` reads. Listing them does not subscribe to them. */
  inputs: string[];
  /**
   * Computes the channel's value at `viewUt`, the game time the screen is
   * showing, which trails the game by the signal delay. The same inputs must give
   * the same result, so a replay draws the same thing. Return `undefined` while an
   * input has not arrived yet, and `null` when the value is confirmed absent;
   * never a made-up zero.
   */
  derive: (get: DerivedGet, viewUt: number) => Payload | null | undefined;
  /** Whether each field of the value can also be read as its own Topic, such as `system.state.bodyCount`. */
  fields?: boolean;
}
