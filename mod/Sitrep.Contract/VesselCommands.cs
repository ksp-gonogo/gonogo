#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args shared by every plain boolean actuation command (<c>setSas</c>/
/// <c>setRcs</c>/<c>setGear</c>/<c>setBrakes</c>/<c>setLights</c>) — an
/// ABSOLUTE state to apply, never a toggle. Under light-time delay a toggle
/// arriving after unknown intervening state is a race by construction (the
/// design doc §3/§6.2's <c>toggleActionGroup</c> caution); every M1 actuation
/// command is set-semantics only, so that footgun doesn't exist here at all.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetEnabledArgs
{
    public bool Enabled { get; set; }
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetSasModeArgs
{
    public SasMode Mode { get; set; }
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetThrottleArgs
{
    /// <summary>0..1 — validated (not silently clamped) at admission; out of range yields <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.Range"/> (A-10's inconsistency fixed at the send gate).</summary>
    public double Value { get; set; }
}

/// <summary>
/// <c>vessel.control.stage</c>'s result is <c>CommandResult&lt;int&gt;</c> — a
/// real value comes back (the new current stage index in <c>Payload</c>),
/// unlike Telemachus's <c>f.stage</c> void fire-and-forget. See
/// <see cref="CommandResult{T}"/>.
/// </summary>

/// <summary>
/// <c>vessel.control.setActionGroup</c>'s args — <see cref="Group"/> is the
/// numbered custom action group (1..10, i.e. ag1..ag10). Gear/brakes/lights
/// are their own dedicated commands (<see cref="SetEnabledArgs"/>), not
/// folded into this one — kept separate so a client never has to string-match
/// a group name to flip the landing gear.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetActionGroupArgs
{
    /// <summary>1..10. Any other value yields <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.Range"/>.</summary>
    public int Group { get; set; }

    public bool State { get; set; }
}

/// <summary>
/// <c>vessel.maneuver.add</c>'s args — NAMED delta-v components in the
/// node's own radial/normal/prograde frame, exactly like the wire's
/// <see cref="ManeuverNode"/> shape. Kills O-4: there is no positional
/// <c>[ut,x,y,z]</c> array to mis-order — see the project's own "Telemachus
/// maneuver-node arg order" finding (raw KSP <c>ManeuverNode.DeltaV</c> is
/// <c>x=radialOut, y=normal, z=prograde</c>) for why the actuator seam must
/// preserve this exact component assignment rather than "helpfully"
/// reordering it.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class AddManeuverNodeArgs
{
    public double Ut { get; set; }

    public double Prograde { get; set; }

    public double Normal { get; set; }

    public double RadialOut { get; set; }
}

/// <summary>Result of <c>vessel.maneuver.add</c> is <c>CommandResult&lt;string&gt;</c> — O-6 fixed: the created node's opaque id is actually returned in <c>Payload</c>. See <see cref="CommandResult{T}"/>.</summary>

/// <summary>
/// <c>vessel.maneuver.update</c>'s args — keyed by the opaque <see cref="NodeId"/>
/// that <c>vessel.maneuver.add</c>'s <c>CommandResult&lt;string&gt;</c> returned, never a positional index
/// (O-4's second half: Telemachus's <c>updateManeuverNode</c> shifted every
/// later sibling's index by one).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class UpdateManeuverNodeArgs
{
    public string NodeId { get; set; } = "";

    public double Ut { get; set; }

    public double Prograde { get; set; }

    public double Normal { get; set; }

    public double RadialOut { get; set; }
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RemoveManeuverNodeArgs
{
    public string NodeId { get; set; } = "";
}

/// <summary>
/// <c>vessel.target.set</c>'s args — a discriminated union expressed as
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
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetTargetArgs
{
    public TargetKind Kind { get; set; }

    /// <summary>Required when <see cref="Kind"/> is <see cref="TargetKind.Vessel"/>.</summary>
    public string? VesselId { get; set; }

    /// <summary>Required when <see cref="Kind"/> is <see cref="TargetKind.Body"/> — the same <c>system.bodies</c> index <see cref="VesselOrbit.ReferenceBodyIndex"/> uses.</summary>
    public int? BodyIndex { get; set; }
}

/// <summary>
/// <c>time.setWarpIndex</c>'s args — sim-meta, never delayed (light-time
/// fiction doesn't apply to a ground-side simulation control).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetWarpIndexArgs
{
    public int Index { get; set; }
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SetPausedArgs
{
    public bool Paused { get; set; }
}
