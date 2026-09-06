import type { Reading } from "@ksp-gonogo/sitrep-client";
import type {
  ReckonableFields,
  ReckonableReading,
  ReckonableTopic,
  TopicId,
  TopicPayload,
  WidgetChannelId,
  WidgetFieldPath,
} from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "./useTelemetry";

/**
 * Per-widget Topic declaration: two explicitly-typed arrays plus one read hook
 * bound to their union, so declaration and read cannot drift.
 *
 *   const topics = defineTopicManifest({
 *     channels: ["vessel.resources"],          // required
 *     optionalChannels: ["comms.delay"],       // optional
 *   });
 *
 *   const res = topics.useTelemetry("vessel.resources");   // Reading<VesselResources>
 *   const delay = topics.useTelemetry("comms.delay");      // Reading<CommsDelay>
 *
 * ## Both arrays read the same, and this is the correction worth reading
 *
 * The original design had the bound hook resolve a REQUIRED Topic to its
 * payload non-null and an OPTIONAL one to `payload | undefined`, and this doc
 * described that for long after the type stopped doing it. It does not do it
 * and must not: see {@link WidgetTopicValue} for the argument. `pending` IS
 * "nothing has arrived", the `Reading` union already carries the distinction,
 * and a conditional layered on top would be a lie that nothing could catch,
 * because the bound hook is built with `as unknown as`.
 *
 * The claim that made it sound safe was also false: the orchestrator does NOT
 * withhold a widget until its required Topics are live. What it gates on is the
 * owning Uplink's HEALTH (`RequiresGuard` + `useUplinkHealthFor`, longest-prefix
 * match against the `system.uplinkHealth` roster), which is a different
 * question and answers `unresolved` for a while on every page load.
 *
 * ## So what the two arrays actually do
 *
 * - **Neither creates the subscription.** The base hook subscribes on its own,
 *   for a declared Topic and an undeclared one alike
 * - **`channels` gates the mount.** A required channel whose owning Uplink
 *   resolves unhealthy replaces the widget with that Uplink's own
 *   `health.detail`. An unresolved owner does not block
 * - **`optionalChannels` never gates.** They are deliberately not passed to the
 *   guard. That is the whole behavioural difference between the two lists
 * - **Both constrain the read.** The hook's argument is the union of the two
 *   arrays, so reading a Topic the widget never declared is a compile error.
 *   That is this helper's real value, and it survives the correction above
 *
 * ## Runtime
 *
 * Zero runtime behaviour: the returned hook is a thin delegation to the base
 * canonical {@link useTelemetry}. Because `defineTopicManifest` is called once
 * at module scope per widget, the returned hook has a stable identity and obeys
 * the Rules of Hooks as long as the widget calls `topics.useTelemetry(...)`
 * unconditionally (exactly as it would call the base hook).
 */

/**
 * The per-call return type of a widget-bound telemetry hook: a `Reading` of the
 * Topic's payload.
 *
 * Deliberately NOT a conditional resolving a REQUIRED Topic to its payload
 * non-null and an optional one to `payload | undefined`. That distinction is the
 * one the `Reading` union already carries in its own arms: `pending` IS "nothing
 * has arrived", and it is unreachable only for the required ones. A conditional
 * on top of a `Reading` would also be a lie, and because the bound hook is built
 * with `as unknown as`, nothing would catch it: every widget reading through a
 * manifest would be silently wrong about what it holds.
 *
 * `Required` stays in the signature because it still constrains which Topics may be
 * read at all, which is the mechanism's real value.
 *
 * What it IS conditional on is the contract's reckonability declaration, and it
 * has to be: this resolves to the same store read the base hook makes, so a
 * marked Topic read through a manifest and the same Topic read through the base
 * hook must be the same type. Flattening `ReckonableReading`'s projection back
 * to the whole payload here would let a widget read a field off `reckoned` that
 * no declared model moves, in the one call shape most built-in widgets use.
 */
export type WidgetTopicValue<
  T extends TopicId,
  Required extends readonly TopicId[],
