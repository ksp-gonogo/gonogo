#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.orbit.truth</c> channel payload: KSP's own maintained state
/// vector for the active vessel (<c>Orbit.pos</c> and <c>Orbit.vel</c>),
/// relative to the body it orbits. A development channel for checking
/// element-to-position math against KSP's own state, not a source of altitude
/// or velocity for a widget: read <c>vessel.orbit</c> for those. Absent when
/// the state vector or the frame flag could not be read.
///
/// <para><see cref="FrameRotating"/> says which frame the vectors are in, and
/// a comparison must gate on it. When it is false they are in the fixed,
/// non-rotating frame the orbital elements are defined against, and are
/// directly comparable to a Kepler propagation of those elements. When it is
/// true (KSP switches to this below a body's
/// <c>inverseRotThresholdAltitude</c>: low orbit, atmospheric flight, landed)
/// they are in a frame co-rotating with the body's spin, and differ from a
/// fixed-frame propagation by a rotation about the polar axis that grows with
/// time.</para>
/// <internal>
/// Dev-only by convention: nothing binds it from a widget, and there is no
/// engine-level flag hiding it from the data picker. KspHost.BuildOrbit's doc
/// comment has the full frame derivation.
/// </internal>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.orbit.truth")]
public class VesselOrbitTruth
{
    /// <summary>
    /// Position in metres relative to the body the vessel orbits, KSP's
    /// <c>Orbit.pos</c>, in the frame <see cref="FrameRotating"/> names.
    /// <para>To check element-to-position math, compare against the reported
    /// value, never a reckoned one: reckoning applies the same Kepler
    /// propagator being checked, so it agrees with itself by construction.</para>
    /// </summary>
    [SitrepUnit(Units.Metres)]
    /*
     * A state vector plus mu is a conic, so the pair advances together. frameRotating is declared
     * because the model does not apply when it is true, and declaring it lets the decline name what
     * ruled the model out. @vessel.orbit#horizon is declared because only an Analytic horizon claims
     * the elements are a conic at all, and a consumer holding only the stream cannot infer that from mu.
     */
    [SitrepFrame(Frames.BodyCentredInertial, WhenSet = Frames.BodyCentredRotating, SelectedBy = "frameRotating")]
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "velocity", "frameRotating", "@vessel.orbit#mu", "@vessel.orbit#horizon")]
    public Vec3 Position { get; set; } = new();

    /// <summary>Velocity in m/s relative to the body the vessel orbits, KSP's <c>Orbit.vel</c>, in the frame <see cref="FrameRotating"/> names.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    // The same conic seen from the other half of the state vector; see Position.
    [SitrepFrame(Frames.BodyCentredInertial, WhenSet = Frames.BodyCentredRotating, SelectedBy = "frameRotating")]
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "position", "frameRotating", "@vessel.orbit#mu", "@vessel.orbit#horizon")]
    public Vec3 Velocity { get; set; } = new();

    /// <summary>The reference body's <c>CelestialBody.inverseRotation</c>: true when <see cref="Position"/> and <see cref="Velocity"/> are in a frame co-rotating with the body, false when they are in the fixed inertial frame.</summary>
    [SitrepUnit(Units.Flag)]
    public bool FrameRotating { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
