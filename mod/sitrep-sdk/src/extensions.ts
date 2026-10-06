// The provider extension bag, client side.
//
// The core half of the mechanism `mod/Sitrep.Contract/ProviderExtensions.cs`
// describes in full: a Kernel-elected capability publishes ONE shared payload
// shape, and a provider that models something the shape does not declare writes it
// under its own provider id rather than getting a field added to core.
//
// ── Deliberately opaque, and that is the whole point ────────────────────────────
// Core cannot know a provider's shape. A generated type that pretended to would be
// the closed-enum mistake the open `SitrepUnit` union already refused once: closing
// it "would have meant an Uplink could never declare a unit at all, which
// contradicts third parties being first-class" (RtConfig.EmitUnitMap). So the value
// under a provider id is `unknown`, and the PROVIDER'S OWN package supplies the
// type at its own boundary, the same way an augment slot's filler "is always part
// of its OWN package's compiled program".
//
// A consumer therefore imports the provider's own reader for that sub-tree, not
// this type: `read<Provider><Payload>Ext(payload)`, exported from the package that
// also writes the sub-tree server-side, rather than reaching into
// `payload.extensions?.[someId]` and casting at the call site.
//
// ── The unit half lives in `./units` ────────────────────────────────────────────
// A quantity inside a namespace is a real gonogo `Value<unit>` and has to survive
// decode like any other. `registerProviderExtensionShape` (units.ts) is how a
// provider teaches the runtime which generated type a namespace holds, so
// `wrapTopicPayload` can walk into it. Without that registration the values arrive
// bare while the provider's own generated type still says `Value<...>`.

// Mirrors Sitrep.Contract.ProviderExtensions.WireField; extensions.test.ts asserts the two agree.
/**
 * The key a payload carries its {@link ProviderExtensions} under:
 * `"extensions"`.
 *
 * @category Reading telemetry
 */
export const PROVIDER_EXTENSIONS_FIELD = "extensions";

/**
 * What one provider puts under its own id in a payload's `extensions` field.
 * Its type is unknown to Gonogo: read it with the reader the provider's own
 * package exports, rather than casting it yourself.
 *
 * @category Reading telemetry
 */
export type ProviderExtension = unknown;

/**
 * Values a payload carries beyond its declared fields, keyed by the id of the
 * provider that wrote them. A mod that serves a Topic and models something the
 * payload has no field for puts it here, under its own id, so values from two
 * providers never collide.
 *
 * Each value is `unknown` here. Read one through the reader the provider's
 * own package exports, rather than casting it.
 *
 * @category Reading telemetry
 */
export type ProviderExtensions = Readonly<Record<string, ProviderExtension>>;
