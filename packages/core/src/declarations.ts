import {
  isKnownFieldPath,
  PRODUCTION_DERIVED_CHANNELS,
} from "@ksp-gonogo/sitrep-client";
import { isTopicId } from "@ksp-gonogo/sitrep-sdk";

/**
 * What a widget is allowed to put in `dataRequirements`, and the reason each
 * form is trusted.
 *
 * `useWidgetStreamStatus` and `alarmMatchesWidget` both resolve a declaration
 * at runtime, and both are permissive by necessity: `isTopicCarried` walks a
 * dotted PATH and cannot tell a real leaf from a plausible one, so
 * `career.status.economy.notAField` resolves exactly as well as
 * `career.status.economy.funds` and then renders `undefined` forever. A widget
 * that declares a typo therefore loses its badge and its alarms with no
 * failure anywhere: the same silent-miss class this whole vocabulary
 * migration exists to remove, reintroduced by the migration itself.
 *
 * So the permissiveness at read time is paid for by strictness here. A
 * declaration must be one of four things, each already proved real by
 * something other than this file:
 */
export type RequirementKind =
  /** A wire channel the mod publishes (`isTopicId`, generated from the C#
   *  contract, so a typo is not a `TopicId`). */
  | "wire-topic"
  /** A derived channel registered in `PRODUCTION_DERIVED_CHANNELS`, named by
   *  a widget that reads the whole payload (`useStream("vessel.state")`). */
  | "derived-channel"
  /** A field path inside one of the above. Trusted because it is a TARGET of
   *  the migration table, and every target is independently proved to resolve:
   *  `vessel-state-mapping.coverage.test.ts` invokes the real
   *  `deriveVesselState` for the derived ones, and
   *  `map-topic.rawFieldRoots.coverage.test.ts` checks the wire root of the
   *  raw ones. This clause borrows those proofs rather than inventing a third
   *  mechanism.
   *
   *  Sourced from the contract's own generated field metadata plus each
   *  derived channel's declared field set, so it stands on its own now that the
   *  migration table has gone: the walk behind it reads through
   *  `unitsForTopic`/`shapesForTopic` rather than the generated maps directly,
   *  which is what lets it see a Topic an Uplink or a derived channel
   *  registered at module load. */
  | "field-path";

const DERIVED_CHANNEL_TOPICS: ReadonlySet<string> = new Set(
  PRODUCTION_DERIVED_CHANNELS.map((channel) => channel.topic),
);

/**
 * Classifies one `dataRequirements` entry, or returns `undefined` when it is
 * none of the four legal forms: an entry nothing can resolve, which is the
 * only thing this gate is looking for.
 */
export function classifyRequirement(
  requirement: string,
): RequirementKind | undefined {
  if (isTopicId(requirement)) return "wire-topic";
  if (DERIVED_CHANNEL_TOPICS.has(requirement)) return "derived-channel";
  if (isKnownFieldPath(requirement)) return "field-path";
  return undefined;
}
