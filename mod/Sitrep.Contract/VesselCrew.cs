using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One crew member aboard the active vessel, in <see cref="VesselCrew.Crew"/>,
/// from KSP's <c>ProtoCrewMember</c>. Every field is nullable: an absent value
/// is null, never a sentinel.
/// <internal>
/// Typing-only mirror of the entry Sitrep.Host.VesselViewProvider reads out of
/// the snapshot's crew group through SnapshotDict.Get*, which yields null on
/// absence.
/// </internal>
/// </summary>
/// <category>Crew</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CrewMember
{
    /// <summary>The kerbal's name (<c>ProtoCrewMember.name</c>), which is also their roster key.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>The kerbal's career trait (<c>ProtoCrewMember.trait</c>), e.g. <c>"Pilot"</c>, <c>"Engineer"</c>, <c>"Scientist"</c> or <c>"Tourist"</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Trait { get; set; }

    /// <summary>The kerbal's experience level (<c>ProtoCrewMember.experienceLevel</c>), 0 to 5 in stock.</summary>
    [SitrepUnit(Units.Count)]
    public int? ExperienceLevel { get; set; }

    /// <summary>The kerbal's <c>KerbalType</c> member name: <c>"Crew"</c>, <c>"Tourist"</c>, <c>"Applicant"</c> or <c>"Unowned"</c> in stock.</summary>
    [SitrepUnit(Units.Id)]
    public string? Type { get; set; }

    /// <summary>The kerbal's <c>RosterStatus</c> member name: <c>"Available"</c>, <c>"Assigned"</c>, <c>"Dead"</c> or <c>"Missing"</c> in stock. A kerbal aboard a vessel is normally <c>"Assigned"</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? RosterStatus { get; set; }

    /// <summary>
    /// What this kerbal is personally carrying, from their own
    /// <c>ModuleInventoryPart</c>.
    ///
    /// <para>Distinct from <c>vessel.inventory</c>, which is what is aboard and
    /// where. This is what this kerbal, with the trait and experience level
    /// above, has to hand for a job right now without anything being fetched
    /// first.</para>
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
/// The <c>vessel.crew</c> payload: who is aboard the active vessel and how many
/// seats it has.
/// </summary>
/// <category>Crew</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.crew")]
public class VesselCrew
{
    /// <summary>How many crew are aboard.</summary>
    [SitrepUnit(Units.Count)]
    public int Count { get; set; }

    /// <summary>How many crew seats the vessel has.</summary>
    [SitrepUnit(Units.Count)]
    public int Capacity { get; set; }

    /// <summary>Each crew member aboard.</summary>
    public List<CrewMember> Crew { get; set; } = new();

    /// <summary>Which vessel this describes.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
