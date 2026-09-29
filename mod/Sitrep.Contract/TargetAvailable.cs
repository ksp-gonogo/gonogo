using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One entry in the <c>target.available</c> list: anything the active vessel
/// could set as its target right now. Built from KSP's <c>ITargetable</c>
/// (Vessel / CelestialBody / ModuleDockingNode all implement it) and classified
/// by concrete type into a <see cref="Kind"/> plus its stable id, so a modded
/// <c>ITargetable</c> appears as <see cref="TargetKind.Other"/>. The stable id per kind (<see cref="VesselId"/> guid /
/// <see cref="BodyIndex"/> / <see cref="PartId"/> flightID) is the SAME id
/// <see cref="SetTargetArgs"/> takes, so a widget hands an entry straight back
/// into <c>vessel.target.set</c> with no lookup.
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TargetListEntry
{
    /// <summary>
    /// What sort of target this is, which says which id field is set:
    /// <see cref="VesselId"/> for a vessel, <see cref="BodyIndex"/> for a body,
    /// <see cref="PartId"/> (with <see cref="VesselId"/>) for a part.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public TargetKind Kind { get; set; }

    /// <summary>Clean display name (KSP <c>GetDisplayName()</c>, falling back to <c>GetName()</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>Stable vessel guid: set for <see cref="TargetKind.Vessel"/>, and the OWNING vessel for a <see cref="TargetKind.Part"/>. Null otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>Index into <c>system.bodies</c>: set for <see cref="TargetKind.Body"/>. Null otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>KSP <c>Part.flightID</c>: set for <see cref="TargetKind.Part"/> (scoped by <see cref="VesselId"/>). Null otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public uint? PartId { get; set; }

    /// <summary>Vessel type: set for <see cref="TargetKind.Vessel"/> / <see cref="TargetKind.Part"/> (the owning vessel's type). Null otherwise.</summary>
    [SitrepUnit(Units.Enumeration)]
    public VesselType? VesselType { get; set; }

    /// <summary>Flight situation: set for <see cref="TargetKind.Vessel"/>. Null otherwise.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Situation? Situation { get; set; }

    /// <summary>
    /// Distance from the active vessel, as of the last emission. A coarse sort
    /// aid for a picker, NOT a live readout: it moves every tick but is only
    /// refreshed on the channel's slow periodic re-send, and a change in it
    /// alone does not trigger an emission. Live distance for the CURRENT target
    /// comes off <c>vessel.target</c>. Null when a position was not available
    /// this tick.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? Distance { get; set; }

    /// <summary>True when this entry is the active vessel's current target (<c>FlightGlobals.fetch.VesselTarget</c>) right now.</summary>
    [SitrepUnit(Units.Flag)]
    public bool IsCurrent { get; set; }
}

/// <summary>
/// The <c>target.available</c> channel payload: the list of everything
/// targetable from the active vessel. Wrapper object <c>{ "entries": [ ... ] }</c>,
/// like <c>system.vessels</c>. A full keyframe arrives on subscribe (a late
/// subscriber gets the last one), then the list is re-sent whenever the set
/// changes (a target enters or leaves range, or the current target changes)
/// and on a slow periodic re-send, which is what refreshes each
/// <see cref="TargetListEntry.Distance"/>.
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("target.available")]
public class TargetAvailable
{
    /// <summary>Every current target candidate. Empty, never null, when there is none.</summary>
    public IReadOnlyList<TargetListEntry> Entries { get; set; } = new List<TargetListEntry>();
}
