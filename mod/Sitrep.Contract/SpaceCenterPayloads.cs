#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One launch site in the <c>spaceCenter.launchSites</c> channel: the stock
/// KSC pad and runway, any Making History sites, and any Kerbal Konstructs
/// sites, which is everything registered in KSP's
/// <c>PSystemSetup.Instance.LaunchSites</c>.
///
/// <para>The channel is a BARE ARRAY of these entries, NOT a wrapper object
/// and NOT a KSC singleton: KSP has many launch sites, keyed by
/// <see cref="Name"/>. The whole payload is <c>null</c> (not an empty array)
/// when no sample has arrived yet, which tells "no data yet" apart from "zero
/// sites". No per-payload <c>meta</c>, the same convention as
/// <see cref="SystemBodies"/>.</para>
///
/// <para>Held at the home command: each vantage receives a change after its
/// own delay to home, at once on the ground network.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildLaunchSites</c>.
/// Typing-only mirror of the per-site dict the provider emits;
/// <c>JsonWriter</c> walks that live tree. Kerbal Konstructs registers its
/// sites through the public <c>AddLaunchSite</c> API, so enumerating that one
/// list covers all three sources with no reflection and no hard KK link.
/// </internal>
/// </summary>
/// <category>Space center</category>
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

    /// <summary>Human-facing display name, as the game's own screens show it in the player's language, or the site's <c>name</c> when the game has none it can resolve.</summary>
    [SitrepUnit(Units.Text)]
    public string? DisplayName { get; set; }

    /// <summary>Which editor this site launches from (the pad-vs-runway distinction) as the <c>EditorFacility</c> enum name (<c>"None"</c>/<c>"VAB"</c>/<c>"SPH"</c>); a VAB site is a pad, an SPH site a runway.</summary>
    [SitrepUnit(Units.Text)]
    public string? EditorFacility { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/> of the body this site sits on; null when absent or unresolved (never a sentinel like -1).</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>Latitude of the site's spawn point on its body (<c>LaunchSite.SpawnPoint</c>); null when the site has no set spawn coordinate (never a fabricated <c>0</c>). Pairs with <see cref="Longitude"/> to give the site a location for the command-delay geometry (a launch is a command to this location).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Longitude of the site's spawn point on its body; null when the site has no set spawn coordinate. Pairs with <see cref="Latitude"/>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Whether this is a stock KSP launch site (<c>PSystemSetup.IsStockLaunchSite</c>), false for Making History / Kerbal Konstructs sites.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsStock { get; set; }

    /// <summary>Whether a vessel holds this site, by the rule the game's own launch admission applies: a saved vessel, active or not, whose landed-at site matches this one, debris excepted. Holds in any scene. True exactly when a launch from here would be refused as occupied; null when the save's vessel list is not loaded.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? PadOccupied { get; set; }

    /// <summary>Name of the vessel holding this site (<see cref="PadOccupied"/> true), the one the game names in its own refusal; null when the site is clear or occupancy is unknown.</summary>
    [SitrepUnit(Units.Text)]
    public string? PadVesselTitle { get; set; }
}

/// <summary>
/// The <c>spaceCenter.scene</c> channel payload: the single current KSP game
/// scene. <see cref="Scene"/> carries exactly one of the six strings
/// <c>{"Flight","SpaceCenter","Editor","TrackingStation","MainMenu","Other"}</c>:
/// KSP's <c>GameScenes</c> enum folded onto that fixed set, with any scene
/// outside the five named ones (<c>LOADING</c>, <c>PSYSTEM</c>,
/// <c>MISSIONBUILDER</c>, ...) mapped to <c>"Other"</c>.
///
/// <para>A wrapper object <c>{ "scene": string }</c>. The whole payload is
/// <c>null</c> when no sample has arrived yet. No per-payload <c>meta</c> (it
/// rides the envelope). Never delayed (<see cref="DelayRole.TrueNow"/>): a
/// ground-side game-state fact, the same class as
/// <see cref="SystemBodies"/>.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildScene</c>;
/// typing-only mirror, not serialized itself.
/// </internal>
/// </summary>
/// <category>Space center</category>
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

    /// <summary>The launch site currently selected in the editor (<c>EditorLogic.launchSiteName</c>). Null outside the editor scene, never a fabricated default.</summary>
    [SitrepUnit(Units.Text)]
    public string? LaunchSite { get; set; }
}

