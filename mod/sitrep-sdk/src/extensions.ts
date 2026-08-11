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

/**
 * The reserved wire key a bag serialises under, on every payload that carries one.
 * Mirrors `Sitrep.Contract.ProviderExtensions.WireField`; `extensions.test.ts`
 * asserts the two strings agree, the same C#-to-TS pinning every relocated Topic
 * id already gets.
 */
export const PROVIDER_EXTENSIONS_FIELD = "extensions";

/**
 * One provider's namespace: opaque at the core layer. Narrowed by the provider's
 * own typed accessor, never by a cast at a consuming call site.
 */
export type ProviderExtension = unknown;

/**
 * The bag itself, keyed by PROVIDER ID: the id the provider registers with the
 * Kernel, and the same string its payloads tag themselves with. Keyed that way so two providers
 * never collide: an exclusive capability has one ACTIVE provider at a time, but
 * more than one provider's client can be installed, and a delayed or archived
 * frame can predate an election change.
 *
 * This is the type `[ProviderExtensionBag]` properties are generated as
 * (`RtConfig.ApplyProviderExtensionTypes`).
 */
export type ProviderExtensions = Readonly<Record<string, ProviderExtension>>;
