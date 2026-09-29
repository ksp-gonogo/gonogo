#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/*
 * KSP's own enums, declared here so their ordinals can cross the wire.
 *
 * KSP owns the member set and the numbering; this file only records what that
 * numbering is. So these mirrors carry explicit values, unlike the rest of the
 * contract: the value is the fact being recorded, and two of them are not dense
 * from zero (KspPartCategory has a negative member, KspActionGroup is a bitmask).
 *
 * Member names are KSP's spelling character for character (KspPartCategory.none,
 * KspResourceFlowMode's SCREAMING_SNAKE_CASE), because the name beside each
 * ordinal on the wire is KSP's own .ToString() and the client's closed union is
 * derived from these members.
 *
 * There is no Unknown member: an ordinal outside these members is an unknown
 * state at the point of use, never the pessimistic branch.
 *
 * Gonogo.KSP.Tests/KspEnumMirrorTests.cs reflects over the real enum in
 * Assembly-CSharp.dll and fails if a member, a name or a value here disagrees.
 */

/// <summary>
/// KSP's <c>ProtoCrewMember.RosterStatus</c>: a kerbal's standing in the
/// roster. Behind <c>spaceCenter.crewRoster[].situationOrdinal</c>, beside the
/// name in <see cref="CrewRosterEntry.Situation"/>.
/// </summary>
/// <category>Crew</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspRosterStatus
{
    /// <summary>In the roster and free to be assigned to a flight.</summary>
    Available = 0,
    /// <summary>Assigned to a vessel.</summary>
    Assigned = 1,
    /// <summary>Killed.</summary>
    Dead = 2,
    /// <summary>Lost with a vessel. In a save with respawn enabled, a missing kerbal returns to <see cref="Available"/> after a delay.</summary>
    Missing = 3,
}

/// <summary>
/// KSP's <c>Contracts.ParameterState</c>: whether one objective of a contract
/// is done. Behind <c>career.status.contracts[].parameters[].stateOrdinal</c>,
/// beside the name in <see cref="CareerContractParameter.State"/>.
/// </summary>
/// <category>Career</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspParameterState
{
    /// <summary>Not yet met.</summary>
    Incomplete = 0,
    /// <summary>Met.</summary>
    Complete = 1,
    /// <summary>Failed, and can no longer be met.</summary>
    Failed = 2,
}

/// <summary>
/// KSP's <c>PartCategories</c>: the editor category a part filters into. Behind
/// <c>vessel.parts[].categoryOrdinal</c>, beside the name in
/// <see cref="VesselPart.Category"/>.
///
/// <para><see cref="none"/> is <c>-1</c>, not <c>0</c>, so this enum is not
/// dense from zero and cannot be resolved with the array-walking
/// <c>namesOf</c>. The lower-case spelling is KSP's, and the name on the wire
/// is exactly <c>"none"</c>.</para>
/// </summary>
/// <category>Parts</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspPartCategory
{
    /// <summary>No category. KSP spells it in lower case.</summary>
    none = -1,
    /// <summary>Propulsion.</summary>
    Propulsion = 0,
    /// <summary>Control: reaction wheels, RCS thrusters and similar.</summary>
    Control = 1,
    /// <summary>Structural.</summary>
    Structural = 2,
    /// <summary>Aerodynamics: wings, control surfaces, nose cones, intakes.</summary>
    Aero = 3,
    /// <summary>Utility.</summary>
    Utility = 4,
    /// <summary>Science.</summary>
    Science = 5,
    /// <summary>Command pods and probe cores.</summary>
    Pods = 6,
    /// <summary>Fuel tanks.</summary>
    FuelTank = 7,
    /// <summary>Engines.</summary>
    Engine = 8,
    /// <summary>Communication: antennas and relays.</summary>
    Communication = 9,
    /// <summary>Electrical: batteries, generators, solar panels.</summary>
    Electrical = 10,
    /// <summary>Ground: landing gear, legs and wheels.</summary>
    Ground = 11,
    /// <summary>Thermal: heat shields and radiators.</summary>
    Thermal = 12,
    /// <summary>Payload: fairings and cargo bays.</summary>
    Payload = 13,
    /// <summary>Coupling: decouplers, separators and docking ports.</summary>
    Coupling = 14,
    /// <summary>Cargo: inventory parts.</summary>
    Cargo = 15,
    /// <summary>Robotics (Breaking Ground servos and rotors).</summary>
    Robotics = 16,
}