> = T extends ReckonableTopic
  ? ReckonableReading<
      TopicPayload<T>,
      ReckonableFields<T> & keyof TopicPayload<T>
    >
  : Reading<TopicPayload<T>>;

/**
 * A telemetry read hook bound to one widget's declared channels. The single call
 * signature constrains the argument to the union of the two declared arrays,
 * reading an undeclared channel is a compile error, and maps the return type
 * through {@link WidgetTopicValue}.
 *
 * The argument is `Extract<..., TopicId>`, narrower than what may be DECLARED. A
 * widget may declare a derived channel and does, `vessel.state` is the most-read
 * channel in the tree, but the derived ones are read with `useStream`, which
 * answers with the value rather than a `Reading`. Admitting them here would mean
 * either fabricating a `Reading` for a channel with no reckoning model or
 * silently handing back a different shape from the same call, and the second is
 * the class of thing this hook exists to make impossible. A declared derived
 * channel therefore still gates the mount and still feeds the badge; only the
 * read stays on the other hook.
 */
export type BoundTelemetryHook<
  Required extends readonly WidgetChannelId[],
  Optional extends readonly WidgetChannelId[],
> = <T extends Extract<Required[number] | Optional[number], TopicId>>(
  topic: T,
) => WidgetTopicValue<T, Extract<Required[number], TopicId>[]>;

/**
 * The value returned by {@link defineTopicManifest}: the three declared arrays
 * (spread straight into `registerComponent`'s `channels` / `optionalChannels` /
 * `fields`) plus the widget-bound {@link BoundTelemetryHook}.
 */
export interface TopicManifest<
  Required extends readonly WidgetChannelId[],
  Optional extends readonly WidgetChannelId[],
  Fields extends readonly WidgetFieldPath[],
> {
  readonly channels: Required;
  readonly optionalChannels: Optional;
  /**
   * What the widget draws, spread straight into `registerComponent`'s `fields`.
   * An empty array when the manifest declared none, which `registerComponent`
   * treats the same as absent: the widget draws everything it mounts on.
   */
  readonly fields: Fields;
  readonly useTelemetry: BoundTelemetryHook<Required, Optional>;
}

/**
 * Build a widget's Topic manifest from its required (`channels`) and optional
 * (`optionalChannels`) Topic arrays. Returns the arrays (for `registerComponent`)
 * and a bound `useTelemetry` hook whose return type carries the required /
 * optional distinction. See the module doc for the full rationale.
 *
 * @example
 *   const { channels, optionalChannels, useTelemetry } = defineTopicManifest({
 *     channels: ["vessel.resources"],
 *     optionalChannels: ["comms.delay"],
 *   });
 *
 *   function PowerSystems() {
 *     const res = useTelemetry("vessel.resources"); // Reading<VesselResources>
 *     const delay = useTelemetry("comms.delay");    // Reading<CommsDelay>
 *
 *     // Both branch the same way. `pending` is merely unlikely on a required
 *     // channel, not unrepresentable, so neither read is dereferenceable.
 *     if (res.state !== "observed") return null;
 *     return renderResources(res.value, delay);
 *   }
 *
 *   registerComponent({ id: "power-systems", channels, optionalChannels, component: PowerSystems /* ... *\/ });
 */
export function defineTopicManifest<
  const Required extends readonly WidgetChannelId[],
  const Optional extends readonly WidgetChannelId[] = readonly [],
  const Fields extends readonly WidgetFieldPath[] = readonly [],
>(manifest: {
  channels: Required;
  optionalChannels?: Optional;
  fields?: Fields;
}): TopicManifest<Required, Optional, Fields> {
  const channels = manifest.channels;
  const optionalChannels = (manifest.optionalChannels ?? []) as Optional;
  const fields = (manifest.fields ?? []) as Fields;

  const boundHook = ((topic: TopicId) =>
    useTelemetry(topic)) as unknown as BoundTelemetryHook<Required, Optional>;

  return { channels, optionalChannels, fields, useTelemetry: boundHook };
}
