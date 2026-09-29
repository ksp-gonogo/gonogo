#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One conic segment of a vessel's future trajectory, a patched-conic
/// "patch" in KSP's own sense (<c>Orbit.nextPatch</c>/<c>previousPatch</c>).
/// A patch carries everything needed to propagate and draw it with no
/// <c>system.bodies</c> join: its Keplerian elements, KSP's own
/// already-computed shape fields (<see cref="PeA"/>, <see cref="ApA"/>,
/// <see cref="SemiLatusRectum"/>, <see cref="SemiMinorAxis"/>), its body's
/// gravitational parameter (<see cref="Mu"/>) and the transitions at each end.
///
/// <para>Bodies are carried twice. <see cref="ReferenceBodyIndex"/> and
/// <see cref="ClosestEncounterBodyIndex"/> are the identity, the
/// <c>system.bodies</c> index every other body reference in this contract uses
/// (<see cref="VesselOrbit.ReferenceBodyIndex"/> among them). <see cref="ReferenceBody"/>
/// and <see cref="ClosestEncounterBody"/> are the body's name, for display.</para>
///
/// <para>Every element is a plain, non-nullable double, unlike
/// <see cref="VesselOrbit.Lan"/> and <see cref="VesselOrbit.ArgPe"/>: a patch
/// missing any element needed to propagate it is not sent at all, rather than
/// sent with a stand-in.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class OrbitPatch
{
    /// <summary>Semi-major axis in metres, KSP's <c>Orbit.semiMajorAxis</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double Sma { get; set; }

    /// <summary>Eccentricity, KSP's <c>Orbit.eccentricity</c>: below 1 for a closed patch.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double Ecc { get; set; }

    /// <summary>Inclination in degrees, KSP's <c>Orbit.inclination</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double Inc { get; set; }

    /// <summary>Longitude of the ascending node in degrees, KSP's <c>Orbit.LAN</c>. <c>0</c> when KSP's value is undefined (NaN).</summary>
    [SitrepUnit(Units.Degrees)]
    public double Lan { get; set; }

    /// <summary>Argument of periapsis in degrees, KSP's <c>Orbit.argumentOfPeriapsis</c>. <c>0</c> when KSP's value is undefined (NaN).</summary>
    [SitrepUnit(Units.Degrees)]
    public double ArgPe { get; set; }

    /// <summary>Mean anomaly at <see cref="Epoch"/> in radians, KSP's <c>Orbit.meanAnomalyAtEpoch</c>. <c>0</c> when KSP's value is undefined (NaN).</summary>
    [SitrepUnit(Units.Radians)]
    public double MeanAnomalyAtEpoch { get; set; }

    /// <summary>The universal time at which <see cref="MeanAnomalyAtEpoch"/> holds, KSP's <c>Orbit.epoch</c>.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Epoch { get; set; }

    /// <summary>Orbital period in seconds, KSP's <c>Orbit.period</c>. Always
    /// finite: a patch whose period is not finite is not carried in the chain.</summary>
    [SitrepUnit(Units.Seconds)]
    public double Period { get; set; }

    /// <summary>Universal time at which the trajectory enters this patch, KSP's <c>Orbit.StartUT</c>.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartUt { get; set; }

    /// <summary>Universal time at which the trajectory leaves this patch, KSP's <c>Orbit.EndUT</c>.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double EndUt { get; set; }

    /// <summary>How the trajectory enters this patch, KSP's <c>Orbit.patchStartTransition</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public TransitionType PatchStartTransition { get; set; }

    /// <summary>How the trajectory leaves this patch, KSP's <c>Orbit.patchEndTransition</c>. <see cref="TransitionType.Final"/> when it does not leave it.</summary>
    [SitrepUnit(Units.Enumeration)]
    public TransitionType PatchEndTransition { get; set; }

    /// <summary>Periapsis altitude above <see cref="ReferenceBody"/>'s mean
    /// radius in metres, KSP's <c>Orbit.PeA</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double PeA { get; set; }

    /// <summary>Apoapsis altitude above <see cref="ReferenceBody"/>'s mean
    /// radius in metres, KSP's <c>Orbit.ApA</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double ApA { get; set; }

    /// <summary>Semi-latus rectum in metres, KSP's <c>Orbit.semiLatusRectum</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double SemiLatusRectum { get; set; }

    /// <summary>Semi-minor axis in metres, KSP's <c>Orbit.semiMinorAxis</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double SemiMinorAxis { get; set; }

    /// <summary>Name of the body this patch orbits, as <c>system.bodies</c>
    /// names it. For display; <see cref="ReferenceBodyIndex"/> is the identity.</summary>
    [SitrepUnit(Units.Text)]
    public string ReferenceBody { get; set; } = "";

    /// <summary>Name of the body this patch's trajectory most closely
    /// encounters, KSP's <c>Orbit.closestEncounterBody</c>; null when there is
    /// none. For display; <see cref="ClosestEncounterBodyIndex"/> is the identity.</summary>
    [SitrepUnit(Units.Text)]
    public string? ClosestEncounterBody { get; set; }

    /// <summary>
    /// Parent body's standard gravitational parameter (GM), read off the same
    /// body the elements are relative to, so a patch can be propagated from
    /// what it carries, as <see cref="VesselOrbit.Mu"/> does for a vessel's own
    /// orbit.
    ///
    /// <para>Null only on a patch read off a recording that does not carry it,
    /// on the same terms as <see cref="ManeuverNode.Id"/>. Never 0.</para>
    /// </summary>
    [SitrepUnit(Units.CubicMetresPerSecondSquared)]
    public double? Mu { get; set; }

    /// <summary>
    /// Body this patch orbits, as its <c>system.bodies</c> index (KSP's
    /// <c>CelestialBody.flightGlobalsIndex</c>). This is the identity, where
    /// <see cref="ReferenceBody"/> is the display name, and it is the key every
    /// other body reference in this contract uses
    /// (<see cref="VesselOrbit.ReferenceBodyIndex"/>, <c>VesselTarget</c>,
    /// <c>TargetAvailable</c>, <c>VesselIdentity.ParentBodyIndex</c>).
    ///
    /// <para>Null only on a patch read off a recording that does not carry it,
    /// as for <see cref="Mu"/>. <c>0</c> is a real index (the star), so null is
    /// the only absent value.</para>
    /// <internal>
    /// Also what Sitrep.Propagation's PropagationTarget and PropagationFrame
    /// name a body by.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? ReferenceBodyIndex { get; set; }

    /// <summary>
    /// <see cref="ClosestEncounterBody"/>'s <c>system.bodies</c> index, on the
    /// same terms as <see cref="ReferenceBodyIndex"/>. Null when there is no
    /// encounter, and also null on a recording that does not carry it; read
    /// <see cref="ClosestEncounterBody"/> to tell the two apart.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? ClosestEncounterBodyIndex { get; set; }
}
