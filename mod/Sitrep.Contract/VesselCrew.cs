using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One crew member in the <c>vessel.crew</c> payload's <c>crew</c> roster.
/// Typing-only mirror of the entry <c>Sitrep.Host.VesselViewProvider</c> reads
/// out of the snapshot's <c>crew</c> group — every field nullable because each
/// is read through <c>SnapshotDict.Get*</c>, which yields <c>null</c> (not a
/// sentinel) on absence. Sourced from KSP's <c>ProtoCrewMember</c>:
/// <c>name</c>/<c>trait</c>/<c>experienceLevel</c> plus the <c>type</c>
/// (<c>KerbalType</c>) and <c>rosterStatus</c> (<c>RosterStatus</c>) enums,
/// captured as their string names.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CrewMember
{
    public string? Name { get; set; }

    public string? Trait { get; set; }

    public int? ExperienceLevel { get; set; }

    public string? Type { get; set; }

    public string? RosterStatus { get; set; }
}

/// <summary>
/// The <c>vessel.crew</c> channel payload. Started count-only for M1 (G-13:
/// grows to a full roster later WITHOUT a topic rename, per the design doc
/// §2.2's "misc junk drawer split"). The roster (<see cref="Crew"/>) and
/// <see cref="Capacity"/> are that additive growth — new fields on the same
/// record, same topic. Splitting this out of KspHost's <c>misc</c> group into
/// its own coherent, independently-growable channel is itself part of the
/// wart-fix.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.crew")]
public class VesselCrew
{
    public int Count { get; set; }

    public int Capacity { get; set; }

    public List<CrewMember> Crew { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}
