using System;

namespace Sitrep.Contract;

/// <summary>
/// Marks a property as a provider-namespaced extension bag: a
/// <c>Dictionary&lt;string, object?&gt;</c> keyed by provider id (the id the
/// provider registers with the <see cref="Kernel"/>, and the same string the
/// payload's own <c>Source</c>-style field carries), whose values are that
/// provider's own opaque sub-tree. It is how a provider adds a field to a
/// shared, elected payload without a change to this assembly.
///
/// <para>In TypeScript the property is typed <c>ProviderExtensions</c>, and each
/// provider's own client package supplies the type of its namespace.</para>
///
/// <para>Keyed by provider id so two providers never collide and a reader picks
/// its own namespace: an elected capability has one active provider at a time,
/// but more than one provider's client can be installed, and a delayed or
/// archived frame can predate a change of provider.</para>
/// <internal>
/// RtConfig.ApplyProviderExtensionTypes reflects over this and retypes the
/// property to ProviderExtensions, so adding the bag to another payload is one
/// attribute line. The wire always carried arbitrary nested values; only the
/// generated TS interface gated what a consumer could read typed.
/// </internal>
/// </summary>
/// <category>Serialization</category>
[AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = false)]
public sealed class ProviderExtensionBagAttribute : Attribute
{
}

/// <summary>
/// The names of the provider extension bag, shared so the producer, the wire
/// and the client runtime all use the same ones.
/// </summary>
/// <category>Serialization</category>
public static class ProviderExtensions
{
    /// <summary>
    /// The reserved wire key a bag is written under, <c>"extensions"</c>, on
    /// every payload that carries one. The client runtime reads a provider's
    /// namespace from exactly this key.
    /// </summary>
    public const string WireField = "extensions";

    /// <summary>
    /// The TypeScript type a bag is typed as, <c>ProviderExtensions</c>. It is
    /// opaque in the SDK, because the SDK cannot know a provider's shape; the
    /// provider's own package supplies the type of its namespace.
    /// <internal>Hand-written in mod/sitrep-sdk/src/extensions.ts.</internal>
    /// </summary>
    public const string TsTypeName = "ProviderExtensions";

    /// <summary>
    /// The module path generated TypeScript imports <see cref="TsTypeName"/>
    /// from, relative to the SDK's own generated folder. An Uplink generating
    /// into its own <c>client/src/__generated__/</c> passes its own path.
    /// <internal>Same pattern as RtConfig.ApplyUnitValueTypes's valueImportFrom.</internal>
    /// </summary>
    public const string DefaultTsImportFrom = "../extensions";
}
