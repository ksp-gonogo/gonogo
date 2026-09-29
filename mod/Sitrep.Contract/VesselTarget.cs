#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Coarse classification of what <c>vessel.target</c> points at: a vessel, a
/// celestial body, a part of a vessel (a docking port), or
/// <see cref="Other"/> for anything not classified more finely (a waypoint,
/// for instance). A more specific kind may be added later; treat an
/// unrecognised value as <see cref="Other"/>.
///
/// <para>Member order is wire-significant, so members are only ever
/// appended.</para>
///
/// <para><see cref="Position"/> is used ONLY as an input to
/// <c>vessel.target.set</c> (see <see cref="SetTargetArgs.Latitude"/> and
/// <see cref="SetTargetArgs.Longitude"/>): a map-picked latitude and longitude
/// that no live KSP target object backs, so it never appears as
/// <c>vessel.target</c>'s own reported <see cref="VesselTarget.Kind"/>.</para>
/// <internal>
/// The capture's raw <c>type</c> string is a VesselType name, the literal
/// <c>"CelestialBody"</c>, the literal <c>"Part"</c> for any targetable part
/// module, or an arbitrary CLR type name, which the view provider collapses
/// to these members.
/// </internal>
/// </summary>
/// <category>Orbits and trajectories</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TargetKind
{
    /// <summary>A vessel. <see cref="VesselTarget.VesselId"/> carries its guid.</summary>
    Vessel,
    /// <summary>A celestial body. <see cref="VesselTarget.BodyIndex"/> carries its <c>system.bodies</c> index.</summary>
    Body,
    /// <summary>Anything not classified more finely, such as a waypoint. Carries no id.</summary>
    Other,
    /// <summary>A surface latitude and longitude, used only as a <c>vessel.target.set</c> input and never reported.</summary>
    Position,

    /// <summary>
    /// A part of a vessel: in practice a docking port (<c>ModuleDockingNode</c>,
    /// which implements <c>ITargetable</c>). Identity is the owning vessel's
    /// <see cref="VesselTarget.VesselId"/> guid PLUS the part's
    /// <see cref="VesselTarget.PartId"/> (KSP <c>Part.flightID</c>): a part id
    /// alone is not globally unique, only within its vessel.
    /// </summary>
    Part,
}

/// <summary>
/// Next closest approach between the active vessel and its current target,
/// computed by the mod's elected <see cref="IPropagationProvider"/> (stock
/// two-body Kepler by default, an n-body provider when one is elected over
/// it), so an n-body physics mod can supply the true encounter rather than a
/// Kepler approximation.
///
/// <para>It comes from the propagation provider rather than a solver of its own
/// so that the encounter and the trajectory it is an encounter ON are always the
/// same physics. Null on <see cref="VesselTarget"/> when there is no target, no
/// frame the provider can reach both objects in, or no encounter inside the
/// window it was asked about.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ClosestApproach
{
    /// <summary>Universal Time (seconds) of the minimum separation at or after
    /// the sample's UT.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Time { get; set; }

    /// <summary>Separation (metres) at <see cref="Time"/>.</summary>
    [SitrepUnit(Units.Metres)]
    public double Distance { get; set; }
}

/// <summary>
/// The <c>vessel.target</c> channel payload: the active vessel's CURRENT
/// target only. <see cref="RelativePosition"/>/<see cref="RelativeVelocity"/>
/// both use the one <see cref="Vec3"/> shape.
///
/// <para><see cref="Orbit"/> reuses <see cref="VesselOrbit"/> itself (not a
/// separate "target orbit" shape), so the SDK propagates a target with the same
/// code path as the active vessel and both are evaluated at the same view
/// time. Its nested <see cref="Meta"/> is stamped with the SAME subject (the
/// active vessel producing this sample), not the target's; <see cref="VesselId"/>
/// and <see cref="BodyIndex"/> carry the target's own identity.</para>
///
/// <para>A null payload means nothing is targeted, the common case, never a
/// zero-distance or zero-vector record.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.target")]
public class VesselTarget
{
    /// <summary>The target's name as KSP gives it (<c>ITargetable.GetName()</c>). Empty string when none was read.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>What kind of thing is targeted. Never <see cref="TargetKind.Position"/>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public TargetKind Kind { get; set; }

    /// <summary>
    /// The target's own stable id, populated when <see cref="Kind"/> is
    /// <see cref="TargetKind.Vessel"/> (KSP's <c>Vessel.id</c> guid) or
    /// <see cref="TargetKind.Part"/> (the owning vessel's guid). The same opaque
    /// id <c>system.vessels</c>' roster and <see cref="SetTargetArgs.VesselId"/>
    /// use, so a widget can hand it straight back into a re-target command
    /// with no extra lookup. Null for a body or other target; see
    /// <see cref="BodyIndex"/> for the body case.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>
    /// The target's <c>system.bodies</c> index, populated ONLY when
    /// <see cref="Kind"/> is <see cref="TargetKind.Body"/>, matching
    /// <see cref="SetTargetArgs.BodyIndex"/>. Null for any other target, or when
    /// the body name could not be resolved against <c>system.bodies</c> this
    /// tick.
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

    /// <summary>The target's position relative to the active vessel, in metres. Null only when the transform data needed to compute it was not available this tick.</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.SubjectRelative)]
    // Both the position and the velocity that advances it ride this one payload, so a consumer
    // holding nothing but the stream carries it forward with one multiply-add.
    [SitrepReckonable(ReckoningBases.LinearDeadReckoning, "relativeVelocity")]
    public Vec3? RelativePosition { get; set; }

    /// <summary>The target's velocity relative to the active vessel, in m/s. Null (never <c>(0,0,0)</c>) when the transform data needed to compute it was not available this tick.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    [SitrepFrame(Frames.SubjectRelative)]
    // Not reckonable: advancing a velocity needs an acceleration, and the wire publishes none for
    // the relative pair. Both craft's conics would give one, but only when both orbits exist and
    // share a reference body.
    public Vec3? RelativeVelocity { get; set; }

    /// <summary>The target's orbit. Null when the target has no orbit (it is landed, say, or its orbit could not be resolved this tick).</summary>
    public VesselOrbit? Orbit { get; set; }

    /// <summary>Next closest approach, from the mod's elected propagation provider. Null when there is no encounter to report; see <see cref="Sitrep.Contract.ClosestApproach"/>.</summary>
    public ClosestApproach? ClosestApproach { get; set; }

    /// <summary>The payload's provenance, stamped with the active vessel (<c>"vessel:&lt;guid&gt;"</c>), and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