/// <summary>
/// One kerbal in the <c>spaceCenter.crewRoster</c> channel (the hired-crew
/// roster: KSP's <c>KerbalRoster.Crew</c>, owned crew that is either available
/// or currently assigned to a mission), and the same shape for every entry in
/// <see cref="AstronautComplexInfo.Applicants"/>: ONE shape for a kerbal
/// whether hired or still a candidate.
///
/// <para>The <c>spaceCenter.crewRoster</c> channel is a BARE ARRAY of these
/// entries, one per crew member keyed by <see cref="Name"/>. The whole payload
/// is <c>null</c> (not an empty array) when no sample has arrived yet, which
/// tells "no data yet" apart from "zero crew".</para>
///
/// <para>Held at the home command, like <see cref="LaunchSiteEntry"/>.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildCrewRoster</c> /
/// <c>BuildAstronautComplex</c>. Typing-only mirror: the provider hand-builds
/// the dict and <c>JsonWriter</c> walks that live tree. LaunchDirector reads
/// the name, trait, level and availability pair; the Astronaut Complex also
/// groups by <c>Standing</c> and reads the stat set and role tooltip text.
/// </internal>
/// </summary>
/// <category>Crew</category>
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

    /// <summary>Experience level (<c>ProtoCrewMember.experienceLevel</c>), 0 to 5 (0 for a fresh applicant).</summary>
    [SitrepUnit(Units.Count)]
    public int? ExperienceLevel { get; set; }

    /// <summary>
    /// Whether the kerbal can be assigned to a flight today.
    ///
    /// <para><b>The field to branch on when all a client needs is yes or
    /// no.</b> It is derived from EVERY axis the derivation knows about, by
    /// <see cref="CrewStandings.CanFly"/>, which is a whitelist: only
    /// <c>Available</c> and <c>Applicant</c> are free, so a standing added to
    /// <see cref="CrewStanding"/> later reads as unavailable here without anybody
    /// editing a consumer.</para>
    ///
    /// <para>A backend may override it outright.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Available { get; set; }

    /// <summary>
    /// Why the kerbal can't fly, in prose: <c>Assigned</c> reads "On mission",
    /// <c>Resting</c> reads "Standing down", and every other blocking standing
    /// reads its own name. Empty string when <see cref="Available"/> is true. A
    /// backend may override the wording.
    ///
    /// <para><b>No date, ever.</b> The when rides <see cref="StandingEndsAtUt"/>
    /// as a <c>ut</c> value, because a date formatted here would be formatted in
    /// the mod's idea of a calendar, and the client owns the calendar. This is
    /// the only string on the payload a client could not re-render.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? UnavailableReason { get; set; }

    /// <summary>
    /// The kerbal's standing, as the dashboard means it: the field to BRANCH on.
    /// The elected <see cref="ICrewStandingBackend"/>'s reading where it has one,
    /// otherwise derived by the stock backend from every axis KSP exposes.
    ///
    /// <para>The roster status alone is not enough: an applicant has none, and
    /// a kerbal standing down still reads <c>Available</c> there. See
    /// <see cref="CrewStanding"/>.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public CrewStanding? Standing { get; set; }

    /// <summary>
    /// When the kerbal's unavailability lapses, as universal time: the rest
    /// period's end for <c>Resting</c>, or whatever end the elected backend
    /// quotes. Absent when there is no scheduled end, which is most of the
    /// time.
    ///
    /// <para>Read with <see cref="UnavailableReason"/> to say why a kerbal cannot
    /// fly AND until when. The two are separate fields so the client formats the
    /// date in its own calendar.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? StandingEndsAtUt { get; set; }

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
    /// branch on: it reads <c>Available</c> for a kerbal standing down.
    /// <see cref="Standing"/> is the field to branch on.</para>
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
    /// derived standing the way <see cref="SituationOrdinal"/> is.
    ///
    /// <para><b>Not the field to branch on.</b> It is an INPUT to the derivation:
    /// a kerbal standing down has roster status <c>Available</c>, and this flag is
    /// what turns that into <see cref="CrewStanding.Resting"/> with
    /// <see cref="Available"/> false.</para>
    ///
    /// <para>The field is KSP's, so it goes on the wire on every install and
    /// reading it costs nothing.</para>
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

    /// <summary>Courage, 0 to 1 (<c>ProtoCrewMember.courage</c>).</summary>
    [SitrepUnit(Units.Ratio)]
    public double? Courage { get; set; }

    /// <summary>Stupidity, 0 to 1 (<c>ProtoCrewMember.stupidity</c>).</summary>
    [SitrepUnit(Units.Ratio)]
    public double? Stupidity { get; set; }

    /// <summary>Raw experience points (<c>ProtoCrewMember.experience</c>), 0 for a fresh applicant.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? Experience { get; set; }

    /// <summary>Progress toward the next rank, 0 to 1 (the computed <c>ProtoCrewMember.ExperienceLevelDelta</c>); <c>1</c> at max rank (5).</summary>
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
/// stock <c>CraftProfileInfo</c> metadata loader.
///
/// <para>The channel is a BARE ARRAY of these entries, one per <c>.craft</c>
/// file keyed by <see cref="File"/>. The whole payload is <c>null</c> (not an
/// empty array) when no sample has arrived yet. Held at the home
/// command.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildSavedShips</c>;
/// typing-only mirror, the provider hand-builds the dict.
/// </internal>
/// </summary>
/// <category>Space center</category>
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

    /// <summary>
    /// The <c>.craft</c> file name without its extension, under the save's
    /// <c>Ships/VAB</c> or <c>Ships/SPH</c> folder. Unique within a facility,
    /// which <see cref="Name"/> is not: two files can carry the same ship name.
    /// It is what <c>ksp.launch</c>'s <c>shipName</c> resolves, so send this
    /// back rather than <see cref="Name"/>.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? File { get; set; }

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
    /// <para>This one is not a display concern. A client sends the facility
    /// straight back as the <c>ksp.launch</c> command's <c>facility</c>
    /// argument, so never substitute a default editor for a value it does not
    /// recognise: a substituted default that becomes a dispatched argument
    /// launches a spaceplane from the launchpad. KSP's enum also declares
    /// <c>None</c>.</para>
    ///
    /// <para><c>null</c> when the capture carried no facility, which is a
    /// third value and must not be read as either editor.</para>
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
///
/// <para>A wrapper object, because a bare scalar has no Topic shape: read
/// <c>spaceCenter.partsAvailable.count</c>. The whole payload is <c>null</c>
/// when no sample has arrived yet. Held at the home command.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildPartsAvailable</c>;
/// typing-only mirror. The SpaceCenterStatus widget is the reader.
/// </internal>
/// </summary>
/// <category>Space center</category>
[SitrepContract]
[SitrepTopic("spaceCenter.partsAvailable")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SpaceCenterPartsAvailable
{
    /// <summary>How many parts the player can place right now. <c>null</c> when it could not be counted.</summary>
    [SitrepUnit(Units.Count)]
    public int? Count { get; set; }
}

/// <summary>
/// The <c>spaceCenter.astronautComplex</c> channel payload: the Astronaut
/// Complex hire tab, the rolling pool of applicants the operator can recruit,
/// plus the roster-cap context a hire is gated on.
///
/// <para>A wrapper object (not a bare array) because the applicant list rides
/// alongside the facility-level cap and the current active-crew count, both of
/// which the hire affordance needs: the current roster comes from the separate
/// <c>spaceCenter.crewRoster</c> channel, this one carries the hire side. The
/// whole payload is <c>null</c> in the SANDBOX / no-career / no-game case (no
/// applicant pool exists), distinct from a career save whose pool is genuinely
/// empty (a non-null payload with an empty <see cref="Applicants"/>
/// list).</para>
///
/// <para>Held at the home command, like <see cref="CrewRosterEntry"/>.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildAstronautComplex</c>.
/// Typing-only mirror: the provider hand-builds the dict and <c>JsonWriter</c>
/// walks that live tree.
/// </internal>
/// </summary>
/// <category>Crew</category>
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
/// of every launch site (<c>ksc</c>/<c>launchSite</c> kinds, the same sites as
/// <see cref="LaunchSiteEntry"/>, limited to sites with a set spawn-point
/// coordinate) and every surface contract waypoint whose contract is Active or
/// Offered (<c>contractTarget</c> kind, from <c>FinePrint.WaypointManager</c>).
///
/// <para>The channel is a BARE ARRAY of these entries, one per POI keyed by
/// <see cref="Id"/>. The whole payload is <c>null</c> (not an empty array)
/// when no sample has arrived yet, which tells "no data yet" apart from "zero
/// POIs". Held at the home command, like <see cref="LaunchSiteEntry"/>.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SpaceCenterViewProvider.BuildPois</c>;
/// typing-only mirror, the provider hand-builds the dict.
/// </internal>
/// </summary>
/// <category>Space center</category>
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

    /// <summary>
    /// Latitude on the body: the spawn point for a launch site (always present,
    /// since sites without one are left out), the waypoint's latitude for a
    /// contract target. <c>null</c> when a waypoint's value is unreadable.
    /// </summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>
    /// Longitude on the body, from the same source as <see cref="Latitude"/>
    /// and with the same null rule.
    /// </summary>
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

    /// <summary>Funds the contract pays on acceptance (<c>Contract.FundsAdvance</c>); null for <c>ksc</c>/<c>launchSite</c> kinds.</summary>
    [SitrepUnit(Units.Funds)]
    public double? ContractFundsAdvance { get; set; }

    /// <summary>Funds the contract pays on completion (<c>Contract.FundsCompletion</c>); null for <c>ksc</c>/<c>launchSite</c> kinds.</summary>
    [SitrepUnit(Units.Funds)]
    public double? ContractFundsCompletion { get; set; }

    /// <summary>
    /// When the contract must be completed by (<c>Contract.DateDeadline</c>).
    /// <c>null</c> when the contract has no deadline (KSP stores that as
    /// <c>0</c>, which is never passed through), and for
    /// <c>ksc</c>/<c>launchSite</c> kinds.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ContractDateDeadline { get; set; }
}
