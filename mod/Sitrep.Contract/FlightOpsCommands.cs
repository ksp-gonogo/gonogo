using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// <c>ksp.revertToEditor</c>'s args, which editor the flight reverts back
/// into. <see cref="Editor"/> is a small opaque string (<c>"vab"</c> or
/// <c>"sph"</c>, case-insensitive) rather than the KSP <c>EditorFacility</c>
/// enum; an unrecognised value fails with <see cref="CommandErrorCode.Range"/>
/// before the game is ever touched.
///
/// <para><c>ksp.revertToLaunch</c>, <c>ksp.toTrackingStation</c>,
/// <c>ksp.toSpaceCenter</c> and <c>ksp.recover</c> take no args (they operate on the current flight /
/// active vessel), so they have no arg type here.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("ksp.revertToEditor", Delay = DelayRole.TrueNow)]
public class RevertToEditorArgs
{
    /// <summary><c>"vab"</c> or <c>"sph"</c> (case-insensitive). Any other value yields <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.Range"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string Editor { get; set; } = "";
}

/// <summary>
/// <c>ksp.switchVessel</c>'s args: the STABLE opaque vessel id
/// (<c>vessel.id.ToString()</c>, the same id <see cref="SetTargetArgs.VesselId"/>
/// uses), resolved server-side against <c>FlightGlobals.Vessels</c>, never a
/// roster array index. An empty id fails with
/// <see cref="CommandErrorCode.NotFound"/> before the game is ever touched.
/// Works from the flight scene, where it changes the active vessel, and from
/// the Tracking Station, where it saves and then loads the vessel's flight.
/// Refused with <see cref="CommandErrorCode.WrongScene"/> in any other scene,
/// and with <see cref="CommandErrorCode.NotClearToProceed"/> for a vessel that
/// is not tracked as ours.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("ksp.switchVessel", Delay = DelayRole.TrueNow)]
public class SwitchVesselArgs
{
    /// <summary>The vessel to switch to: KSP's <c>Vessel.id</c> guid as a string, as <c>system.vessels</c> carries it.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";
}

/// <summary>
/// <c>ksp.launch</c>'s args: load a saved craft onto a launch site. The craft
/// is identified by <see cref="ShipName"/> plus the <see cref="Facility"/> it
/// was saved from (<c>"VAB"</c> or <c>"SPH"</c>, case-insensitive); the mod
/// rebuilds the <c>.craft</c> path itself, so the wire never carries a native
/// KSP type or an absolute path. An empty ship name fails with
/// <see cref="CommandErrorCode.NotFound"/> and an unrecognised facility with
/// <see cref="CommandErrorCode.Range"/>, before the game is ever touched.
///
/// <para><see cref="Crew"/> is an array of kerbal names (empty to launch
/// unmanned), each assigned to a free craft seat.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("ksp.launch", Delay = DelayRole.TrueNow)]
public class LaunchArgs
{
    /// <summary>
    /// The saved craft's name: its <c>.craft</c> file name without the
    /// extension, under the save's <c>Ships/VAB</c> or <c>Ships/SPH</c> folder.
    /// No such file fails with <see cref="CommandErrorCode.NotFound"/>.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string ShipName { get; set; } = "";

    /// <summary><c>"VAB"</c> or <c>"SPH"</c> (case-insensitive). Any other value yields <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.Range"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string Facility { get; set; } = "";

    /// <summary>
    /// The KSP launch site name to launch from, <c>"LaunchPad"</c> by default.
    /// Refused unless the sending command centre is in the same planetary
    /// system (a planet and its moons) as the site.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Site { get; set; } = "LaunchPad";

    /// <summary>Kerbal names to seat, in order. Empty to launch unmanned.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> Crew { get; set; } = new();
}
