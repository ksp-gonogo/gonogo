#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One launch site in the <c>spaceCenter.launchSites</c> channel — the union of
/// the stock KSC pad + runway, any Making History sites, and any Kerbal
/// Konstructs sites (KK registers its sites into
/// <c>PSystemSetup.Instance.LaunchSites</c> via the public <c>AddLaunchSite</c>
/// API, so enumerating that one list already covers all three — no reflection,
/// no hard KK link). Produced by
/// <c>Sitrep.Host.SpaceCenterViewProvider.BuildLaunchSites</c>.
///
/// <para>The channel is a BARE ARRAY of these entries (tagged
/// <c>isArray: true</c>, like the <c>science.*</c> channels), NOT a wrapper
/// object and NOT a KSC singleton — KSP has many launch sites, keyed by
/// <see cref="Name"/>. The whole payload is <c>null</c> (not an empty array)
/// when no sample has landed yet — the provider's "no data yet" vs. "zero
/// sites" distinction.</para>
///
/// <para>Mirrors the exact per-site dict the provider emits — same field
/// names, casing and nullability; a TS-shape-only typing/codegen marker (no
/// <c>Meta</c>, same <c>system</c>/<c>spaceCenter</c>-domain convention as
/// <see cref="SystemBodies"/>: the provider hand-builds the dict and
/// <c>JsonWriter</c> walks that live tree, these POCOs never serialize).
/// Classified <c>DelayRole.TrueNow</c> — ground-side facts, known independent
/// of any vessel's comms link, same class as <see cref="SystemBodies"/> /
/// <see cref="GameDlc"/>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.launchSites", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class LaunchSiteEntry
{
    /// <summary>Internal launch-site id (<c>LaunchSite.name</c>) — the stable key used with <c>PSystemSetup</c>'s lookup APIs; null when the live game hasn't populated it.</summary>
    public string? Name { get; set; }

    /// <summary>Human-facing display name (<c>PSystemSetup.GetLaunchSiteDisplayName</c>, falling back to <c>LaunchSite.launchSiteName</c>).</summary>
    public string? DisplayName { get; set; }

    /// <summary>Which editor this site launches from — the pad-vs-runway distinction — as the <c>EditorFacility</c> enum name (<c>"None"</c>/<c>"VAB"</c>/<c>"SPH"</c>); a VAB site is a pad, an SPH site a runway.</summary>
    public string? EditorFacility { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/> of the body this site sits on; null when absent or unresolved (never a sentinel like -1).</summary>
    public int? BodyIndex { get; set; }

    /// <summary>Whether this is a stock KSP launch site (<c>PSystemSetup.IsStockLaunchSite</c>) — false for Making History / Kerbal Konstructs sites.</summary>
    public bool? IsStock { get; set; }

    /// <summary>Whether a vessel is currently sitting on this pad. There is no clean stock per-site occupancy API, so for now this is populated ONLY on the stock KSC pad, derived from the active vessel being in the PRELAUNCH situation; every other site carries null (per-site true occupancy is a follow-up).</summary>
    public bool? PadOccupied { get; set; }

    /// <summary>Name of the vessel occupying this pad, when derivable (depends on <see cref="PadOccupied"/>); null until per-site occupancy exists beyond the stock-pad PRELAUNCH derivation.</summary>
    public string? PadVesselTitle { get; set; }
}

/// <summary>
/// The <c>spaceCenter.scene</c> channel payload — the single current KSP game
/// scene, produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildScene</c>.
/// This is the migration target for the legacy Telemachus <c>kc.scene</c> key:
/// <see cref="Scene"/> carries exactly one of the six strings
/// <c>{"Flight","SpaceCenter","Editor","TrackingStation","MainMenu","Other"}</c>
/// (the provider folds KSP's <c>GameScenes</c> enum onto that fixed set; any
/// scene outside the five named ones — <c>LOADING</c>, <c>PSYSTEM</c>,
/// <c>MISSIONBUILDER</c>, … — maps to <c>"Other"</c>).
///
/// <para>Mirrors the exact serialized shape the provider emits (a wrapper
/// object <c>{ "scene": string }</c>); a TS-shape-only typing/codegen marker
/// that does NOT participate in serialization. The whole payload is
/// <c>null</c> when no sample has landed yet. No per-payload <c>Meta</c> (it
/// rides the envelope), classified <c>DelayRole.TrueNow</c> — a ground-side
/// game-state fact, same class as <see cref="SystemBodies"/>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.scene")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SpaceCenterScene
{
    /// <summary>The current scene, one of <c>"Flight"</c>/<c>"SpaceCenter"</c>/<c>"Editor"</c>/<c>"TrackingStation"</c>/<c>"MainMenu"</c>/<c>"Other"</c>.</summary>
    public string? Scene { get; set; }

    /// <summary>The launch site currently selected in the editor (<c>EditorLogic.launchSiteName</c>) — the migration target for the legacy <c>kc.launchSite</c> key. Null outside the editor scene (EditorLogic isn't live), never a fabricated default.</summary>
    public string? LaunchSite { get; set; }
}

/// <summary>
/// One kerbal in the <c>spaceCenter.crewRoster</c> channel — the hired-crew
/// roster (KSP's <c>KerbalRoster.Crew</c>: owned crew that is either available
/// or currently assigned to a mission, tourists/applicants excluded). Produced
/// by <c>Sitrep.Host.SpaceCenterViewProvider.BuildCrewRoster</c>.
///
/// <para>The channel is a BARE ARRAY of these entries (tagged
/// <c>isArray: true</c>, like <see cref="LaunchSiteEntry"/>), one per crew
/// member keyed by <see cref="Name"/>. The whole payload is <c>null</c> (not an
/// empty array) when no sample has landed yet — the provider's "no data yet" vs.
/// "zero crew" distinction.</para>
///
/// <para>One wire shape serves both consumers: StaffRoster reads
/// <see cref="Name"/>/<see cref="Trait"/>/<see cref="ExperienceLevel"/>, and
/// LaunchDirector additionally reads <see cref="Available"/>/
/// <see cref="UnavailableReason"/> (both derived from the kerbal's roster
/// status). A TS-shape-only typing/codegen marker: the provider hand-builds the
/// dict and <c>JsonWriter</c> walks that live tree, these POCOs never serialize.
/// Classified <c>DelayRole.TrueNow</c> — a ground-side career fact, same class
/// as <see cref="LaunchSiteEntry"/>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.crewRoster", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CrewRosterEntry
{
    /// <summary>Kerbal name (<c>ProtoCrewMember.name</c>).</summary>
    public string? Name { get; set; }

    /// <summary>Specialisation (<c>ProtoCrewMember.trait</c>) — <c>"Pilot"</c>/<c>"Engineer"</c>/<c>"Scientist"</c>/<c>"Tourist"</c>.</summary>
    public string? Trait { get; set; }

    /// <summary>Experience level (<c>ProtoCrewMember.experienceLevel</c>), 0–5.</summary>
    public int? ExperienceLevel { get; set; }

    /// <summary>Whether the kerbal is free to fly — <c>true</c> when the roster status is <c>Available</c>, <c>false</c> otherwise.</summary>
    public bool? Available { get; set; }

    /// <summary>Why the kerbal can't fly, derived from the roster status (<c>Assigned</c>→"On mission", <c>Dead</c>/<c>Missing</c>→the status name); empty string when <see cref="Available"/> is true.</summary>
    public string? UnavailableReason { get; set; }
}

/// <summary>
/// One craft file in the <c>spaceCenter.savedShips</c> channel — a saved VAB or
/// SPH design the player can launch, read from the save's craft folders via the
/// stock <c>CraftProfileInfo</c> metadata loader. Produced by
/// <c>Sitrep.Host.SpaceCenterViewProvider.BuildSavedShips</c>.
///
/// <para>The channel is a BARE ARRAY of these entries (tagged
/// <c>isArray: true</c>), one per <c>.craft</c> file keyed by <see cref="Name"/>.
/// The whole payload is <c>null</c> (not an empty array) when no sample has
/// landed yet. A TS-shape-only typing/codegen marker (the provider hand-builds
/// the dict, these POCOs never serialize). Classified <c>DelayRole.TrueNow</c>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.savedShips", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SavedShipEntry
{
    /// <summary>Craft name (<c>CraftProfileInfo.shipName</c>).</summary>
    public string? Name { get; set; }

    /// <summary>Part count (<c>CraftProfileInfo.partCount</c>).</summary>
    public int? PartCount { get; set; }

    /// <summary>Total mass in tonnes (<c>CraftProfileInfo.totalMass</c>).</summary>
    public double? TotalMass { get; set; }

    /// <summary>Which editor built it — the <c>EditorFacility</c> enum name, <c>"VAB"</c> or <c>"SPH"</c> (<c>CraftProfileInfo.shipFacility</c>).</summary>
    public string? Facility { get; set; }

    /// <summary>Funds needed before this can launch — the full craft cost (<c>CraftProfileInfo.totalCost</c>).</summary>
    public double? RequiresFunds { get; set; }

    /// <summary>Parts referenced by the craft that are not yet unlocked/purchased (<c>CraftProfileInfo.UnavailableShipParts</c>); an empty array when the craft is buildable as-is.</summary>
    public string[]? MissingParts { get; set; }
}

/// <summary>
/// The <c>spaceCenter.partsAvailable</c> channel payload — a wrapper carrying
/// the count of parts the player can place right now (tech-unlocked AND
/// purchased in career; the full <c>PartLoader</c> catalogue in sandbox).
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildPartsAvailable</c>.
///
/// <para>A wrapper object (a bare scalar has no Topic shape); the SpaceCenterStatus
/// widget reads <c>spaceCenter.partsAvailable.count</c>. The whole payload is
/// <c>null</c> when no sample has landed yet. A TS-shape-only typing/codegen
/// marker that never serializes. Classified <c>DelayRole.TrueNow</c>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.partsAvailable")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SpaceCenterPartsAvailable
{
    /// <summary>Count of buildable parts.</summary>
    public int? Count { get; set; }
}
