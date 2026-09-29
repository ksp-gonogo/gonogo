#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args shared by every plain on/off actuation command (<c>setSas</c>,
/// <c>setRcs</c>, <c>setGear</c>, <c>setBrakes</c>, <c>setLights</c>,
/// <c>setAbort</c>): an absolute state to apply, never a toggle. Under
/// light-time delay a toggle that arrives after unknown intervening changes
/// would race them, so there are no toggle commands.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setSas")]
[SitrepCommand("vessel.control.setRcs")]
[SitrepCommand("vessel.control.setGear")]
[SitrepCommand("vessel.control.setBrakes")]
[SitrepCommand("vessel.control.setLights")]
[SitrepCommand("vessel.control.setAbort")]
public class SetEnabledArgs
{
    /// <summary><c>true</c> to switch the system on (or fire abort), <c>false</c> to switch it off.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Enabled { get; set; }
}

/// <summary>
/// <c>vessel.control.setSasMode</c>'s arguments: the SAS mode to hold.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setSasMode")]
public class SetSasModeArgs
{
    /// <summary>The SAS mode to hold.</summary>
    [SitrepUnit(Units.Enumeration)]
    public SasMode Mode { get; set; }
}

/// <summary>
/// <c>vessel.control.setThrottle</c>'s arguments: the main throttle setting.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setThrottle")]
public class SetThrottleArgs
{
    /// <summary>The throttle from 0 to 1. A value outside that range is refused with <see cref="CommandErrorCode.Range"/> rather than clamped.</summary>
    [SitrepUnit(Units.Ratio)]
    public double Value { get; set; }
}

// vessel.control.stage takes no args; its CommandResult<int> carries the new current stage index in Payload.

/// <summary>
/// <c>vessel.control.setActionGroup</c>'s args: set a numbered custom action
/// group on or off. Gear, brakes, lights and abort are their own commands
/// (<see cref="SetEnabledArgs"/>), so a client never string-matches a group
/// name to lower the landing gear.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setActionGroup")]
public class SetActionGroupArgs
{
    /// <summary>
    /// The custom action group number, from 1. The upper bound belongs to the
    /// installed action-groups provider: 10 in stock KSP (ag1 to ag10), and
    /// more where a mod adds them. A group below 1 or beyond that bound
    /// fails with <see cref="CommandErrorCode.Range"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int Group { get; set; }

    /// <summary><c>true</c> to switch the group on, <c>false</c> to switch it off.</summary>
    [SitrepUnit(Units.Flag)]
    public bool State { get; set; }
}

/// <summary>
/// <c>vessel.maneuver.add</c>'s args: a new manoeuvre node's time and its
/// delta-v as named components in the node's own prograde, normal and
/// radial-out frame, the same shape as <see cref="ManeuverNode"/>. Raw KSP
/// <c>ManeuverNode.DeltaV</c> orders them <c>x = radialOut, y = normal,
/// z = prograde</c>; the names here remove that ordering from the wire.
///
/// <para>The result is a <c>CommandResult&lt;string&gt;</c> whose
/// <c>Payload</c> is the new node's opaque id, the same id
/// <see cref="ManeuverNode.Id"/> carries on <c>vessel.maneuver</c>. A client
/// will not send the command if it would arrive at the craft at or after
/// <see cref="Ut"/>.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.maneuver.add", Payload = typeof(string), ArriveBefore = nameof(AddManeuverNodeArgs.Ut))]
public class AddManeuverNodeArgs
{
    /// <summary>The node's time, in UT seconds.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>The delta-v component along the orbit's prograde direction at the node, in m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double Prograde { get; set; }

    /// <summary>The delta-v component along the orbit normal at the node, in m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double Normal { get; set; }

    /// <summary>The delta-v component along the radial-out direction at the node, in m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double RadialOut { get; set; }
}

