#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.orbit</c> channel payload: the active vessel's orbital
/// elements. Elements are the cause; every kinematic quantity (position,
/// velocity, apsides, anomalies, period) is derived by the consumer at its
/// view UT through the propagation capability, and is not streamed here. The
/// one exception is the pair of apsis countdowns under physics,
/// <see cref="TimeToAp"/> and <see cref="TimeToPe"/>.
///
/// <para>Units: <see cref="Sma"/> in metres; <see cref="Inc"/>,
/// <see cref="Lan"/> and <see cref="ArgPe"/> in DEGREES; and
/// <see cref="MeanAnomalyAtEpoch"/> in RADIANS. The degrees/radians split is
/// KSP's own and is kept so every value matches KSP's <c>Orbit</c>.</para>
///
/// <para>A coast moves only <see cref="MeanAnomalyAtEpoch"/> and
/// <see cref="Epoch"/>, by Kepler propagation; the other elements are
/// constants of the orbit. A burn moves every element, by powered integration
/// from <c>vessel.propulsion</c>, the firing stage's propellant in
/// <c>dv.stages</c> and <c>system.bodies</c>. A reckoning's <c>modelled</c>
/// list says which paths its model moved, and a consumer wanting a whole
/// modelled orbit overlays those on the observed payload.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.orbit")]
public class VesselOrbit
{
    /// <summary>Index into <c>system.bodies</c> of the body this orbit is around.</summary>
    [SitrepUnit(Units.Id)]
    public int ReferenceBodyIndex { get; set; }

    /// <summary>Semi-major axis, in metres.</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepReckonable(ReckoningBases.PoweredIntegration, "mu", "@vessel.propulsion", "@dv.stages", "@vessel.structure", "@system.bodies")]
    public double Sma { get; set; }

    /// <summary>Eccentricity. Below 1 for a closed orbit, 1 or above for an escape trajectory.</summary>
    [SitrepUnit(Units.Dimensionless)]
    [SitrepReckonable(ReckoningBases.PoweredIntegration, "mu", "@vessel.propulsion", "@dv.stages", "@vessel.structure", "@system.bodies")]
    public double Ecc { get; set; }

    /// <summary>Inclination, in degrees (KSP's <c>Orbit.inclination</c>).</summary>
    [SitrepUnit(Units.Degrees)]
    [SitrepReckonable(ReckoningBases.PoweredIntegration, "mu", "@vessel.propulsion", "@dv.stages", "@vessel.structure", "@system.bodies")]
    public double Inc { get; set; }

    /// <summary>Longitude of ascending node, degrees; <c>null</c> only when absent, never NaN and never 0 as a stand-in. An equatorial orbit still has one.</summary>
    [SitrepUnit(Units.Degrees)]
    [SitrepReckonable(ReckoningBases.PoweredIntegration, "mu", "@vessel.propulsion", "@dv.stages", "@vessel.structure", "@system.bodies")]
    public double? Lan { get; set; }

    /// <summary>Argument of periapsis, degrees; <c>null</c> only when absent, never NaN and never 0 as a stand-in. A circular orbit still has one.</summary>
    [SitrepUnit(Units.Degrees)]
    [SitrepReckonable(ReckoningBases.PoweredIntegration, "mu", "@vessel.propulsion", "@dv.stages", "@vessel.structure", "@system.bodies")]
    public double? ArgPe { get; set; }

