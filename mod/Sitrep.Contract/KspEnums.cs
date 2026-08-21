#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/*
 * KSP's OWN enums, declared here so their ordinals can cross the wire.
 *
 * Every other enum in this contract is ours: we choose the members, we choose
 * the order, and the ordinal on the wire means whatever this file says it
 * means. These are the opposite. KSP owns the member set and the numbering, and
 * this file's only job is to state, in one place a compiler and a test can both
 * see, what that numbering IS.
 *
 * Why they are here at all. A KSP enum used to reach the client as its bare
 * .ToString() name and nothing else, so a consumer had no choice but to branch
 * on the spelling. That is the defect class the 2026-08-21 sweep fixed eight
 * instances of: it fails silently, in the "everything is fine" direction, at
 * the moment somebody adds a member, which is the moment nobody re-reads the
 * consumers. For our own enums it is now a compile error, because the client's
 * union is DERIVED from the C# declaration (see vessel-state.ts's SituationName
 * and friends). KSP's enums had no declaration to derive from. Now they do.
 *
 * These mirrors carry EXPLICIT VALUES, and that is deliberate. The rest of the
 * contract forbids them, because an ordinal is declaration order and writing a
 * value down only invites it to disagree with the position. Here the numbering
 * is not ours to choose, so the value IS the fact being recorded, and leaving
 * it implicit would be recording a guess. Two of these are not dense from zero
 * at all - KspPartCategory has a negative member, KspActionGroup is a bitmask -
 * so an implicitly-numbered mirror would be wrong rather than merely
 * undocumented.
 *
 * Member names are KSP's spelling, character for character, including
 * KspPartCategory.none's lower case and KspResourceFlowMode's
 * SCREAMING_SNAKE_CASE. They have to be: the name field beside each ordinal on
 * the wire carries KSP's own .ToString(), and the client's closed union is
 * derived from these members, so a tidied-up spelling here would make the union
 * reject the exact string the mod sends.
 *
 * No Unknown member. Our enums carry one because we can promise it exists. KSP's
 * value set is KSP's, and inventing a member it does not have would put a number
 * on the wire that means nothing on either side. An ordinal outside these
 * members is an UNKNOWN state at the point of use: a third arm, never the
 * pessimistic one.
 *
 * What keeps these honest is Gonogo.KSP.Tests/KspEnumMirrorTests.cs, which
 * reflects over the REAL enum out of Assembly-CSharp.dll and fails if a member,
 * a name or a value here disagrees with it. That test is the point of this file.
 * Without it this is another transcription, and a transcription drifts the
 * moment somebody appends a member.
 */

/// <summary>
/// KSP's <c>ProtoCrewMember.RosterStatus</c>: a kerbal's standing in the
/// roster. Behind <c>spaceCenter.crewRoster[].situationOrdinal</c>, beside the
/// name in <see cref="CrewRosterEntry.Situation"/>.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspRosterStatus
{
    Available = 0,
    Assigned = 1,
    Dead = 2,
    Missing = 3,
}

/// <summary>
/// KSP's <c>Contracts.ParameterState</c>: whether one objective of a contract
/// is done. Behind <c>career.status.contracts[].parameters[].stateOrdinal</c>,
/// beside the name in <see cref="CareerContractParameter.State"/>.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspParameterState
{
    Incomplete = 0,
    Complete = 1,
    Failed = 2,
}

/// <summary>
/// KSP's <c>PartCategories</c>: the editor category a part filters into. Behind
/// <c>vessel.parts[].categoryOrdinal</c>, beside the name in
/// <see cref="VesselPart.Category"/>.
///
/// <para><see cref="none"/> is <c>-1</c>, not <c>0</c>, so this enum is NOT
/// dense from zero and the client cannot resolve it with the array-walking
/// <c>namesOf</c>. The lower-case spelling is KSP's; <c>.ToString()</c> on that
/// member yields <c>"none"</c> and the wire carries exactly that.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspPartCategory
{
    none = -1,
    Propulsion = 0,
    Control = 1,
    Structural = 2,
    Aero = 3,
    Utility = 4,
    Science = 5,
    Pods = 6,
    FuelTank = 7,
    Engine = 8,
    Communication = 9,
    Electrical = 10,
    Ground = 11,
    Thermal = 12,
    Payload = 13,
    Coupling = 14,
    Cargo = 15,
    Robotics = 16,
}