/// <summary>
/// KSP's <c>KSPActionGroup</c>: which action groups a part action fires with.
/// Behind <c>vessel.parts[].actionBindings[].groupsMask</c>, beside the names in
/// <see cref="ActionBinding.Groups"/>.
///
/// <para>A <c>[Flags]</c> bitmask, so the members are powers of two and the wire
/// carries the whole mask as one integer rather than one ordinal.
/// <see cref="None"/> is <c>0</c> and <see cref="REPLACEWITHDEFAULT"/> is
/// <c>-1</c>; neither is a group a part action is usefully bound to.
/// <internal>Both are recorded because the mirror test compares the whole member
/// set, not the useful subset of it.</internal></para>
/// </summary>
/// <category>Vessel</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspActionGroup
{
    /// <summary>KSP's placeholder for "use the action's default group". Not a real group.</summary>
    REPLACEWITHDEFAULT = -1,
    /// <summary>No group.</summary>
    None = 0,
    /// <summary>The staging group (bit 1).</summary>
    Stage = 1,
    /// <summary>The gear group (bit 2).</summary>
    Gear = 2,
    /// <summary>The lights group (bit 4).</summary>
    Light = 4,
    /// <summary>The RCS group (bit 8).</summary>
    RCS = 8,
    /// <summary>The SAS group (bit 16).</summary>
    SAS = 16,
    /// <summary>The brakes group (bit 32).</summary>
    Brakes = 32,
    /// <summary>The abort group (bit 64).</summary>
    Abort = 64,
    /// <summary>Custom action group 1 (bit 128).</summary>
    Custom01 = 128,
    /// <summary>Custom action group 2 (bit 256).</summary>
    Custom02 = 256,
    /// <summary>Custom action group 3 (bit 512).</summary>
    Custom03 = 512,
    /// <summary>Custom action group 4 (bit 1024).</summary>
    Custom04 = 1024,
    /// <summary>Custom action group 5 (bit 2048).</summary>
    Custom05 = 2048,
    /// <summary>Custom action group 6 (bit 4096).</summary>
    Custom06 = 4096,
    /// <summary>Custom action group 7 (bit 8192).</summary>
    Custom07 = 8192,
    /// <summary>Custom action group 8 (bit 16384).</summary>
    Custom08 = 16384,
    /// <summary>Custom action group 9 (bit 32768).</summary>
    Custom09 = 32768,
    /// <summary>Custom action group 10 (bit 65536).</summary>
    Custom10 = 65536,
}

/// <summary>
/// KSP's <c>EditorFacility</c>: which editor a craft was built in. Behind
/// <c>spaceCenter.savedShips[].facilityOrdinal</c>, beside the name in
/// <see cref="SavedShipEntry.Facility"/>.
/// </summary>
/// <category>Space center</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspEditorFacility
{
    /// <summary>No editor recorded.</summary>
    None = 0,
    /// <summary>The Vehicle Assembly Building.</summary>
    VAB = 1,
    /// <summary>The Spaceplane Hangar.</summary>
    SPH = 2,
}

/// <summary>
/// KSP's <c>SpaceCenterFacility</c>: one building at the space centre. Behind
/// <c>career.status.facilities[].facilityOrdinal</c> and
/// <c>LimitBreach.facilityOrdinal</c>.
///
/// <para><c>career.status.facilities</c> is keyed by the facility name, not the
/// ordinal. The ordinal is carried inside each entry, so a client can branch on
/// it without relying on the key it arrived under.</para>
/// </summary>
/// <category>Space center</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspSpaceCenterFacility
{
    /// <summary>The Administration building.</summary>
    Administration = 0,
    /// <summary>The Astronaut Complex.</summary>
    AstronautComplex = 1,
    /// <summary>The Launch Pad.</summary>
    LaunchPad = 2,
    /// <summary>Mission Control.</summary>
    MissionControl = 3,
    /// <summary>Research and Development.</summary>
    ResearchAndDevelopment = 4,
    /// <summary>The Runway.</summary>
    Runway = 5,
    /// <summary>The Tracking Station.</summary>
    TrackingStation = 6,
    /// <summary>The Spaceplane Hangar.</summary>
    SpaceplaneHangar = 7,
    /// <summary>The Vehicle Assembly Building.</summary>
    VehicleAssemblyBuilding = 8,
}

/// <summary>
/// KSP's <c>ResourceFlowMode</c>: how a resource moves around a vessel. Behind
/// <c>kerbalism.resourceDefs[].flowModeOrdinal</c>, beside the name in
/// <c>ResourceDefRaw.FlowMode</c>.
///
/// <para>The enum is stock KSP's, so any Uplink that reports a resource's flow
/// mode uses this declaration.
/// <internal>Read by the Kerbalism Uplink; declared in the core contract rather
/// than that Uplink's slice so a second Uplink reading the same stock enum gets
/// this declaration rather than a second copy.</internal></para>
/// </summary>
/// <category>Parts</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum KspResourceFlowMode
{
    /// <summary>The resource does not flow between parts; each part uses only its own.</summary>
    NO_FLOW = 0,
    /// <summary>The resource flows to any part on the vessel.</summary>
    ALL_VESSEL = 1,
    /// <summary>The resource flows vessel-wide, drawn from the highest stage priority first.</summary>
    STAGE_PRIORITY_FLOW = 2,
    /// <summary>The resource flows along the stack through crossfeed-capable connections.</summary>
    STACK_PRIORITY_SEARCH = 3,
    /// <summary>As <see cref="ALL_VESSEL"/>, drawn evenly across the containing parts.</summary>
    ALL_VESSEL_BALANCE = 4,
    /// <summary>As <see cref="STAGE_PRIORITY_FLOW"/>, drawn evenly within a priority.</summary>
    STAGE_PRIORITY_FLOW_BALANCE = 5,
    /// <summary>The resource flows within the stage through crossfeed-capable connections.</summary>
    STAGE_STACK_FLOW = 6,
    /// <summary>As <see cref="STAGE_STACK_FLOW"/>, drawn evenly across the containing parts.</summary>
    STAGE_STACK_FLOW_BALANCE = 7,
    /// <summary>No flow mode set.</summary>
    NULL = 8,
}
