#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One launch site in the <c>spaceCenter.launchSites</c> channel, the union of
/// the stock KSC pad + runway, any Making History sites, and any Kerbal
/// Konstructs sites (KK registers its sites into
/// <c>PSystemSetup.Instance.LaunchSites</c> via the public <c>AddLaunchSite</c>
/// API, so enumerating that one list already covers all three, no reflection,
/// no hard KK link). Produced by
/// <c>Sitrep.Host.SpaceCenterViewProvider.BuildLaunchSites</c>.
///
/// <para>The channel is a BARE ARRAY of these entries (tagged
/// <c>isArray: true</c>, like the <c>science.*</c> channels), NOT a wrapper
/// object and NOT a KSC singleton: KSP has many launch sites, keyed by
/// <see cref="Name"/>. The whole payload is <c>null</c> (not an empty array)
/// when no sample has landed yet, the provider's "no data yet" vs. "zero
/// sites" distinction.</para>
///
/// <para>Mirrors the exact per-site dict the provider emits, same field
/// names, casing and nullability; a TS-shape-only typing/codegen marker (no
/// <c>Meta</c>, same <c>system</c>/<c>spaceCenter</c>-domain convention as
/// <see cref="SystemBodies"/>: the provider hand-builds the dict and
/// <c>JsonWriter</c> walks that live tree, these POCOs never serialize).
/// Classified <c>DelayRole.TrueNow</c>: ground-side facts, known independent
/// of any vessel's comms link, same class as <see cref="SystemBodies"/> /
/// <see cref="GameDlc"/>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.launchSites", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class LaunchSiteEntry
{
    /// <summary>Internal launch-site id (<c>LaunchSite.name</c>): the stable key used with <c>PSystemSetup</c>'s lookup APIs; null when the live game hasn't populated it.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>Human-facing display name (<c>PSystemSetup.GetLaunchSiteDisplayName</c>, falling back to <c>LaunchSite.launchSiteName</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? DisplayName { get; set; }

    /// <summary>Which editor this site launches from (the pad-vs-runway distinction) as the <c>EditorFacility</c> enum name (<c>"None"</c>/<c>"VAB"</c>/<c>"SPH"</c>); a VAB site is a pad, an SPH site a runway.</summary>
    [SitrepUnit(Units.Text)]
    public string? EditorFacility { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/> of the body this site sits on; null when absent or unresolved (never a sentinel like -1).</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>Latitude of the site's spawn point on its body (<c>LaunchSite.SpawnPoint.latlonaltSet</c>); null when the site has no set spawn coordinate (never a fabricated <c>0</c>). Pairs with <see cref="Longitude"/> to give the site a location for the command-delay geometry (a launch is a command to this location).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Longitude of the site's spawn point on its body; null when the site has no set spawn coordinate. Pairs with <see cref="Latitude"/>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Whether this is a stock KSP launch site (<c>PSystemSetup.IsStockLaunchSite</c>), false for Making History / Kerbal Konstructs sites.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsStock { get; set; }

    /// <summary>Whether a vessel is currently sitting on this pad. There is no clean stock per-site occupancy API, so for now this is populated ONLY on the stock KSC pad, derived from the active vessel being in the PRELAUNCH situation; every other site carries null (per-site true occupancy is a follow-up).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? PadOccupied { get; set; }

    /// <summary>Name of the vessel occupying this pad, when derivable (depends on <see cref="PadOccupied"/>); null until per-site occupancy exists beyond the stock-pad PRELAUNCH derivation.</summary>
    [SitrepUnit(Units.Text)]
    public string? PadVesselTitle { get; set; }
}

/// <summary>
/// The <c>spaceCenter.scene</c> channel payload: the single current KSP game
/// scene, produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildScene</c>.
/// This is the migration target for the legacy <c>kc.scene</c> key:
/// <see cref="Scene"/> carries exactly one of the six strings
/// <c>{"Flight","SpaceCenter","Editor","TrackingStation","MainMenu","Other"}</c>
/// (the provider folds KSP's <c>GameScenes</c> enum onto that fixed set; any
/// scene outside the five named ones: <c>LOADING</c>, <c>PSYSTEM</c>,
/// <c>MISSIONBUILDER</c>, …: maps to <c>"Other"</c>).
///
/// <para>Mirrors the exact serialized shape the provider emits (a wrapper
/// object <c>{ "scene": string }</c>); a TS-shape-only typing/codegen marker
/// that does NOT participate in serialization. The whole payload is
/// <c>null</c> when no sample has landed yet. No per-payload <c>Meta</c> (it
/// rides the envelope), classified <c>DelayRole.TrueNow</c>: a ground-side
/// game-state fact, same class as <see cref="SystemBodies"/>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.scene")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SpaceCenterScene
{
    /// <summary>The current scene, one of <c>"Flight"</c>/<c>"SpaceCenter"</c>/<c>"Editor"</c>/<c>"TrackingStation"</c>/<c>"MainMenu"</c>/<c>"Other"</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Scene { get; set; }

    /// <summary>The launch site currently selected in the editor (<c>EditorLogic.launchSiteName</c>), the migration target for the legacy <c>kc.launchSite</c> key. Null outside the editor scene (EditorLogic isn't live), never a fabricated default.</summary>
    [SitrepUnit(Units.Text)]
    public string? LaunchSite { get; set; }
}

/// <summary>
/// One kerbal in the <c>spaceCenter.crewRoster</c> channel (the hired-crew
/// roster: KSP's <c>KerbalRoster.Crew</c>, owned crew that is either available
/// or currently assigned to a mission) and reused verbatim for every entry in
/// <see cref="AstronautComplexInfo.Applicants"/> - ONE shape for a kerbal
/// whether hired or still a candidate. Produced by
/// <c>Sitrep.Host.SpaceCenterViewProvider.BuildCrewRoster</c> /
/// <c>BuildAstronautComplex</c>.
///
/// <para>The <c>spaceCenter.crewRoster</c> channel is a BARE ARRAY of these
/// entries (tagged <c>isArray: true</c>, like <see cref="LaunchSiteEntry"/>),
/// one per crew member keyed by <see cref="Name"/>. The whole payload is
/// <c>null</c> (not an empty array) when no sample has landed yet, the
/// provider's "no data yet" vs. "zero crew" distinction.</para>
///
/// <para>LaunchDirector reads <see cref="Name"/>/<see cref="Trait"/>/
/// <see cref="ExperienceLevel"/>/<see cref="Available"/>/
/// <see cref="UnavailableReason"/> (the original, folded pair); the Astronaut
/// Complex additionally reads <see cref="Standing"/>, the authoritative
/// standing it groups by, and <see cref="Situation"/>, its label, plus the
/// full stat set
/// (<see cref="Courage"/>/<see cref="Stupidity"/>/<see cref="Experience"/>/
/// <see cref="ExperienceLevelDelta"/>) and the role tooltip text
/// (<see cref="RoleDescription"/>/<see cref="DescriptionEffects"/>). A TS-shape-only
/// typing/codegen marker: the provider hand-builds the dict and
/// <c>JsonWriter</c> walks that live tree, these POCOs never serialize.
/// Classified <c>DelayRole.TrueNow</c>: a ground-side career fact, same class
/// as <see cref="LaunchSiteEntry"/>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.crewRoster", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CrewRosterEntry
{
    /// <summary>Kerbal name (<c>ProtoCrewMember.name</c>): the id the hire command resolves against the live applicant pool.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>Specialisation (<c>ProtoCrewMember.trait</c>): <c>"Pilot"</c>/<c>"Engineer"</c>/<c>"Scientist"</c>/<c>"Tourist"</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Trait { get; set; }

    /// <summary>Experience level (<c>ProtoCrewMember.experienceLevel</c>), 0–5 (0 for a fresh applicant).</summary>
    [SitrepUnit(Units.Count)]
    public int? ExperienceLevel { get; set; }

    /// <summary>
    /// Whether the kerbal can be assigned to a flight today.
    ///
    /// <para><b>The field an old client should branch on.</b> It is derived from
    /// EVERY axis the derivation knows about, by
    /// <see cref="CrewStandings.CanFly"/>, which is a whitelist: only
    /// <c>Available</c> and <c>Applicant</c> are free, so a standing added to
    /// <see cref="CrewStanding"/> later reads as unavailable here without anybody
    /// editing a consumer. A widget that has never heard of training therefore
    /// still refuses to crew a kerbal who is mid-course.</para>
    ///
    /// <para>A backend may override it outright.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Available { get; set; }

    /// <summary>
    /// Why the kerbal can't fly, in prose: <c>Assigned</c> reads "On mission",
    /// <c>Training</c> reads "In training", <c>Resting</c> reads "Standing down",
    /// and every other blocking standing reads its own name, so a retiree reads
    /// "Retired" and not "Dead". Empty string when <see cref="Available"/> is
    /// true. A backend may override the wording.
    ///
    /// <para><b>No date, ever.</b> The when rides <see cref="StandingEndsAtUt"/>
    /// and <see cref="RetiresAtUt"/> as <c>ut</c> values, because a date
    /// formatted here would be formatted in the mod's idea of a calendar and an
    /// RSS save does not count years the way a stock one does. This is the only
    /// string on the payload a client could not re-render.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? UnavailableReason { get; set; }

    /// <summary>
    /// The kerbal's standing, as the dashboard means it: the field to BRANCH on.
    /// The elected <see cref="ICrewStandingBackend"/>'s answer where it has one,
    /// otherwise derived from KSP's roster status by the stock backend.
    ///
    /// <para>This exists because the roster status alone is NOT the answer under
    /// a career overhaul. RP-1 retires a kerbal by writing stock's <c>Dead</c>
    /// into the roster status, so <see cref="SituationOrdinal"/> below reads
    /// <c>Dead</c> for a living retiree and no reading of it can recover the
    /// difference. See <see cref="CrewStanding"/> for the whole account.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public CrewStanding? Standing { get; set; }

    /// <summary>
    /// Which provider decided <see cref="Standing"/>: the elected backend's
    /// <c>ProviderId</c>, e.g. <c>"stock"</c> or <c>"rp1"</c>. Absent when no
    /// backend was reachable at capture time.
    ///
    /// <para>Carried so a surface can attribute a correction rather than merely
    /// apply it. A retiree shown as retired is a claim about a save that stock
    /// KSP would report as a fatality, and an operator is entitled to see which
    /// mod is making it.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? StandingSource { get; set; }

    /// <summary>
    /// When the CURRENT <see cref="Standing"/> lapses, as universal time: the
    /// course ETA for <c>Training</c>, the rest period's end for <c>Resting</c>.
    /// Absent for a standing with no scheduled end, which is most of them.
    ///
    /// <para>Read with <see cref="UnavailableReason"/> to say why a kerbal cannot
    /// fly AND until when. The two are separate fields so the client formats the
    /// date in its own calendar.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? StandingEndsAtUt { get; set; }

    /// <summary>
    /// When this kerbal is scheduled to become <c>Retired</c>, as universal time.
    /// Absent under any backend that does not schedule retirements, stock
    /// included, and absent rather than zero when a backend holds no date for
    /// this kerbal: a career overhaul's own getter answers 0 for "no record", and
    /// 0 would retire the whole roster at the epoch.
    ///
    /// <para>Live at the same time as <see cref="StandingEndsAtUt"/> and not a
    /// substitute for it: a kerbal is Available or Training for years while a
    /// retirement date sits in the future.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? RetiresAtUt { get; set; }

    /// <summary>
    /// <see cref="Standing"/>'s display LABEL: its enum name, or
    /// <c>"Applicant"</c> for a hireable candidate. Text for an operator, never
    /// a branch: compare <see cref="Standing"/> instead.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>
    /// KSP's OWN ordinal: <c>(int)ProtoCrewMember.rosterStatus</c>, typed to
    /// <see cref="KspRosterStatus"/>, whose members mirror KSP's numbering.
    ///
    /// <para>A truthful read of the game field and nothing more, kept because
    /// what KSP itself holds is worth knowing and because a command core
    /// dispatches is arbitrated against this value. It is NOT the field to
    /// branch on: under RP-1 it reads <c>Dead</c> for a living retiree.
    /// <see cref="Standing"/> is the answer.</para>
    ///
    /// <para><c>null</c> for an APPLICANT, and that is a real distinction
    /// rather than a missing value: an applicant is not in the roster, so it
    /// has no <c>RosterStatus</c> at all, and <see cref="Standing"/> carries
    /// <see cref="CrewStanding.Applicant"/> instead. Use
    /// <see cref="IsApplicant"/> to tell the two apart. Also <c>null</c> when
    /// the capture carried no status.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspRosterStatus? SituationOrdinal { get; set; }

    /// <summary>
    /// Whether the kerbal is standing down rather than on duty
    /// (<c>ProtoCrewMember.inactive</c>): KSP's own field, published beside the
    /// derived answer the way <see cref="SituationOrdinal"/> is.
    ///
    /// <para><b>Not the field to branch on.</b> It is an INPUT to the derivation:
    /// a kerbal standing down has roster status <c>Available</c>, and this flag is
    /// what turns that into <see cref="CrewStanding.Resting"/> with
    /// <see cref="Available"/> false. It reached the wire with nothing deriving
    /// from it, and a resting kerbal read as free to fly the whole time.</para>
    ///
    /// <para>Stock leaves it false. A career overhaul's post-flight R&amp;R is
    /// what actually sets it, and it goes on the wire whether or not one is
    /// installed: the field is KSP's, so reading it costs a stock install
    /// nothing.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Inactive { get; set; }

    /// <summary>
    /// When the stand-down ends (<c>ProtoCrewMember.inactiveTimeEnd</c>), as
    /// universal time. Absent when <see cref="Inactive"/> is false: KSP leaves
    /// the field at whatever the last rest period set, so quoting it for a
    /// kerbal on duty would date a rest that is already over.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? InactiveUntilUt { get; set; }

    /// <summary>
    /// Whether this entry is a hireable candidate
    /// (<c>ProtoCrewMember.type == KerbalType.Applicant</c>) rather than owned
    /// crew. Carried so a client never has to recognise the <c>"Applicant"</c>
    /// spelling of <see cref="Situation"/> to know which channel it is reading.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsApplicant { get; set; }

    /// <summary>Courage, 0–1 (<c>ProtoCrewMember.courage</c>).</summary>
    [SitrepUnit(Units.Ratio)]
    public double? Courage { get; set; }

    /// <summary>Stupidity, 0–1 (<c>ProtoCrewMember.stupidity</c>).</summary>
    [SitrepUnit(Units.Ratio)]
    public double? Stupidity { get; set; }

    /// <summary>Raw experience points (<c>ProtoCrewMember.experience</c>), 0 for a fresh applicant.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Experience { get; set; }

    /// <summary>Progress toward the next rank, 0–1 (the computed <c>ProtoCrewMember.ExperienceLevelDelta</c>); <c>1</c> at max rank (5).</summary>
    [SitrepUnit(Units.Ratio)]
    public double? ExperienceLevelDelta { get; set; }

    /// <summary>The role's stock tooltip description (<c>ProtoCrewMember.experienceTrait.Description</c>): the exact string the in-game Astronaut Complex shows, sourced from <c>Traits.cfg</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? RoleDescription { get; set; }

    /// <summary>The role's current-rank effects text (<c>ProtoCrewMember.experienceTrait.DescriptionEffects</c>): rank-aware, it changes as the kerbal is promoted. Reflects this kerbal's own rank today only; there is no fetchable "effects at another rank" preview.</summary>
    [SitrepUnit(Units.Text)]
    public string? DescriptionEffects { get; set; }
}

/// <summary>
/// One craft file in the <c>spaceCenter.savedShips</c> channel, a saved VAB or
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
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SavedShipEntry
{
    /// <summary>Craft name (<c>CraftProfileInfo.shipName</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>Part count (<c>CraftProfileInfo.partCount</c>).</summary>
    [SitrepUnit(Units.Count)]
    public int? PartCount { get; set; }

    /// <summary>Total mass in tonnes (<c>CraftProfileInfo.totalMass</c>).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? TotalMass { get; set; }

    /// <summary>Which editor built it: the <c>EditorFacility</c> enum name, <c>"VAB"</c> or <c>"SPH"</c> (<c>CraftProfileInfo.shipFacility</c>). A display label; see <see cref="FacilityOrdinal"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Facility { get; set; }

    /// <summary>
    /// <see cref="Facility"/>'s KSP ORDINAL, typed to
    /// <see cref="KspEditorFacility"/>.
    ///
    /// <para>This one is not a display concern. The client sends the facility
    /// straight back as the <c>ksp.launch</c> command's <c>facility</c>
    /// argument, and it used to accept the name only if it matched a
    /// hand-written <c>{"VAB", "SPH"}</c> set and otherwise substituted
    /// <c>"VAB"</c>. A substituted default that becomes a dispatched argument
    /// is not a fallback: it launches a spaceplane from the launchpad. The set
    /// also omitted <c>None</c>, which KSP declares.</para>
    ///
    /// <para><c>null</c> when the capture carried no facility, which is a
    /// third answer and must not be read as either editor.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspEditorFacility? FacilityOrdinal { get; set; }

    /// <summary>Funds needed before this can launch, the full craft cost (<c>CraftProfileInfo.totalCost</c>).</summary>
    [SitrepUnit(Units.Funds)]
    public double? RequiresFunds { get; set; }

    /// <summary>Parts referenced by the craft that are not yet unlocked/purchased (<c>CraftProfileInfo.UnavailableShipParts</c>); an empty array when the craft is buildable as-is.</summary>
    [SitrepUnit(Units.Text)]
    public string[]? MissingParts { get; set; }
}

/// <summary>
/// The <c>spaceCenter.partsAvailable</c> channel payload: a wrapper carrying
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
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SpaceCenterPartsAvailable
{
    /// <summary>Count of buildable parts.</summary>
    [SitrepUnit(Units.Count)]
    public int? Count { get; set; }
}

/// <summary>
/// The <c>spaceCenter.astronautComplex</c> channel payload: the Astronaut
/// Complex hire tab, the rolling pool of applicants the operator can recruit,
/// plus the roster-cap context a hire is gated on. Produced by
/// <c>Sitrep.Host.SpaceCenterViewProvider.BuildAstronautComplex</c>.
///
/// <para>A wrapper object (not a bare array) because the applicant list rides
/// alongside the facility-level cap and the current active-crew count, both of
/// which the hire affordance needs: the current roster comes from the separate
/// <c>spaceCenter.crewRoster</c> channel, this one carries the hire side. The
/// whole payload is <c>null</c> in the SANDBOX / no-career / no-game case (no
/// applicant pool exists), the provider's "no data" signal, distinct from a
/// career save whose pool is genuinely empty (a non-null payload with an empty
/// <see cref="Applicants"/> list).</para>
///
/// <para>A TS-shape-only typing/codegen marker: the provider hand-builds the
/// dict and <c>JsonWriter</c> walks that live tree, this POCO never serializes.
/// Classified <c>DelayRole.TrueNow</c>: the Astronaut Complex is at KSC, known
/// independent of any vessel's comms link, same class as
/// <see cref="CrewRosterEntry"/>.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.astronautComplex")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class AstronautComplexInfo
{
    /// <summary>The hireable applicant pool (<c>KerbalRoster.Applicants</c>), sharing <see cref="CrewRosterEntry"/>'s full shape (with <see cref="CrewRosterEntry.Situation"/> always <c>"Applicant"</c>) so the Astronaut Complex's applicant and active-crew rows render off one type. Always present (empty, never null) once the payload itself is non-null.</summary>
    public List<CrewRosterEntry> Applicants { get; set; } = new();

    /// <summary>Current active (Crew-type) count (<c>KerbalRoster.GetActiveCrewCount</c>): the number counted against <see cref="CrewCapacity"/>. Null when the roster isn't queryable.</summary>
    [SitrepUnit(Units.Count)]
    public int? ActiveCrew { get; set; }

    /// <summary>Active-crew cap set by the Astronaut Complex facility tier (<c>GameVariables.GetActiveCrewLimit</c> over the facility's NORMALISED level). A hire is blocked once <see cref="ActiveCrew"/> reaches it. <c>int.MaxValue</c> at the top facility tier (unlimited); preserved as-is on the wire, never clamped, so the client can render "unlimited". Null when the facility isn't queryable.</summary>
    [SitrepUnit(Units.Count)]
    public int? CrewCapacity { get; set; }

    /// <summary>Funds cost to hire the next applicant (<c>GameVariables.GetRecruitHireCost</c>): one figure for the whole pool, the same for every applicant this tick and rising with the current roster size.</summary>
    [SitrepUnit(Units.Funds)]
    public double? NextHireCost { get; set; }
}

/// <summary>
/// One point of interest in the <c>spaceCenter.pois</c> channel: the union
/// of every launch site (<c>ksc</c>/<c>launchSite</c> kinds, the same
/// <c>PSystemSetup.Instance.LaunchSites</c> walk <see cref="LaunchSiteEntry"/>
/// already does, filtered to sites with a set spawn-point coordinate) and
/// every surface contract waypoint currently Active or Offered
/// (<c>contractTarget</c> kind, from <c>FinePrint.WaypointManager</c>).
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildPois</c>.
///
/// <para>The channel is a BARE ARRAY of these entries (tagged
/// <c>isArray: true</c>, like <see cref="LaunchSiteEntry"/>), one per POI
/// keyed by <see cref="Id"/>. The whole payload is <c>null</c> (not an empty
/// array) when no sample has landed yet: the provider's "no data yet" vs.
/// "zero POIs" distinction. A TS-shape-only typing/codegen marker (the
/// provider hand-builds the dict, this POCO never serializes). Classified
/// <c>DelayRole.TrueNow</c> (ground-side facts, same class as
/// <see cref="LaunchSiteEntry"/>).</para>
/// </summary>
[SitrepContract]
[SitrepTopic("spaceCenter.pois", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SpaceCenterPoiEntry
{
    /// <summary>
    /// <c>"launchSite:&lt;LaunchSite.name&gt;"</c> for <c>ksc</c>/<c>launchSite</c>
    /// kinds, <c>"contract:&lt;Waypoint.navigationId&gt;"</c> for
    /// <c>contractTarget</c>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary><c>"ksc"</c> | <c>"launchSite"</c> | <c>"contractTarget"</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Kind { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/>; null when absent or unresolved (never a sentinel like -1).</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Display label: the launch site's display name, or the contract's title.</summary>
    [SitrepUnit(Units.Text)]
    public string? Label { get; set; }

    /// <summary><c>"active"</c> | <c>"available"</c> (null for <c>ksc</c>/<c>launchSite</c> kinds).</summary>
    [SitrepUnit(Units.Text)]
    public string? Status { get; set; }

    /// <summary>Contract-issuing agent name; null for <c>ksc</c>/<c>launchSite</c> kinds.</summary>
    [SitrepUnit(Units.Text)]
    public string? ContractAgent { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? ContractFundsAdvance { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? ContractFundsCompletion { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double? ContractDateDeadline { get; set; }
}