/// <summary>
/// <c>vessel.maneuver.update</c>'s args: replace an existing node's time and
/// delta-v. The node is named by its opaque <see cref="NodeId"/>, never a
/// positional index, so adding or removing another node never changes which
/// node an update reaches. A client will not send the command if it would
/// arrive at the craft at or after <see cref="Ut"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.maneuver.update", ArriveBefore = nameof(UpdateManeuverNodeArgs.Ut))]
public class UpdateManeuverNodeArgs
{
    /// <summary>
    /// The node to update: the id <c>vessel.maneuver.add</c> returned, or a
    /// <see cref="ManeuverNode.Id"/> from <c>vessel.maneuver</c>. An unknown id
    /// fails with <see cref="CommandErrorCode.NotFound"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string NodeId { get; set; } = "";

    /// <summary>The node's new time, in UT seconds.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>The delta-v component along the orbit's prograde direction at the node, in m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double Prograde { get; set; }

    /// <summary>The delta-v component along the orbit normal at the node, in m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double Normal { get; set; }

    /// <summary>The delta-v component along the radial-out direction at the node, in m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double RadialOut { get; set; }
}

/// <summary>
/// <c>vessel.maneuver.remove</c>'s arguments: the manoeuvre node to delete.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.maneuver.remove")]
public class RemoveManeuverNodeArgs
{
    /// <summary>The node to delete: a <see cref="ManeuverNode.Id"/> from <c>vessel.maneuver</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string NodeId { get; set; } = "";
}

/// <summary>
/// <c>vessel.target.set</c>'s args: a discriminated union, written as
/// <see cref="Kind"/> plus the fields that kind uses. <see cref="VesselId"/>
/// is the stable vessel id, never an array index, and a vessel id and a body
/// index travel in separate fields so they cannot be confused.
///
/// <para>A request missing a field its kind needs, or with
/// <see cref="TargetKind.Other"/>, fails with
/// <see cref="CommandErrorCode.NotFound"/>, as does a well-formed request
/// that matches no live vessel, part, body or position.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.target.set")]
public class SetTargetArgs
{
    /// <summary>What kind of thing to target; decides which of the other fields are required.</summary>
    [SitrepUnit(Units.Enumeration)]
    public TargetKind Kind { get; set; }

    /// <summary>The target vessel's guid. Required when <see cref="Kind"/> is <see cref="TargetKind.Vessel"/>, and also when it is <see cref="TargetKind.Part"/>, where it names the vessel that owns the target part (a part id is unique only within its vessel).</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>The docking port's KSP <c>Part.flightID</c>, looked up among the parts of the vessel named by <see cref="VesselId"/>. Required when <see cref="Kind"/> is <see cref="TargetKind.Part"/>; <c>null</c> for every other kind.</summary>
    [SitrepUnit(Units.Id)]
    public uint? PartId { get; set; }

    /// <summary>
    /// The body's <c>system.bodies</c> index, the same index
    /// <see cref="VesselOrbit.ReferenceBodyIndex"/> uses. Required when
    /// <see cref="Kind"/> is <see cref="TargetKind.Body"/>, and also when it is
    /// <see cref="TargetKind.Position"/>, where it names the body
    /// <see cref="Latitude"/> and <see cref="Longitude"/> are measured on.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>The target position's latitude, in degrees. Required when <see cref="Kind"/> is <see cref="TargetKind.Position"/> (a surface point picked on a map, e.g. a <c>spaceCenter.pois</c> entry's coordinate).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>The target position's longitude, in degrees. Required when <see cref="Kind"/> is <see cref="TargetKind.Position"/>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }
}

/// <summary>
/// <c>time.setWarpIndex</c>'s args: select a time-warp rate. This is a
/// control of the simulation, not of a craft, so it is never delayed by
/// light time.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("time.setWarpIndex", Delay = DelayRole.TrueNow)]
public class SetWarpIndexArgs
{
    /// <summary>
    /// The index into this install's high (on-rails) warp rate table, the
    /// <c>time.warp</c> <c>WarpRates</c> array, where 0 is normal time. An index
    /// below 0 or beyond the table fails with <see cref="CommandErrorCode.Range"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int Index { get; set; }
}

/// <summary>
/// <c>time.setPaused</c>'s arguments: whether the game is paused.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("time.setPaused", Delay = DelayRole.TrueNow)]
public class SetPausedArgs
{
    /// <summary>True to pause the game, false to resume it.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Paused { get; set; }
}
