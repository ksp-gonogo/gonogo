using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One entry in the <c>target.available</c> list: anything the active vessel
/// could set as its target right now. Produced generically off KSP's
/// <c>ITargetable</c> contract (Vessel / CelestialBody / ModuleDockingNode all
/// implement it), then classified by concrete type into a <see cref="Kind"/> +
/// its stable id, rather than three hardcoded per-kind lists, so a modded
/// <c>ITargetable</c> shows up as <see cref="TargetKind.Other"/> with no code
/// change. The stable id per kind (<see cref="VesselId"/> guid /
/// <see cref="BodyIndex"/> / <see cref="PartId"/> flightID) is the SAME id
/// <see cref="SetTargetArgs"/> takes, so a widget hands an entry straight back
/// into <c>vessel.target.set</c> with no lookup.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class TargetListEntry
{
    [SitrepUnit(Units.Enumeration)]
    public TargetKind Kind { get; set; }

    /// <summary>Clean display name (KSP <c>GetDisplayName()</c>, falling back to <c>GetName()</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>Stable vessel guid: set for <see cref="TargetKind.Vessel"/>, and the OWNING vessel for a <see cref="TargetKind.Part"/>. Null otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>Index into <c>system.bodies</c>: set for <see cref="TargetKind.Body"/>. Null otherwise.</summary>
    public int? BodyIndex { get; set; }

    /// <summary>KSP <c>Part.flightID</c>: set for <see cref="TargetKind.Part"/> (scoped by <see cref="VesselId"/>). Null otherwise.</summary>
    public uint? PartId { get; set; }

    /// <summary>Vessel type: set for <see cref="TargetKind.Vessel"/> / <see cref="TargetKind.Part"/> (the owning vessel's type). Null otherwise.</summary>
    [SitrepUnit(Units.Enumeration)]
    public VesselType? VesselType { get; set; }

    /// <summary>Flight situation: set for <see cref="TargetKind.Vessel"/>. Null otherwise.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Situation? Situation { get; set; }

    /// <summary>
    /// Current metric distance (metres) from the active vessel. A coarse sort
    /// aid for the picker, NOT a HUD value, it rides the periodic re-key, not
    /// the change-gate (it moves every tick). Live distance for the CURRENT
    /// target comes off <c>vessel.target</c>. Null when a transform wasn't
    /// available this tick.
    /// </summary>
    public double? Distance { get; set; }

    /// <summary>True when this entry is the active vessel's current target (<c>FlightGlobals.fetch.VesselTarget</c>) right now.</summary>
    [SitrepUnit(Units.Flag)]
    public bool IsCurrent { get; set; }
}

/// <summary>
/// The <c>target.available</c> channel payload: the list of everything
/// targetable from the active vessel. Wrapper object <c>{ "entries": [ ... ] }</c>,
/// mirroring the provider's hand-built shape (like <c>system.vessels</c>).
/// Emitted part-tree style: a full keyframe on subscribe (sticky-cached for
/// late subscribers), then re-emitted on set-change (a target enters/leaves
/// range, or the current target changes) plus a slow heartbeat re-key,
/// per-entry <see cref="TargetListEntry.Distance"/> rides that periodic re-key,
/// deliberately NOT the change-gate.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("target.available")]
public class TargetAvailable
{
    public IReadOnlyList<TargetListEntry> Entries { get; set; } = new List<TargetListEntry>();
}
