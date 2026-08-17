#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Coarse classification of what <c>vessel.target</c> points at. KspHost's
/// raw <c>type</c> string is either a <see cref="VesselType"/>-shaped string
/// (target is a vessel, <c>target.GetVessel() != null</c>), the literal
/// <c>"CelestialBody"</c>, or an arbitrary CLR type name for anything else
/// (a docking port, a waypoint, ...). Rather than reproduce that CLR-name
/// passthrough on the wire (its own naming wart), this contract collapses it
/// to the three cases a consumer actually needs to branch on;
/// <see cref="Other"/> covers docking ports/waypoints/anything not yet
/// classified more finely (a future, more specific target-kind split is a
/// non-breaking additive change, same convention as every other
/// <see cref="Unknown"/>-style fallback in this contract).
///
/// <para><see cref="Position"/> (additive, appended never inserted: enum
/// member order is wire-significant per this contract's numeric-serialisation
/// convention) is a client-chosen surface fix used ONLY as an input to
/// <c>vessel.target.set</c> (see <see cref="SetTargetArgs.Latitude"/>/
/// <see cref="SetTargetArgs.Longitude"/>), a map-picked lat/lon that isn't
/// backed by any live KSP target object, so it never appears as
/// <c>vessel.target</c>'s own reported <see cref="Kind"/>.</para>
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum TargetKind
{
    Vessel,
    Body,
    Other,
    Position,

    /// <summary>
    /// A part of a vessel: in practice a docking port (<c>ModuleDockingNode</c>,
    /// which implements <c>ITargetable</c>). Identity is the owning vessel's
    /// <see cref="VesselTarget.VesselId"/> guid PLUS the part's
    /// <see cref="VesselTarget.PartId"/> (KSP <c>Part.flightID</c>): a part id
    /// alone is not globally unique, only within its vessel. Appended (never
    /// inserted) per this contract's wire-significant enum-order convention.
    /// </summary>
    Part,
}

/// <summary>
/// Next closest approach between the active vessel and its current target,
/// computed MOD-side by the elected <c>ITargetApproachSolver</c> (stock
/// two-body Kepler by default, an n-body backend when elected over
/// it). Replaces the SDK's former client-side <c>o.closestTgtApprUT</c>
/// two-body solve: the authority moves into the mod so an n-body physics mod
/// can supply the true encounter instead of a Kepler approximation that is
/// simply wrong under n-body. Null on <see cref="VesselTarget"/> when there is
/// no target, no shared reference frame, or no encounter within the horizon.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ClosestApproach
{
    /// <summary>Universal Time (seconds) of the minimum separation at or after the sample's UT.</summary>
    [SitrepUnit(Units.Seconds)]
    public double Time { get; set; }

    /// <summary>Separation (metres) at <see cref="Time"/>.</summary>
    [SitrepUnit(Units.Metres)]
    public double Distance { get; set; }
}

/// <summary>
/// The <c>vessel.target</c> channel payload: the active vessel's CURRENT
/// target only (no roster; <c>system.vessels</c>/<c>tar.availableVessels</c>'s
/// replacement is a deferred M1.5 add per the design doc §5.2). Kills V-8:
/// <see cref="RelativePosition"/>/<see cref="RelativeVelocity"/> both use the
/// ONE canonical <see cref="Vec3"/> shape, replacing Telemachus's two
/// incompatible vector encodings (bare <c>[x,y,z]</c> array vs. <c>{x,y,z}</c>
/// object) that coexisted across different key families.
///
/// <para><see cref="Orbit"/> reuses <see cref="VesselOrbit"/> itself (not a
/// separate "target orbit" shape): load-bearing per the design doc §2.2:
/// it lets the SDK propagate a target with the EXACT SAME code path as the
/// self vessel, so both are evaluated at the same view-UT by the same
/// propagation logic (the single-view-time invariant). Its nested
/// <see cref="Meta"/> is stamped with the SAME subject (the active vessel
/// producing this sample), not a separate target-vessel identity,
/// <see cref="VesselId"/>/<see cref="BodyIndex"/> below (M3 R3) now DO carry
/// the target's own identity, closing the §6.4 gap this doc comment used to
/// flag as deferred.</para>
///
/// <para>Whole-channel absence (the outer <c>VesselTarget?</c> being null)
/// means nothing is targeted, the common case, R1(b), never a sentinel
/// zero-distance/zero-vector record.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.target")]
public class VesselTarget
{
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    [SitrepUnit(Units.Enumeration)]
    public TargetKind Kind { get; set; }

    /// <summary>
    /// The target's own stable id: the M3 R3 fix for the "no target id to
    /// round-trip into <c>vessel.target.set</c>" gap this class's doc
    /// comment (§6.4) originally flagged as deferred. Populated ONLY when
    /// <see cref="Kind"/> is <see cref="TargetKind.Vessel"/>, KSP's
    /// <c>Vessel.id</c> guid, the same opaque id <c>system.vessels</c>'
    /// roster and <c>SetTargetArgs.VesselId</c> both use, so a widget can
    /// read this straight off <c>vessel.target</c> and hand it back into a
    /// re-target command with no extra lookup. Null for a body/other target;
    /// see <see cref="BodyIndex"/> for the body case.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>
    /// The target's <c>system.bodies</c> index: populated ONLY when
    /// <see cref="Kind"/> is <see cref="TargetKind.Body"/>, mirroring
    /// <see cref="VesselId"/>'s vessel case and <see cref="SetTargetArgs.BodyIndex"/>'s
    /// own field. Null for a vessel/other target, or if the body name
    /// couldn't be resolved against <c>system.bodies</c> this tick.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>
    /// The target part's KSP <c>Part.flightID</c>: populated ONLY when
    /// <see cref="Kind"/> is <see cref="TargetKind.Part"/> (a docking port),
    /// scoped by <see cref="VesselId"/> (which carries the owning vessel's guid
    /// in the Part case). Null for every other kind. A widget reads this pair
    /// straight off <c>vessel.target</c> and hands it back into
    /// <see cref="SetTargetArgs.PartId"/> to re-target the same port.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public uint? PartId { get; set; }

    /// <summary>Metres, self-relative. Null only when the transform data needed to compute it wasn't available this tick.</summary>
    [SitrepUnit(Units.Metres)]
    public Vec3? RelativePosition { get; set; }

    /// <summary>m/s, self-relative. R7 Fix 3: nullable for consistency with <see cref="RelativePosition"/>, null (never a sentinel <c>(0,0,0)</c>, the V-10 ambiguity) when the transform data needed to compute it wasn't available this tick.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public Vec3? RelativeVelocity { get; set; }

    /// <summary>Null when the target has no orbit (e.g. it's landed, or its orbit couldn't be resolved this tick).</summary>
    public VesselOrbit? Orbit { get; set; }

    /// <summary>Next closest approach (mod-side, elected solver). Null when there is no encounter to report; see <see cref="ClosestApproach"/>.</summary>
    public ClosestApproach? ClosestApproach { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