/// <summary>
/// KSP's <c>KSPActionGroup</c>: which action groups a part action fires with.
/// Behind <c>vessel.parts[].actionBindings[].groupsMask</c>, beside the names in
/// <see cref="ActionBinding.Groups"/>.
///
/// <para>A <c>[Flags]</c> BITMASK, so the members are powers of two and the wire
/// carries the whole mask as one integer rather than one ordinal.
/// <see cref="None"/> is <c>0</c> and <see cref="REPLACEWITHDEFAULT"/> is
/// <c>-1</c>. Neither is a group a part action is usefully bound to, and both
/// are recorded here because the mirror test compares the whole member set, not
/// the useful subset of it.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspActionGroup
{
    REPLACEWITHDEFAULT = -1,
    None = 0,
    Stage = 1,
    Gear = 2,
    Light = 4,
    RCS = 8,
    SAS = 16,
    Brakes = 32,
    Abort = 64,
    Custom01 = 128,
    Custom02 = 256,
    Custom03 = 512,
    Custom04 = 1024,
    Custom05 = 2048,
    Custom06 = 4096,
    Custom07 = 8192,
    Custom08 = 16384,
    Custom09 = 32768,
    Custom10 = 65536,
}

/// <summary>
/// KSP's <c>EditorFacility</c>: which editor a craft was built in. Behind
/// <c>spaceCenter.savedShips[].facilityOrdinal</c>, beside the name in
/// <see cref="SavedShipEntry.Facility"/>.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspEditorFacility
{
    None = 0,
    VAB = 1,
    SPH = 2,
}

/// <summary>
/// KSP's <c>SpaceCenterFacility</c>: one building at the space centre. Behind
/// <c>career.status.facilities[].facilityOrdinal</c> and
/// <c>LimitBreach.facilityOrdinal</c>.
///
/// <para><c>career.status.facilities</c> is keyed by the NAME rather than the
/// ordinal, and stays that way: rekeying the map would be a breaking retype and
/// would change the shape of every consumer's key walk. The ordinal rides
/// inside each entry instead, so a client can branch on it without trusting the
/// key it arrived under.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspSpaceCenterFacility
{
    Administration = 0,
    AstronautComplex = 1,
    LaunchPad = 2,
    MissionControl = 3,
    ResearchAndDevelopment = 4,
    Runway = 5,
    TrackingStation = 6,
    SpaceplaneHangar = 7,
    VehicleAssemblyBuilding = 8,
}

/// <summary>
/// KSP's <c>ResourceFlowMode</c>: how a resource moves around a vessel. Behind
/// <c>kerbalism.resourceDefs[].flowModeOrdinal</c>, beside the name in
/// <c>ResourceDefRaw.FlowMode</c>.
///
/// <para>Read by the Kerbalism Uplink, which is why it is declared in the core
/// contract rather than in that Uplink's own slice: the enum is stock KSP's, not
/// Kerbalism's, and a second Uplink reading the same stock enum should get this
/// declaration rather than a second copy of it.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspResourceFlowMode
{
    NO_FLOW = 0,
    ALL_VESSEL = 1,
    STAGE_PRIORITY_FLOW = 2,
    STACK_PRIORITY_SEARCH = 3,
    ALL_VESSEL_BALANCE = 4,
    STAGE_PRIORITY_FLOW_BALANCE = 5,
    STAGE_STACK_FLOW = 6,
    STAGE_STACK_FLOW_BALANCE = 7,
    NULL = 8,
}
