#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args shared by every plain boolean actuation command (<c>setSas</c>/
/// <c>setRcs</c>/<c>setGear</c>/<c>setBrakes</c>/<c>setLights</c>): an
/// ABSOLUTE state to apply, never a toggle. Under light-time delay a toggle
/// arriving after unknown intervening state is a race by construction (the
/// design doc §3/§6.2's <c>toggleActionGroup</c> caution); every M1 actuation
/// command is set-semantics only, so that footgun doesn't exist here at all.
/// </summary>
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
    [SitrepUnit(Units.Flag)]
    public bool Enabled { get; set; }
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setSasMode")]
public class SetSasModeArgs
{
    [SitrepUnit(Units.Enumeration)]
    public SasMode Mode { get; set; }
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setThrottle")]
public class SetThrottleArgs
{
    /// <summary>0..1: validated (not silently clamped) at admission; out of range yields <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.Range"/> (A-10's inconsistency fixed at the send gate).</summary>
    [SitrepUnit(Units.Ratio)]
    public double Value { get; set; }
}

/// <summary>
/// <c>vessel.control.stage</c>'s result is <c>CommandResult&lt;int&gt;</c>, a
/// real value comes back (the new current stage index in <c>Payload</c>),
/// unlike the legacy <c>f.stage</c> void fire-and-forget. See
/// <see cref="CommandResult{T}"/>.
/// </summary>

/// <summary>
/// <c>vessel.control.setActionGroup</c>'s args: <see cref="Group"/> is the
/// numbered custom action group (1..10, i.e. ag1..ag10). Gear/brakes/lights
/// are their own dedicated commands (<see cref="SetEnabledArgs"/>), not
/// folded into this one: kept separate so a client never has to string-match
/// a group name to flip the landing gear.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.control.setActionGroup")]
public class SetActionGroupArgs
{
    /// <summary>1..10. Any other value yields <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.Range"/>.</summary>
    [SitrepUnit(Units.Id)]
    public int Group { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool State { get; set; }
}

/// <summary>
/// <c>vessel.maneuver.add</c>'s args: NAMED delta-v components in the
/// node's own radial/normal/prograde frame, exactly like the wire's
/// <see cref="ManeuverNode"/> shape. Kills O-4: there is no positional
/// <c>[ut,x,y,z]</c> array to mis-order (raw KSP <c>ManeuverNode.DeltaV</c> is
/// <c>x=radialOut, y=normal, z=prograde</c>) for why the actuator seam must
/// preserve this exact component assignment rather than "helpfully"
/// reordering it.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.maneuver.add", Payload = typeof(string))]
public class AddManeuverNodeArgs
{
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double Prograde { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double Normal { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double RadialOut { get; set; }
}

/// <summary>Result of <c>vessel.maneuver.add</c> is <c>CommandResult&lt;string&gt;</c>, O-6 fixed: the created node's opaque id is actually returned in <c>Payload</c>. See <see cref="CommandResult{T}"/>.</summary>

/// <summary>
/// <c>vessel.maneuver.update</c>'s args: keyed by the opaque <see cref="NodeId"/>
/// that <c>vessel.maneuver.add</c>'s <c>CommandResult&lt;string&gt;</c> returned, never a positional index
/// (O-4's second half: the legacy <c>updateManeuverNode</c> shifted every
/// later sibling's index by one).
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.maneuver.update")]
public class UpdateManeuverNodeArgs
{
    [SitrepUnit(Units.Id)]
    public string NodeId { get; set; } = "";

    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double Prograde { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double Normal { get; set; }

    [SitrepUnit(Units.MetresPerSecond)]
    public double RadialOut { get; set; }
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.maneuver.remove")]
public class RemoveManeuverNodeArgs
{
    [SitrepUnit(Units.Id)]
    public string NodeId { get; set; } = "";
}

/// <summary>
/// <c>vessel.target.set</c>'s args: a discriminated union expressed as
/// <see cref="Kind"/> + the one field that kind actually uses (C# has no
/// native union type; this mirrors <see cref="TargetKind"/>'s existing
/// vessel/body/other split rather than inventing a parallel shape). T-1
/// fixed: <see cref="VesselId"/> is the STABLE opaque vessel id (resolved
/// server-side against <c>FlightGlobals.Vessels</c>), never a live array
/// index a client would have to track itself. T-2 fixed: vessel id and body
/// index are separate fields in separate namespaces, so they can never be
/// confused for one another.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.target.set")]
public class SetTargetArgs
{
    [SitrepUnit(Units.Enumeration)]
    public TargetKind Kind { get; set; }

    /// <summary>Required when <see cref="Kind"/> is <see cref="TargetKind.Vessel"/>. ALSO required when <see cref="Kind"/> is <see cref="TargetKind.Part"/>, the guid of the vessel that OWNS the target part (a part id is unique only within its vessel).</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>Required when <see cref="Kind"/> is <see cref="TargetKind.Part"/>, the docking port's KSP <c>Part.flightID</c>, resolved server-side against the parts of the vessel named by <see cref="VesselId"/>. Null for every other kind.</summary>
    [SitrepUnit(Units.Id)]
    public uint? PartId { get; set; }

    /// <summary>
    /// Required when <see cref="Kind"/> is <see cref="TargetKind.Body"/>,
    /// the same <c>system.bodies</c> index <see cref="VesselOrbit.ReferenceBodyIndex"/>
    /// uses. ALSO required (T-POI-4) when <see cref="Kind"/> is
    /// <see cref="TargetKind.Position"/>, which body <see cref="Latitude"/>/
    /// <see cref="Longitude"/> are measured against (a lat/lon pair has no
    /// meaning without one).
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>Required when <see cref="Kind"/> is <see cref="TargetKind.Position"/> (a map-picked surface fix, e.g. a <c>spaceCenter.pois</c> entry's own coordinate).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Required when <see cref="Kind"/> is <see cref="TargetKind.Position"/>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }
}

/// <summary>
/// <c>time.setWarpIndex</c>'s args: sim-meta, never delayed (light-time
/// fiction doesn't apply to a ground-side simulation control).
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("time.setWarpIndex")]
public class SetWarpIndexArgs
{
    [SitrepUnit(Units.Id)]
    public int Index { get; set; }
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("time.setPaused")]
public class SetPausedArgs
{
    [SitrepUnit(Units.Flag)]
    public bool Paused { get; set; }
}
