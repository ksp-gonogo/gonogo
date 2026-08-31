import type { Reading } from "@ksp-gonogo/sitrep-client";
import type {
  TopicId,
  TopicPayload,
  WidgetChannelId,
  WidgetFieldPath,
} from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "./useTelemetry";

/**
 * Per-widget Topic declaration + single-hook optionality typing, the Phase-0
 * type-design spike for the Uplink architecture (spec §3.2 / §3.3).
 *
 * ## What this proves
 *
 * A widget declares the Topics it consumes as **two explicitly-typed arrays**
 * (§3.2): `channels` (required) and `optionalChannels` (optional): and reads
 * them through **one** hook (`useTelemetry`, §3.3) whose return type is
 * *inferred from which array the Topic sits in*:
 *
 *   const topics = defineTopicManifest({
 *     channels: ["vessel.resources"],          // required
 *     optionalChannels: ["comm.link"],         // optional
 *   });
 *
 *   const res = topics.useTelemetry("vessel.resources");   // VesselResources        (non-null)
 *   const link = topics.useTelemetry("comm.link");         // CommLink | undefined
 *
 * The optionality is enforced by the type system, not convention: a Value from
 * a required Topic is guaranteed present, a Value from an optional Topic is
 * `| undefined`. A widget therefore **cannot** hard-depend on an optional
 * Topic (§3.3 static guarantee), and cannot read a Topic it never declared
 * (reading an undeclared Topic is a compile error, the argument is constrained
 * to the union of the two arrays).
 *
 * ## Why a single-hook design (not a two-hook split)
 *
 * The spike brief allowed falling back to a two-hook split
 * (`useTelemetry` required + `useOptionalTelemetry`) if the mapped-type single
 * hook proved unsound or ugly. It did not, the single hook is viable and is
 * the design that lands:
 *
 * - **One import, one call site shape.** A widget author writes
 *   `topics.useTelemetry(id)` for every Topic and the return type is correct
 *   automatically; there is no "did I pick the right hook for this array?"
 *   decision to get wrong, which is the exact class of mistake the two-array
 *   (vs `?`-prefix) declaration in §3.2 exists to remove.
 * - **The array *is* the single source of truth.** Move a Topic from
 *   `optionalChannels` to `channels` and every read of it flips from
 *   `| undefined` to non-null with no other edit. With a two-hook split the
 *   author would also have to swap the hook at each call site, and a missed one
 *   would compile, silently defeating the guarantee.
 * - **`const` type parameters make `as const` optional.** Callers get the
 *   narrow tuple types either way; `as const` still works and is proven in the
 *   type tests, but is not required for the inference to fire.
 *
 * ## Runtime
 *
 * This helper carries **zero runtime behaviour**: the returned hook is a thin
 * delegation to the base canonical {@link useTelemetry}. The required-vs-optional
 * distinction is purely type-level. The required branch's non-null return is an
 * honest contract by construction: the orchestrator only mounts a widget once
 * its required Topics are live (§3.3), so a mounted widget's required read is
 * never actually `undefined`. This is a static assertion of a runtime invariant
 * the orchestrator upholds: not a cast that can lie inside a mounted widget.
 *
 * Because `defineTopicManifest` is called once at module scope per widget, the
 * returned hook has a stable identity and obeys the Rules of Hooks as long as
 * the widget calls `topics.useTelemetry(...)` unconditionally (exactly as it
 * would call the base hook).
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
 */
export type WidgetTopicValue<
  T extends TopicId,
  Required extends readonly TopicId[],
> = Reading<TopicPayload<T>>;

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
 *     const res = useTelemetry("vessel.resources"); // VesselResources (non-null)
 *     const delay = useTelemetry("comms.delay");    // CommsDelay | undefined
 *     // ...
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
