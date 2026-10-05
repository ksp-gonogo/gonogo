using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// How the active vessel comes to know of another vessel on
/// <c>target.available</c>, which is also how old what it knows can be.
/// </summary>
/// <category>Orbits and trajectories</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TargetKnowledge
{
    /// <summary>The other vessel is within physics range of the active vessel, which sees it as it is.</summary>
    InRange,

    /// <summary>The other vessel's radio reaches the active vessel directly, so what is known of it is one light-time of that link old.</summary>
    DirectLink,

    /// <summary>
    /// The active vessel's command centre knows of the other vessel, by
    /// tracking it or by hearing from it, and has told the active vessel over
    /// its control route. What is known is as old as the centre's own
    /// knowledge plus that route's light-time.
    /// </summary>
    CommandCentre,
}

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

    /// <summary>
    /// How the active vessel knows of this vessel: see
    /// <see cref="TargetKnowledge"/>. Set for <see cref="TargetKind.Vessel"/>
    /// and for a <see cref="TargetKind.Part"/>, which is always in range. Null
    /// for a body, whose place is an ephemeris and not something learned.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public TargetKnowledge? Source { get; set; }

    /// <summary>
    /// The universal time what is known of this vessel was true at: now for
    /// one in range, and otherwise when the newest word or sighting of it the
    /// active vessel holds was made. The vessel's <see cref="Situation"/> and
    /// <see cref="Orbit"/> are as of this instant. Null for a body.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? AsOfUt { get; set; }

    /// <summary>
    /// The display name of the command centre that told the active vessel of
    /// this one, for <see cref="TargetKnowledge.CommandCentre"/>. Null
    /// otherwise.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Via { get; set; }

    /// <summary>
    /// The vessel's orbit as of <see cref="AsOfUt"/>, so its place now can be
    /// worked out from where it was last known to be going. Null for a vessel
    /// not on an orbit, one whose orbit the active vessel has not been told,
    /// a part and a body.
    /// </summary>
    public OrbitEntry? Orbit { get; set; }

    /// <summary>Index into <c>system.bodies</c> of the body <see cref="Orbit"/> is round. Null wherever <see cref="Orbit"/> is.</summary>
    [SitrepUnit(Units.Id)]
    public int? OrbitBodyIndex { get; set; }
}

/// <summary>
/// The <c>target.available</c> channel payload: the list of everything
/// targetable from the active vessel, as the active vessel knows it. Wrapper
/// object <c>{ "entries": [ ... ] }</c>, like <c>system.vessels</c>.
///
/// <para>A vessel is on the list once the active vessel has come to know of
/// it, by whichever of three ways tells it soonest: it is within physics range
/// and seen as it is; its radio reaches the active vessel directly, one
/// light-time of that link ago; or the active vessel's command centre knows of
/// it and has said so over the control route, that route's light-time ago.
/// Each entry says which (<see cref="TargetListEntry.Source"/>) and how old
/// (<see cref="TargetListEntry.AsOfUt"/>). A vessel with no route home and
/// nothing in range keeps the list it last had: entries age, none is added.
/// A vessel the active vessel has been told is gone leaves the list.</para>
///
/// <para>Delayed like the rest of the active vessel's telemetry: a centre
/// reads the list one of its own light-times after the vessel held it.</para>
/// <internal>
/// Assembled by Sitrep.Host.Comms.ContactPlanSource from CraftKnowledge. The
/// game's own list (every vessel, as it stands this instant) is read only for
/// which vessels are in range, for parts and bodies, and for which entry is
/// the current target. It was published whole, which named every vessel in
/// the game to every centre at the active vessel's light-time (Saga 102).
/// The command centre is taken to be the home centre.
/// </internal>
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
