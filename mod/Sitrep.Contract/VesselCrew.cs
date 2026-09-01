using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One crew member in the <c>vessel.crew</c> payload's <c>crew</c> roster.
/// Typing-only mirror of the entry <c>Sitrep.Host.VesselViewProvider</c> reads
/// out of the snapshot's <c>crew</c> group: every field nullable because each
/// is read through <c>SnapshotDict.Get*</c>, which yields <c>null</c> (not a
/// sentinel) on absence. Sourced from KSP's <c>ProtoCrewMember</c>:
/// <c>name</c>/<c>trait</c>/<c>experienceLevel</c> plus the <c>type</c>
/// (<c>KerbalType</c>) and <c>rosterStatus</c> (<c>RosterStatus</c>) enums,
/// captured as their string names.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CrewMember
{
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Trait { get; set; }

    [SitrepUnit(Units.Count)]
    public int? ExperienceLevel { get; set; }

    [SitrepUnit(Units.Id)]
    public string? Type { get; set; }

    [SitrepUnit(Units.Text)]
    public string? RosterStatus { get; set; }

    /// <summary>
    /// What this kerbal is personally carrying, from their own
    /// <c>ModuleInventoryPart</c>.
    ///
    /// <para>Here rather than on <c>vessel.inventory</c> because it answers a
    /// different question. That channel is SUPPLY, what is aboard and where.
    /// This is the ACTOR: whether THIS kerbal, whose trait and experience level
    /// sit two fields up, can do a job right now without anything being
    /// fetched first. A consumer deciding who should perform a task reads one
    /// payload, not a join.</para>
    ///
    /// <para>Null when the crew source could not read inventories at all,
    /// which is not the same as an empty list, meaning they are carrying
    /// nothing.</para>
    /// </summary>
    public List<InventoryItem>? Carrying { get; set; }

    /// <summary>The kerbal's own slot count, stock default 2, one of which usually holds a parachute.</summary>
    [SitrepUnit(Units.Count)]
    public int? Slots { get; set; }

    /// <summary>Their packed-volume limit, stock default 40 in KSP's own cargo-volume unit. With a repair kit at 5, this is what actually bounds how many they can carry.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolumeLimit { get; set; }

    /// <summary>Packed volume they are currently using, same unit as the limit.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolumeUsed { get; set; }
}

/// <summary>
/// The <c>vessel.crew</c> channel payload. Started count-only for M1 (G-13:
/// grows to a full roster later WITHOUT a topic rename, per the
/// "misc junk drawer split" ruling). The roster (<see cref="Crew"/>) and
/// <see cref="Capacity"/> are that additive growth, new fields on the same
/// record, same topic. Splitting this out of KspHost's <c>misc</c> group into
/// its own coherent, independently-growable channel is itself part of the
/// wart-fix.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.crew")]
public class VesselCrew
{
    [SitrepUnit(Units.Count)]
    public int Count { get; set; }

    [SitrepUnit(Units.Count)]
    public int Capacity { get; set; }

    public List<CrewMember> Crew { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}
