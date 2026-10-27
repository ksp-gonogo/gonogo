#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// KSP's own maintained state
/// vector for the active vessel (<c>Orbit.pos</c> and <c>Orbit.vel</c>),
/// relative to the body it orbits, in the fixed frame. Read <c>vessel.orbit</c> for altitude and
/// velocity.
/// <internal>
/// A development channel for checking element-to-position math against KSP's
/// own state.
/// </internal> Absent when
/// the state vector or the frame flag could not be read.
///
/// <para>The vectors are always in the fixed, non-rotating frame the orbital
/// elements are defined against, whatever the vessel's altitude, so they are
/// directly comparable to a Kepler propagation of those elements.
/// <see cref="FrameRotating"/> is always false.</para>
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
[SitrepTopic("vessel.orbit.truth", DisplayName = "Active vessel orbit (true)")]
public class VesselOrbitTruth
{
    /// <summary>
    /// Position in metres relative to the body the vessel orbits, KSP's
    /// <c>Orbit.pos</c> taken into the fixed frame.
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

    /// <summary>Velocity in m/s relative to the body the vessel orbits, KSP's <c>Orbit.vel</c> taken into the fixed frame.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    // The same conic seen from the other half of the state vector; see Position.
    [SitrepFrame(Frames.BodyCentredInertial, WhenSet = Frames.BodyCentredRotating, SelectedBy = "frameRotating")]
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "position", "frameRotating", "@vessel.orbit#mu", "@vessel.orbit#horizon")]
    public Vec3 Velocity { get; set; } = new();

    /// <summary>Always false: <see cref="Position"/> and <see cref="Velocity"/> are in the fixed inertial frame, never one co-rotating with the body.</summary>
    [SitrepUnit(Units.Flag)]
    public bool FrameRotating { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
