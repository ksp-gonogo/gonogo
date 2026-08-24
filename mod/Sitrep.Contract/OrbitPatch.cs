#if SITREP_CODEGEN
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
/// are body NAME strings, because the client's existing patch-consuming math
/// (<c>packages/core/src/calc/trajectory.ts</c>, which predates this Topic and
/// already expects body names) needs zero reshaping to use them directly.
///
/// <see cref="ReferenceBodyIndex"/>/<see cref="ClosestEncounterBodyIndex"/> sit
/// beside them and are the IDENTITY, matching
/// <see cref="VesselOrbit.ReferenceBodyIndex"/> and every other body reference
/// in this contract. Both are carried on purpose: the names were once described
/// here as "the one deliberate departure" from the index convention, which held
/// only while nothing needed to resolve a patch's body to anything. Propagating
/// a patch does, and a display name is the wrong key for that.
///
/// <see cref="Mu"/> completes the same thought: a patch now carries everything
/// needed to propagate it, so it is no longer the only orbit on the wire that
/// requires a <c>system.bodies</c> join before it can be used.
///
/// <see cref="Lan"/>/<see cref="ArgPe"/> are plain (non-nullable) doubles here,
/// UNLIKE <see cref="VesselOrbit.Lan"/>/<see cref="VesselOrbit.ArgPe"/>: a
/// deliberate, narrower exception to this codebase's usual R1 "never NaN,
/// never a fake 0" rule: the client's propagation math
/// (<c>trajectory.ts</c>'s <c>patchStateAt</c>) already hard-assumes a finite
/// number for both (no null-handling branch), matching the historical
/// behaviour for a near-circular/near-equatorial patch. Capturing
/// them nullable here would silently break every consumer without a matching
/// client-side rewrite: out of scope for this Topic. See
/// <c>Gonogo.KSP.KspHost.BuildOrbitPatchChain</c>'s doc comment for how a
/// NaN is substituted with 0 at capture time, preserving that pre-existing
/// (imperfect but non-breaking) behaviour.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
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

    [SitrepUnit(Units.UniversalTime)]
    public double Epoch { get; set; }

    /// <summary>Orbital period, seconds. Non-finite (hyperbolic/parabolic patches) is carried as-is, the client's `isPatchElliptical` guard is what filters those, not this field.</summary>
    [SitrepUnit(Units.Seconds)]
    public double Period { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double StartUt { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double EndUt { get; set; }

    [SitrepUnit(Units.Enumeration)]
    public TransitionType PatchStartTransition { get; set; }

    [SitrepUnit(Units.Enumeration)]
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
    [SitrepUnit(Units.Text)]
    public string ReferenceBody { get; set; } = "";

    /// <summary>Body this patch's trajectory most closely encounters, if any, null when there is none. Same "name, not index" convention as <see cref="ReferenceBody"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? ClosestEncounterBody { get; set; }

    /// <summary>
    /// Parent body's standard gravitational parameter (GM), so a patch is
    /// self-sufficient to propagate exactly as <see cref="VesselOrbit.Mu"/>
    /// makes a vessel's own orbit self-sufficient.
    ///
    /// <para>Without it a patch was the only orbit on the wire that could not
    /// be propagated from what it carries: a consumer had to resolve
    /// <see cref="ReferenceBody"/> through <c>system.bodies</c> to find the
    /// number. That asymmetry made an A/B between a vessel's own orbit and a
    /// maneuver patch measure the lookup as well as the arithmetic.</para>
    ///
    /// <para>Null only on a patch read off a recording captured BEFORE this
    /// field existed, on the same terms as <see cref="ManeuverNode.Id"/>.
    /// Nullable rather than 0 because a zero GM is not a body, and every
    /// consumer of it divides.</para>
    /// </summary>
    [SitrepUnit(Units.CubicMetresPerSecondSquared)]
    public double? Mu { get; set; }

    /// <summary>
    /// Body this patch orbits, as its <c>system.bodies</c> INDEX. The
    /// identity, where <see cref="ReferenceBody"/> is the display name: index
    /// is what every other body reference in this contract is keyed on
    /// (<see cref="VesselOrbit.ReferenceBodyIndex"/>, <c>VesselTarget</c>,
    /// <c>TargetAvailable</c>, <c>VesselIdentity.ParentBodyIndex</c>) and what
    /// <c>Sitrep.Propagation</c>'s <c>PropagationTarget</c> and
    /// <c>PropagationFrame</c> name a body by.
    ///
    /// <para>Carried ALONGSIDE the name rather than replacing it: the name is
    /// load-bearing in <c>orbit-patches.ts</c>'s SOI-change detection and in
    /// <c>trajectory.ts</c>, which predates this Topic (see the class doc), so
    /// dropping it is a client migration and not a contract edit.</para>
    ///
    /// <para>Null only on a pre-existing recording, per <see cref="Mu"/>.
    /// Nullable rather than 0 specifically because 0 is a REAL body index (the
    /// star), so a defaulted value here would read as a confident wrong answer
    /// rather than as an absent one.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? ReferenceBodyIndex { get; set; }

    /// <summary>
    /// <see cref="ClosestEncounterBody"/>'s <c>system.bodies</c> index, on the
    /// same index-is-identity terms as <see cref="ReferenceBodyIndex"/>. Null
    /// when there is no encounter at all, and also null on a pre-existing
    /// recording: the two are indistinguishable here, which is acceptable only
    /// because <see cref="ClosestEncounterBody"/> already carries the
    /// distinction.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? ClosestEncounterBodyIndex { get; set; }
}
