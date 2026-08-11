using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// ISRU / resource ops: a Domain-NEUTRAL capability namespace (isru.*), the same
// shape reliability.* and science.* follow. More than one mod models in-situ
// resource extraction (stock's own ModuleResourceHarvester/ModuleResourceConverter,
// and mods that delete both and replace them wholesale), so it rides the Kernel
// capability election rather than belonging to any one uplink Domain.
//
//   • ONE exclusive capability "isru" whose active instance is an IIsruBackend.
//   • A core registrar (mod/Gonogo.KSP/IsruCoreUplink.cs) OWNS the capability,
//     supplies the stock backend as its Vanilla factory, declares the two isru.*
//     channels ONCE, and sources them from whichever backend the election picked
//     (Kernel.Query<IIsruBackend>("isru")).
//   • A modelling mod registers a provider from its OWN uplink's Register, gated
//     by its own presence probe, and declares neither channel itself.
//
// ── Why there is no "unmodeled" flag ─────────────────────────────────────────
// Reliability needs one because plain stock has no reliability system at all, so
// its vanilla backend has nothing to say. Stock ISRU is a real system, so the
// vanilla backend here is a real reader and an EMPTY list is meaningful in its own
// right: "no drills on this vessel", never "ISRU is not tracked". A flag would
// only be able to lie.
//
// ── What is deliberately absent ──────────────────────────────────────────────
// No logistics/supply-line field and no process-pipeline graph object. Neither
// stock nor any surveyed modelling mod has either concept, so a field for one
// could only ever be null. A client that wants a flow view derives it by matching
// resource names across these two channels, and must label it as gonogo's own
// view rather than as something the game reports.
//
// The entry types are wire POCOs (typing + codegen). IIsruBackend is the
// capability's active-instance interface, NOT a wire type: parameterless and
// KSP-free (backends read the active vessel internally, exactly like
// IReliabilityBackend), so Sitrep.Contract stays KSP-free / MIT.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// One drill (resource harvester) on the active vessel. The field set is
/// deliberately exactly what stock ISRU has: resource, abundance, rate, deploy,
/// running, plus the two identification fields every list-shaped payload in this
/// contract carries. It is not "stock's fields with nulls for what a richer mod
/// does", it is the literal intersection, and the intersection happens to be
/// everything stock has. Anything one provider knows and another does not goes in
/// <see cref="Extensions"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
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
    /// per-drill field this shared shape does not declare, WITHOUT a PR against
    /// this file. See <see cref="ProviderExtensionBagAttribute"/> for the whole
    /// mechanism. Null for the vanilla backend, which has nothing stock does not
    /// already say. A blocking-reason string, an EC draw, an asteroid's remaining
    /// mass: all of those belong here rather than as nullable members above.
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One resource flow in a converter's recipe, input or output side. The rate is
/// live (already scaled by whatever the part's current efficiency or capacity
/// multiplier is), not the raw recipe ratio, so an operator reads what is
/// actually moving rather than what the config asked for.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class IsruResourceFlow
{
    [SitrepUnit(Units.Text)]
    public string? Resource { get; set; }

    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? Rate { get; set; }
}

/// <summary>
/// One chemical converter on the active vessel. Field set matches stock's
/// surface: whether it is running, and the recipe it is running, at live rates.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("isru.converters", isArray: true)]
public class IsruConverterEntry
{
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? PartTitle { get; set; }

    /// <summary>Actively converting this tick.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Running { get; set; }

    /// <summary>Recipe inputs at their live rate. Empty list, not null, when the converter carries no recipe.</summary>
    public List<IsruResourceFlow> Inputs { get; set; } = new();

    /// <summary>Recipe outputs at their live rate.</summary>
    public List<IsruResourceFlow> Outputs { get; set; } = new();

    /// <summary>
    /// The provider-namespaced extension bag, converter half. Same mechanism and
    /// same rule as <see cref="IsruDrillEntry.Extensions"/>.
    ///
    /// <para>Note what does NOT belong here: a blocking-reason string for a
    /// starved recipe. A converter that is on but moving nothing is already fully
    /// described by <see cref="Running"/> true alongside zero rates, so a reader
    /// derives that condition from the shared fields. Inventing an issue field
    /// would mean fabricating a diagnostic no engine actually reports.</para>
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// The "isru" capability's active-instance interface (parallel to
/// <see cref="IReliabilityBackend"/>). Parameterless + KSP-free: implementations
/// live in the KSP-referencing uplink projects and read the active vessel
/// internally. Registered as a Kernel provider by each modelling uplink; the core
/// registrar resolves the elected one and publishes its readouts on isru.*.
///
/// <para><b>Main thread only.</b> Both readers walk live PartModules, so the core
/// registrar calls them from its main-thread capture and never from a channel
/// mapper (which runs on the Courier thread).</para>
/// </summary>
public interface IIsruBackend
{
    /// <summary>A short id for the elected backend, e.g. "stock".</summary>
    string BackendId { get; }

    /// <summary>Every drill on the active vessel. Empty, never null, when there are none.</summary>
    IReadOnlyList<IsruDrillEntry> Drills();

    /// <summary>Every chemical converter on the active vessel. Empty, never null, when there are none.</summary>
    IReadOnlyList<IsruConverterEntry> Converters();
}
