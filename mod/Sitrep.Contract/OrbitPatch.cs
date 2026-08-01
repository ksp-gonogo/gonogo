#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One conic segment of a vessel's future trajectory, a patched-conic
/// "patch" in KSP's own sense (<c>Orbit.nextPatch</c>/<c>previousPatch</c>).
/// Unlike <see cref="VesselOrbit"/> (which is deliberately elements-only,
/// see its own doc comment), a patch chain exists purely so the CLIENT can
/// propagate/render a forward trajectory, so it carries the same
/// already-computed apsis/shape fields KSP's own <c>Orbit</c> exposes
/// (<see cref="PeA"/>/<see cref="ApA"/>/<see cref="SemiLatusRectum"/>/
/// <see cref="SemiMinorAxis"/>) rather than forcing the client to re-derive
/// them per patch. <see cref="ReferenceBody"/>/<see cref="ClosestEncounterBody"/>
/// are body NAME strings (not indexes), the one deliberate departure from
/// <see cref="VesselOrbit.ReferenceBodyIndex"/>'s convention, so the client's
/// existing patch-consuming math (<c>packages/core/src/calc/trajectory.ts</c>,
/// which predates this Topic and already expects body names) needs zero
/// reshaping to use these fields directly.
///
/// <see cref="Lan"/>/<see cref="ArgPe"/> are plain (non-nullable) doubles here,
/// UNLIKE <see cref="VesselOrbit.Lan"/>/<see cref="VesselOrbit.ArgPe"/>: a
/// deliberate, narrower exception to this codebase's usual R1 "never NaN,
/// never a fake 0" rule: the client's propagation math
/// (<c>trajectory.ts</c>'s <c>patchStateAt</c>) already hard-assumes a finite
/// number for both (no null-handling branch), matching Telemachus's own
/// historical behaviour for a near-circular/near-equatorial patch. Capturing
/// them nullable here would silently break every consumer without a matching
/// client-side rewrite: out of scope for this Topic. See
/// <c>Gonogo.KSP.KspHost.BuildOrbitPatchChain</c>'s doc comment for how a
/// NaN is substituted with 0 at capture time, preserving that pre-existing
/// (imperfect but non-breaking) behaviour.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class OrbitPatch
{
    [SitrepUnit(Units.Metres)]
    public double Sma { get; set; }

    [SitrepUnit(Units.Dimensionless)]
    public double Ecc { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double Inc { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double Lan { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double ArgPe { get; set; }

    [SitrepUnit(Units.Radians)]
    public double MeanAnomalyAtEpoch { get; set; }

    [SitrepUnit(Units.Seconds)]
    public double Epoch { get; set; }

    /// <summary>Orbital period, seconds. Non-finite (hyperbolic/parabolic patches) is carried as-is, the client's `isPatchElliptical` guard is what filters those, not this field.</summary>
    [SitrepUnit(Units.Seconds)]
    public double Period { get; set; }

    [SitrepUnit(Units.Seconds)]
    public double StartUt { get; set; }

    [SitrepUnit(Units.Seconds)]
    public double EndUt { get; set; }

    public TransitionType PatchStartTransition { get; set; }

    public TransitionType PatchEndTransition { get; set; }

    /// <summary>Periapsis altitude above <see cref="ReferenceBody"/>'s mean radius, metres, `Orbit.PeA`.</summary>
    [SitrepUnit(Units.Metres)]
    public double PeA { get; set; }

    /// <summary>Apoapsis altitude above <see cref="ReferenceBody"/>'s mean radius, metres, `Orbit.ApA`.</summary>
    [SitrepUnit(Units.Metres)]
    public double ApA { get; set; }

    [SitrepUnit(Units.Metres)]
    public double SemiLatusRectum { get; set; }

    [SitrepUnit(Units.Metres)]
    public double SemiMinorAxis { get; set; }

    /// <summary>Body this patch orbits: matches `system.bodies`' NAME, not its index (see class doc).</summary>
    public string ReferenceBody { get; set; } = "";

    /// <summary>Body this patch's trajectory most closely encounters, if any, null when there is none. Same "name, not index" convention as <see cref="ReferenceBody"/>.</summary>
    public string? ClosestEncounterBody { get; set; }
}
