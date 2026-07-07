#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Coarse classification of what <c>vessel.target</c> points at. KspHost's
/// raw <c>type</c> string is either a <see cref="VesselType"/>-shaped string
/// (target is a vessel — <c>target.GetVessel() != null</c>), the literal
/// <c>"CelestialBody"</c>, or an arbitrary CLR type name for anything else
/// (a docking port, a waypoint, ...). Rather than reproduce that CLR-name
/// passthrough on the wire (its own naming wart), this contract collapses it
/// to the three cases a consumer actually needs to branch on;
/// <see cref="Other"/> covers docking ports/waypoints/anything not yet
/// classified more finely (a future, more specific target-kind split is a
/// non-breaking additive change, same convention as every other
/// <see cref="Unknown"/>-style fallback in this contract).
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
public enum TargetKind
{
    Vessel,
    Body,
    Other,
}

/// <summary>
/// The <c>vessel.target</c> channel payload — the active vessel's CURRENT
/// target only (no roster; <c>system.vessels</c>/<c>tar.availableVessels</c>'s
/// replacement is a deferred M1.5 add per the design doc §5.2). Kills V-8:
/// <see cref="RelativePosition"/>/<see cref="RelativeVelocity"/> both use the
/// ONE canonical <see cref="Vec3"/> shape, replacing Telemachus's two
/// incompatible vector encodings (bare <c>[x,y,z]</c> array vs. <c>{x,y,z}</c>
/// object) that coexisted across different key families.
///
/// <para><see cref="Orbit"/> reuses <see cref="VesselOrbit"/> itself (not a
/// separate "target orbit" shape) — load-bearing per the design doc §2.2:
/// it lets the SDK propagate a target with the EXACT SAME code path as the
/// self vessel, so both are evaluated at the same view-UT by the same
/// propagation logic (the single-view-time invariant). Its nested
/// <see cref="Meta"/> is stamped with the SAME subject (the active vessel
/// producing this sample), not a separate target-vessel identity — this
/// contract does not yet capture the target's own stable vessel id (a
/// one-line future capture add flagged in the design doc §6.4, deliberately
/// deferred here).</para>
///
/// <para>Whole-channel absence (the outer <c>VesselTarget?</c> being null)
/// means nothing is targeted — the common case, R1(b), never a sentinel
/// zero-distance/zero-vector record.</para>
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselTarget
{
    public string Name { get; set; } = "";

    public TargetKind Kind { get; set; }

    /// <summary>Metres, self-relative. Null only when the transform data needed to compute it wasn't available this tick.</summary>
    public Vec3? RelativePosition { get; set; }

    /// <summary>m/s, self-relative.</summary>
    public Vec3 RelativeVelocity { get; set; } = new();

    /// <summary>Null when the target has no orbit (e.g. it's landed, or its orbit couldn't be resolved this tick).</summary>
    public VesselOrbit? Orbit { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
