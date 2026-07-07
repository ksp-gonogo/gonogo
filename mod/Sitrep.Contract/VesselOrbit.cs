#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.orbit</c> channel payload — elements are the CAUSE; every
/// kinematic quantity (position/velocity/apsides/anomalies/period) is a
/// consumer-side derivation at view-UT via the propagation capability, never
/// streamed here ("elements-not-position" — m1-provider-taxonomy-design.md
/// §2.2/§4). Kills O-1 (there is no <c>eccentricAnomaly</c> field at all —
/// the copy-paste-bug class can't exist on a wire that never carries one),
/// O-8 (spelled-out, unit-annotated fields, UT always <c>double</c>), O-9
/// (<see cref="Encounter"/> is a typed nullable record, never the
/// -1/0/1 + "" + NaN sentinel spray of o.encounterExists/Time/Body), O-10
/// (no duplicate apsis keys).
///
/// Units: <see cref="Sma"/> in metres; <see cref="Inc"/>/<see cref="Lan"/>/
/// <see cref="ArgPe"/> in DEGREES (KSP-native); <see cref="MeanAnomalyAtEpoch"/>
/// in RADIANS (also KSP-native) — this degrees/radians split is an inherited
/// KSP inconsistency deliberately KEPT, not "fixed," per
/// m1-provider-taxonomy-design.md §6.7 (converting would desync from every
/// KSP reference and the recorder's own raw values).
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselOrbit
{
    public int ReferenceBodyIndex { get; set; }

    public double Sma { get; set; }

    public double Ecc { get; set; }

    public double Inc { get; set; }

    /// <summary>Null = undefined ascending node (KSP's own LAN is NaN for a near-equatorial orbit, inc ~ 0 -- a routine case, not an error). Never NaN, never 0 as a stand-in (R1/F-1).</summary>
    public double? Lan { get; set; }

    /// <summary>Null = undefined periapsis (KSP's own argumentOfPeriapsis is NaN for a near-circular orbit, ecc ~ 0 -- a routine case, not an error). Never NaN, never 0 as a stand-in (R1/F-1).</summary>
    public double? ArgPe { get; set; }

    public double MeanAnomalyAtEpoch { get; set; }

    /// <summary>Epoch UT, in seconds -- the same UT-seconds convention as every other UT-typed field on this record (matches KSP's own <c>Orbit.epoch</c> units).</summary>
    public double Epoch { get; set; }

    /// <summary>Parent body's standard gravitational parameter (GM) — self-sufficient propagation, no separate body lookup required.</summary>
    public double Mu { get; set; }

    /// <summary>Null = no upcoming SOI transition on the current trajectory (the common case) — NEVER a sentinel (kills O-9).</summary>
    public OrbitEncounter? Encounter { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>One upcoming SOI patch transition — see <see cref="VesselOrbit.Encounter"/>.</summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class OrbitEncounter
{
    public TransitionType TransitionType { get; set; }

    public double TransitionUt { get; set; }

    /// <summary>Index into <c>system.bodies</c> of the body being transitioned INTO; null if that body couldn't be resolved.</summary>
    public int? BodyIndex { get; set; }
}
