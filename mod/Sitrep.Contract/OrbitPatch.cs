#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One conic segment of a vessel's future trajectory — a patched-conic
/// "patch" in KSP's own sense (<c>Orbit.nextPatch</c>/<c>previousPatch</c>).
/// Unlike <see cref="VesselOrbit"/> (which is deliberately elements-only —
/// see its own doc comment), a patch chain exists purely so the CLIENT can
/// propagate/render a forward trajectory, so it carries the same
/// already-computed apsis/shape fields KSP's own <c>Orbit</c> exposes
/// (<see cref="PeA"/>/<see cref="ApA"/>/<see cref="SemiLatusRectum"/>/
/// <see cref="SemiMinorAxis"/>) rather than forcing the client to re-derive
/// them per patch. <see cref="ReferenceBody"/>/<see cref="ClosestEncounterBody"/>
/// are body NAME strings (not indexes) — the one deliberate departure from
/// <see cref="VesselOrbit.ReferenceBodyIndex"/>'s convention, so the client's
/// existing patch-consuming math (<c>packages/core/src/calc/trajectory.ts</c>,
/// which predates this Topic and already expects body names) needs zero
/// reshaping to use these fields directly.
///
/// <see cref="Lan"/>/<see cref="ArgPe"/> are plain (non-nullable) doubles here,
/// UNLIKE <see cref="VesselOrbit.Lan"/>/<see cref="VesselOrbit.ArgPe"/> — a
/// deliberate, narrower exception to this codebase's usual R1 "never NaN,
/// never a fake 0" rule: the client's propagation math
/// (<c>trajectory.ts</c>'s <c>patchStateAt</c>) already hard-assumes a finite
/// number for both (no null-handling branch), matching Telemachus's own
/// historical behaviour for a near-circular/near-equatorial patch. Capturing
/// them nullable here would silently break every consumer without a matching
/// client-side rewrite — out of scope for this Topic. See
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
    public double Sma { get; set; }

    public double Ecc { get; set; }

    public double Inc { get; set; }

    public double Lan { get; set; }

    public double ArgPe { get; set; }

    public double MeanAnomalyAtEpoch { get; set; }

    public double Epoch { get; set; }

    /// <summary>Orbital period, seconds. Non-finite (hyperbolic/parabolic patches) is carried as-is — the client's `isPatchElliptical` guard is what filters those, not this field.</summary>
    public double Period { get; set; }

    public double StartUt { get; set; }

    public double EndUt { get; set; }

    public TransitionType PatchStartTransition { get; set; }

    public TransitionType PatchEndTransition { get; set; }

    /// <summary>Periapsis altitude above <see cref="ReferenceBody"/>'s mean radius, metres — `Orbit.PeA`.</summary>
    public double PeA { get; set; }

    /// <summary>Apoapsis altitude above <see cref="ReferenceBody"/>'s mean radius, metres — `Orbit.ApA`.</summary>
    public double ApA { get; set; }

    public double SemiLatusRectum { get; set; }

    public double SemiMinorAxis { get; set; }

    /// <summary>Body this patch orbits — matches `system.bodies`' NAME, not its index (see class doc).</summary>
    public string ReferenceBody { get; set; } = "";

    /// <summary>Body this patch's trajectory most closely encounters, if any — null when there is none. Same "name, not index" convention as <see cref="ReferenceBody"/>.</summary>
    public string? ClosestEncounterBody { get; set; }
}
