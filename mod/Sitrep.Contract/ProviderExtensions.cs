using System;

namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// The provider extension bag: how a provider adds a FIELD to a Kernel-elected
// shared payload without a PR against this assembly.
//
// ── The hole this closes ─────────────────────────────────────────────────────
// A Kernel-elected capability (comms, reliability, actionGroups, targetApproach,
// and science next) publishes ONE shared payload shape that whichever provider
// won the election fills. Until this existed, a provider that wanted a field the
// shared shape did not already declare had exactly two options: a PR adding the
// field to the shared class here (what reliability.* does today, where one
// modelling mod's consumed-fraction fields and another's live-probability fields
// sit side by side as a hand-curated core superset, each doc-commented with which
// provider fills it), or a parallel provider-owned topic that cannot supersede the
// elected one. Neither scales to an out-of-tree provider the core dev has never
// heard of, and per the decentralised-Uplink model that is exactly who a provider
// is expected to be.
//
// ── The precedent this generalises ───────────────────────────────────────────
// SitrepUnit is deliberately an OPEN union (KnownSitrepUnit | (string & {})), for
// the reason RtConfig.EmitUnitMap states verbatim: a third-party Uplink cannot add
// to Sitrep.Contract.Units, so closing the union "would therefore have meant an
// Uplink could never declare a unit at all, which contradicts third parties being
// first-class." That argument is about the unit ANNOTATION on a field. This is the
// same argument about the SHAPE of a field.
//
// ── Never edited as providers arrive ─────────────────────────────────────────
// This file is the WHOLE core change, made once. A new provider adds nothing here:
// it writes its own namespace server-side and ships its own typed parser
// client-side. Adding the bag to another elected payload is one attribute line on
// that payload (see ProviderExtensionBagAttribute), not a re-invention.
//
// ── The wire already tolerated it ────────────────────────────────────────────
// Every relocated Uplink's payload file records that its C# classes are
// "TYPING-ONLY ... they add no wire bytes; the wire is written by JsonWriter
// walking the uplink's live value tree." The transport has always carried
// arbitrary nested values; only the generated TS interface gated what a consumer
// could TYPEDLY read. The bag is the reserved hole in that gate.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Marks a property as a provider-namespaced extension bag: a
/// <c>Dictionary&lt;string, object?&gt;</c> keyed by PROVIDER ID (the same id the
/// provider registers with the <see cref="Kernel"/>, and the same string the
/// payload's own <c>Source</c>-style tag carries), whose values are that
/// provider's own opaque sub-tree.
///
/// <para>The attribute is the one line that adds the bag to a payload.
/// <c>RtConfig.ApplyProviderExtensionTypes</c> reflects over it and retypes the
/// property to the TypeScript <c>ProviderExtensions</c>, so a payload never spells
/// the TS type out and adding the bag to <c>science.*</c> later is an attribute,
/// not a second mechanism.</para>
///
/// <para>Keyed by provider id so two providers never collide and a reader selects
/// its own namespace: an elected capability has one active provider at a time, but
/// more than one provider's CLIENT can be installed, and a delayed/archived frame
/// can predate an election change.</para>
/// </summary>
[AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = false)]
public sealed class ProviderExtensionBagAttribute : Attribute
{
}

/// <summary>
/// The bag's shared vocabulary, in one place so the C# producer, the wire writer,
/// the codegen and the client runtime all name it identically.
/// </summary>
public static class ProviderExtensions
{
    /// <summary>
    /// The reserved wire key a bag serialises under, on every payload that
    /// carries one. The client runtime looks for exactly this name when it
    /// hydrates a provider's namespace, so it is a constant rather than a
    /// per-payload choice.
    /// </summary>
    public const string WireField = "extensions";

    /// <summary>
    /// The TypeScript type the bag is emitted as. Hand-written in the SDK
    /// (<c>mod/sitrep-sdk/src/extensions.ts</c>) and deliberately OPAQUE at the
    /// core layer: core cannot know a provider's shape, and pretending otherwise
    /// is the closed-enum mistake this mechanism exists to avoid. The provider's
    /// own package supplies the type at its own boundary.
    /// </summary>
    public const string TsTypeName = "ProviderExtensions";

    /// <summary>
    /// Where the generated contract imports <see cref="TsTypeName"/> from, as seen
    /// from core's own generated file. An Uplink generating into its own
    /// <c>client/src/__generated__/</c> passes its own path, exactly like
    /// <c>RtConfig.ApplyUnitValueTypes</c>'s <c>valueImportFrom</c>.
    /// </summary>
    public const string DefaultTsImportFrom = "../extensions";
}
