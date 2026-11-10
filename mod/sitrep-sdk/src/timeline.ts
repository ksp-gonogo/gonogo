import type { Meta } from "./__generated__/contract";

/**
 * One received sample of a Topic: its value, when it is valid, and what is
 * known about where it came from. Useful for working out a figure for the
 * operator from what the vessel last sent. A reckoner (the model that carries a
 * Topic forward between samples, registered with
 * {@link UplinkClientHandle.registerReckoner}) receives these, and the app's
 * hooks that read a series of samples for a plot read them.
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