    /// <summary>
    /// Mean anomaly at <see cref="Epoch"/>, in RADIANS, not degrees, matching
    /// KSP's <c>Orbit.meanAnomalyAtEpoch</c>. Reckonable by Kepler
    /// propagation, from <see cref="Sma"/>, <see cref="Mu"/>,
    /// <see cref="Horizon"/> and <c>system.bodies</c>, and under a burn by
    /// powered integration with the other elements.
    /// </summary>
    [SitrepUnit(Units.Radians)]
    /*
     * A coast moves the phase and nothing else, so this pair is the whole of what a conic advances.
     * The mark is what makes the model's refusal reachable: under thrust the conic withdraws, and
     * without a mark that withdrawal reads as `reckoning: "none"`, indistinguishable from an
     * unmodelled topic.
     */
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "sma", "mu", "horizon", "@system.bodies")]
    [SitrepReckonable(ReckoningBases.PoweredIntegration, "mu", "@vessel.propulsion", "@dv.stages", "@vessel.structure", "@system.bodies")]
    public double MeanAnomalyAtEpoch { get; set; }

    /// <summary>
    /// The reference epoch of <see cref="MeanAnomalyAtEpoch"/>, as a universal
    /// time in seconds (KSP's <c>Orbit.epoch</c>). Reckonable with
    /// <see cref="MeanAnomalyAtEpoch"/> by the same model.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    // Moves with MeanAnomalyAtEpoch: advancing one without the other would date the phase to the wrong instant.
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "sma", "mu", "horizon", "@system.bodies")]
    [SitrepReckonable(ReckoningBases.PoweredIntegration, "mu", "@vessel.propulsion", "@dv.stages", "@vessel.structure", "@system.bodies")]
    public double Epoch { get; set; }

    /// <summary>The reference body's standard gravitational parameter (GM), so the elements propagate without a separate body lookup.</summary>
    [SitrepUnit(Units.CubicMetresPerSecondSquared)]
    public double Mu { get; set; }

    /// <summary>
    /// Seconds from this sample's <c>validAt</c> until the craft next reaches
    /// apoapsis on the orbit these elements describe, as KSP computes it
    /// (<c>Orbit.timeToAp</c>). Carried only while the craft is under physics
    /// (<c>meta.quality</c> <c>Loaded</c>): on rails the same figure follows
    /// exactly from the elements, and the field is null. Also null on a
    /// hyperbolic orbit, which has no apoapsis. Never a sentinel in place of
    /// null.
    ///
    /// <para>True at <c>validAt</c>. A reader at a later instant subtracts the
    /// elapsed time, wrapping by the period once the apsis has passed.</para>
    /// <internal>
    /// Under physics the elements are osculating and change every sample, and the
    /// client's conic reckoner advances them only across a coast it can show.
    /// KSP's countdown is a property of the same instantaneous orbit as the
    /// apsides and needs no advancing. On rails it would change every tick and defeat the channel's
    /// value-equality change gate, which is why it is withheld there.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? TimeToAp { get; set; }

    /// <summary>
    /// Seconds from this sample's <c>validAt</c> until the craft next reaches
    /// periapsis, as KSP computes it (<c>Orbit.timeToPe</c>). Carried under the
    /// same rule as <see cref="TimeToAp"/>: only while <c>meta.quality</c> is
    /// <c>Loaded</c>, null on rails. On a hyperbolic orbit it is null once the
    /// periapsis has been passed, since there is no next one. Never a sentinel in
    /// place of null.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? TimeToPe { get; set; }

    /// <summary>
    /// The next sphere-of-influence transition on the current trajectory. Null
    /// when there is none (the common case), never a sentinel. A
    /// <see cref="LockedValue"/> while the Tracking Station does not show
    /// patched conics, since the game then computes no transition at all.
    /// </summary>
    [SitrepRequires("orbit-display", Facility = "TrackingStation", Quantity = "patchedConics")]
    public OrbitEncounter? Encounter { get; set; }

    /// <summary>
    /// The vessel's future-orbit patch chain. Element 0 is the current patch
    /// (the same elements as the fields above, restated in
    /// <see cref="OrbitPatch"/>'s shape so a client walks one list), followed
    /// by any later sphere-of-influence patches KSP's patched-conic solver has
    /// already resolved. Always an array, empty rather than null when there is
    /// no chain.
    /// <internal>
    /// Built by Gonogo.KSP.KspHost.BuildOrbitPatchChain.
    /// </internal>
    /// </summary>
    public List<OrbitPatch> Patches { get; set; } = new();

    /// <summary>
    /// How far ahead these elements may be propagated before they stop being
    /// trustworthy. Never null: a producer that does not state a horizon
    /// leaves it <see cref="PropagationHorizonKind.Unspecified"/>, which reads
    /// as unpropagatable.
    ///
    /// <para>A client cannot compute this: it depends on the perturbation
    /// environment (which bodies are near, how massive, how far), so it
    /// arrives on the sample. It rides here, beside the elements, because a
    /// horizon and the elements it bounds share one <c>validAt</c>; carried
    /// separately, a client could hold one sample's elements beside another's
    /// horizon.</para>
    /// </summary>
    public PropagationHorizon Horizon { get; set; } = new();

    /// <summary>Payload provenance. <c>Source</c> is <c>"vessel:&lt;guid&gt;"</c> for the active vessel; <c>Quality</c> is <c>Loaded</c> under physics and <c>OnRails</c> otherwise.</summary>
    public OrbitPayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The window over which an element set is authoritative, as stated by
