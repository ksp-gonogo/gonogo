using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/*
 * isru.* is a Domain-neutral capability namespace, the same shape as reliability.*: more than
 * one mod models in-situ resource extraction (stock's ModuleResourceHarvester and
 * ModuleResourceConverter, and mods that replace both), so one exclusive "isru" capability is
 * elected in the Kernel and its active instance is an IIsruBackend. A core registrar owns the
 * capability, supplies the stock backend as its Vanilla factory and declares both isru.*
 * channels once; a modelling mod registers a provider from its own Uplink, gated by its own
 * presence probe, and declares neither channel.
 *
 * There is no "unmodeled" flag: stock ISRU is a real system, so the vanilla backend is a real
 * reader and an empty list means "no drills on this vessel", never "ISRU is not tracked".
 */

/// <summary>
/// One drill (resource harvester) on the active vessel. The field set is what
/// every ISRU model shares, which is exactly what stock ISRU has: resource,
/// abundance, rate, deploy and running, plus the two identification fields.
/// Anything one provider knows and another does not goes in
/// <see cref="Extensions"/>.
///
/// <para>The <c>isru.drills</c> payload is an array of these. An empty array
/// means the vessel has no drills, never that ISRU is not tracked.</para>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("isru.drills", isArray: true)]
public class IsruDrillEntry
{
    /// <summary>Part.flightID stringified: the same join key vessel.parts/parts.power/reliability.parts use.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>Part.partInfo.title, for display without a vessel.parts join.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartTitle { get; set; }

    /// <summary>
    /// Resource this drill extracts (e.g. "Ore"). Free text, not a closed enum:
    /// whatever the running install's configs and profiles name, the same posture
    /// every other resource-identity field in this contract takes.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Resource { get; set; }

    /// <summary>Drill head deployed. Null for a harvester with no deploy animation, e.g. some asteroid drills.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Deployed { get; set; }

    /// <summary>Actively extracting this tick.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Running { get; set; }

    /// <summary>
    /// Local abundance of <see cref="Resource"/> at the drill's current position,
    /// 0..1. Stock reads the same resource map the right-click PAW does. A mod
    /// that samples its own abundance reports that instead, and for asteroid or
    /// comet mining the remaining-mass ratio of the source rock lands here: the
    /// same 0..1 shape from a different source. Null when the backend has no
    /// abundance concept for this harvest type.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Abundance { get; set; }

    /// <summary>
    /// EFFECTIVE current extraction rate, already abundance- and
    /// efficiency-adjusted rather than the static config rate, so it matches what
    /// the part's own readout shows. Zero rather than null when
    /// <see cref="Running"/> is false: the drill genuinely extracts nothing, which
    /// is a number, not an absence.
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? Rate { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how an ISRU backend carries a
    /// per-drill field this shared shape does not declare. See <see cref="ProviderExtensionBagAttribute"/> for the whole
    /// mechanism. Null for the vanilla backend, which has nothing stock does not
    /// already say. A blocking-reason string, an EC draw, an asteroid's remaining
    /// mass: all of those belong here rather than as nullable members above.
    /// </summary>
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One resource flow in a converter's recipe, input or output side. The rate is
/// live (already scaled by whatever the part's current efficiency or capacity
/// multiplier is), not the raw recipe ratio, so an operator reads what is
/// actually moving rather than what the config asked for.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class IsruResourceFlow
{
    /// <summary>The resource's name as the install's configs name it (for
    /// example "Ore", "LiquidFuel"). Free text, not a closed enum. <c>null</c>
    /// when the recipe entry names no resource.</summary>
    [SitrepUnit(Units.Text)]
    public string? Resource { get; set; }

    /// <summary>The live rate this resource is consumed (on an input) or
    /// produced (on an output) at, already scaled by the converter's current
    /// efficiency.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? Rate { get; set; }
}

/// <summary>
/// One chemical converter on the active vessel. Field set matches stock's
/// surface: whether it is running, and the recipe it is running, at live rates.
/// The <c>isru.converters</c> payload is an array of these; empty when the
/// vessel has no converters.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("isru.converters", isArray: true)]
public class IsruConverterEntry
{
    /// <summary>Part.flightID stringified: the same join key as
    /// <see cref="IsruDrillEntry.PartId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>Part.partInfo.title, for display without a vessel.parts
    /// join.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartTitle { get; set; }

    /// <summary>Actively converting this tick.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Running { get; set; }

    /// <summary>Recipe inputs at their live rate. Empty list, not null, when the converter carries no recipe.</summary>
    public List<IsruResourceFlow> Inputs { get; set; } = new();

    /// <summary>Recipe outputs at their live rate. Empty list, not null, when the converter carries no recipe.</summary>
    public List<IsruResourceFlow> Outputs { get; set; } = new();

    /// <summary>
    /// The provider-namespaced extension bag, converter half. Same mechanism and
    /// same rule as <see cref="IsruDrillEntry.Extensions"/>.
    ///
    /// <para>A starved recipe has no blocking-reason field: a converter that is
    /// on but moving nothing is <see cref="Running"/> true alongside zero rates,
    /// so derive that condition from the shared fields.</para>
    /// </summary>
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// The "isru" capability's active-instance interface (parallel to
/// <see cref="IReliabilityBackend"/>). An Uplink that models ISRU implements it
/// and registers it as a Kernel provider; the elected one's readouts are
/// published on <c>isru.drills</c> and <c>isru.converters</c>. Parameterless and
/// KSP-free: an implementation reads the active vessel itself.
///
/// <para><b>Main thread only.</b> Both readers walk live PartModules, so they
/// are called from the main-thread capture and never from a channel mapper,
/// which runs off the main thread.</para>
/// </summary>
/// <category>Uplink API</category>
public interface IIsruBackend : ISitrepProvider
{
    /// <summary>Every drill on the active vessel. Empty, never null, when there are none.</summary>
    IReadOnlyList<IsruDrillEntry> Drills();

    /// <summary>Every chemical converter on the active vessel. Empty, never null, when there are none.</summary>
    IReadOnlyList<IsruConverterEntry> Converters();
}