/// whichever propagation provider produced it.
///
/// <para>Measured from the sample's observation instant, not from
/// <see cref="VesselOrbit.Epoch"/>. <c>Epoch</c> is the mean-anomaly reference
/// epoch and can sit far from when the sample was taken.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PropagationHorizon
{
    /// <summary>How far the elements may be carried forward. When <see cref="PropagationHorizonKind.Until"/>, <see cref="UntilUt"/> says where the window ends.</summary>
    [SitrepUnit(Units.Enumeration)]
    public PropagationHorizonKind Kind { get; set; }

    /// <summary>
    /// What kind of trajectory these elements describe: a conic that is the
    /// path, or a snapshot of an integrated one.
    ///
    /// <para>The horizon says how far a client may extrapolate; this says
    /// whether a conic is the right renderer at all, and the one cannot be
    /// inferred from the other. An analytic provider reports
    /// <see cref="PropagationHorizonKind.Unbounded"/>, and so may an
    /// integrating provider where perturbations are small and the horizon is
    /// genuinely long. A client that reasons "unbounded, therefore analytic"
    /// draws a closed conic for an integrated trajectory: right at the sample
    /// instant, wrong as a path.</para>
    ///
    /// <para>To identify the provider for diagnostics, read
    /// <c>system.uplinks</c>, which carries each Uplink's id, version and
    /// availability.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public TrajectoryKind TrajectoryKind { get; set; }

    /// <summary>
    /// The last UT these elements are authoritative for. Set if and only if
    /// <see cref="Kind"/> is <see cref="PropagationHorizonKind.Until"/>; null
    /// otherwise, never a sentinel standing in for "forever".
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? UntilUt { get; set; }
}

/// <summary>
/// How far an element set may be carried forward.
///
/// <para><see cref="Unspecified"/> is 0, so a producer that does not set the
/// horizon gets the refusing value rather than the permissive one.</para>
///
/// <para><see cref="Unbounded"/> is a claim, made by a provider that genuinely
/// has no limit (an analytic two-body solver). It is its own value rather than
/// an infinite <see cref="PropagationHorizon.UntilUt"/>, so "forever" never has
/// to be recognised as an extreme number.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum PropagationHorizonKind
{
    /// <summary>No provider stated one. Treat as unpropagatable.</summary>
    Unspecified = 0,

    /// <summary>Authoritative for all future UT: an analytic solver with no
    /// horizon.</summary>
    Unbounded = 1,

    /// <summary>Authoritative until <see
    /// cref="PropagationHorizon.UntilUt"/>.</summary>
    Until = 2,
}

/// <summary>
/// What kind of thing an element set describes: a closed-form conic, or a
/// snapshot of an integrated path.
///
/// <para><see cref="Unspecified"/> is 0 for the same reason as
/// <see cref="PropagationHorizonKind.Unspecified"/>: a producer that does not
/// set the field gets the value that withholds rather than the one that
/// permits.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TrajectoryKind
{
    /// <summary>No provider stated one. Treat the shape as unknown.</summary>
    Unspecified = 0,

    /// <summary>
    /// A closed-form conic. The orbit IS an ellipse, so a conic renderer is
    /// exactly right and stays right for as long as the horizon allows.
    /// </summary>
    Analytic = 1,

    /// <summary>
    /// A numerically integrated path. The osculating conic on the wire is a
    /// snapshot of it, true at the sample instant and never the path itself, so
    /// a client that draws a closed ellipse from it is drawing something the
    /// craft will not fly.
    /// </summary>
    Integrated = 2,
}

/// <summary>The next sphere-of-influence transition on the vessel's trajectory: see <see
/// cref="VesselOrbit.Encounter"/>.</summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class OrbitEncounter
{
    /// <summary>The kind of transition: always <see cref="Sitrep.Contract.TransitionType.Encounter"/> (entering another body's sphere of influence) or <see cref="Sitrep.Contract.TransitionType.Escape"/> (leaving the current one).</summary>
    [SitrepUnit(Units.Enumeration)]
    public TransitionType TransitionType { get; set; }

    /// <summary>Universal time at which the vessel crosses the sphere-of-influence boundary.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double TransitionUt { get; set; }

    /// <summary>Index into <c>system.bodies</c> of the body being transitioned
    /// INTO; null if that body couldn't be resolved.</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }
}
