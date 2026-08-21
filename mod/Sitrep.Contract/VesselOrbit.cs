#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.orbit</c> channel payload: elements are the CAUSE; every
/// kinematic quantity (position/velocity/apsides/anomalies/period) is a
/// consumer-side derivation at view-UT via the propagation capability, never
/// streamed here ("elements-not-position": m1-provider-taxonomy-design.md
/// §2.2/§4). Kills O-1 (there is no <c>eccentricAnomaly</c> field at all,
/// the copy-paste-bug class can't exist on a wire that never carries one),
/// O-8 (spelled-out, unit-annotated fields, UT always <c>double</c>), O-9
/// (<see cref="Encounter"/> is a typed nullable record, never the
/// -1/0/1 + "" + NaN sentinel spray of o.encounterExists/Time/Body), O-10
/// (no duplicate apsis keys).
///
/// Units: <see cref="Sma"/> in metres; <see cref="Inc"/>/<see cref="Lan"/>/
/// <see cref="ArgPe"/> in DEGREES (KSP-native); <see cref="MeanAnomalyAtEpoch"/>
/// in RADIANS (also KSP-native): this degrees/radians split is an inherited
/// KSP inconsistency deliberately KEPT, not "fixed," per
/// m1-provider-taxonomy-design.md §6.7 (converting would desync from every
/// KSP reference and the recorder's own raw values).
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.orbit")]
public class VesselOrbit
{
    [SitrepUnit(Units.Id)]
    public int ReferenceBodyIndex { get; set; }

    /// <summary>Semi-major axis, metres (see the class doc comment's units block).</summary>
    [SitrepUnit(Units.Metres)]
    public double Sma { get; set; }

    /// <summary>Eccentricity: dimensionless by definition, hence the explicit "1" token rather than no annotation.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double Ecc { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double Inc { get; set; }

    /// <summary>Null = undefined ascending node (KSP's own LAN is NaN for a near-equatorial orbit, inc ~ 0 -- a routine case, not an error). Never NaN, never 0 as a stand-in (R1/F-1).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Lan { get; set; }

    /// <summary>Null = undefined periapsis (KSP's own argumentOfPeriapsis is NaN for a near-circular orbit, ecc ~ 0 -- a routine case, not an error). Never NaN, never 0 as a stand-in (R1/F-1).</summary>
    [SitrepUnit(Units.Degrees)]
    public double? ArgPe { get; set; }

    /// <summary>RADIANS, not degrees. The KSP-native degrees/radians split this record deliberately keeps (see the class doc comment) is exactly the kind of trap a machine-readable unit exists to defuse.</summary>
    [SitrepUnit(Units.Radians)]
    public double MeanAnomalyAtEpoch { get; set; }

    /// <summary>Epoch UT, in seconds -- the same UT-seconds convention as every other UT-typed field on this record (matches KSP's own <c>Orbit.epoch</c> units).</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Epoch { get; set; }

    /// <summary>Parent body's standard gravitational parameter (GM): self-sufficient propagation, no separate body lookup required.</summary>
    [SitrepUnit(Units.CubicMetresPerSecondSquared)]
    public double Mu { get; set; }

    /// <summary>Null = no upcoming SOI transition on the current trajectory (the common case); NEVER a sentinel (kills O-9).</summary>
    public OrbitEncounter? Encounter { get; set; }

    /// <summary>
    /// The vessel's future-orbit patch chain: element 0 is THIS patch (the
    /// current orbit, same elements as the fields above, restated in
    /// <see cref="OrbitPatch"/>'s shape for a uniform client-side walk),
    /// followed by any subsequent SOI-transition patches KSP's own
    /// patched-conic solver has already resolved. ALWAYS an array (R2),
    /// empty (not null) when there is no upcoming SOI transition, the
    /// overwhelmingly common case for a stable orbit. See
    /// <c>Gonogo.KSP.KspHost.BuildOrbitPatchChain</c> for the walk.
    /// </summary>
    public List<OrbitPatch> Patches { get; set; } = new();

    /// <summary>
    /// How far ahead these elements may be propagated before they stop being
    /// trustworthy. NOT nullable: a producer states its horizon or its samples
    /// read as unpropagatable, because "nobody said" must never be the
    /// permissive answer.
    ///
    /// <para>A client cannot compute this. Deriving it needs the perturbation
    /// environment (which bodies are near, how massive, how far), so it has to
    /// arrive on the sample from the only thing that knows. It rides HERE rather
    /// than on a sibling Topic because a horizon and the elements it bounds
    /// share one lifetime and one <c>validAt</c>: split across frames a client
    /// could hold one sample's elements beside another's horizon and draw a
    /// conic authorised by the wrong sample, silently.
    /// <see cref="OrbitPatch.StartUt"/>/<see cref="OrbitPatch.EndUt"/> already
    /// set the precedent for a validity window living with its elements.</para>
    /// </summary>
    public PropagationHorizon Horizon { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The window over which an element set is authoritative, as stated by whichever
/// propagation provider produced it.
///
/// <para>Measured from the sample's OBSERVATION instant, not from
/// <see cref="VesselOrbit.Epoch"/>. `Epoch` is the mean-anomaly reference epoch
/// and can sit far from when the sample was taken, so subtracting it would
/// answer a different question with the same units and no type could catch
/// it.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PropagationHorizon
{
    [SitrepUnit(Units.Enumeration)]
    public PropagationHorizonKind Kind { get; set; }

    /// <summary>
    /// What KIND of answer these elements are, which is the client's real
    /// question. Replaced a provider id, and the difference matters.
    ///
    /// <para>The horizon answers REACH: how far may I extrapolate. It does not
    /// answer SHAPE: is a conic the right renderer at all. A client cannot infer
    /// the second from the first, and the failure case is concrete rather than
    /// principled: an analytic provider reports
    /// <see cref="PropagationHorizonKind.Unbounded"/>, and so may an INTEGRATING
    /// provider in a low-perturbation regime, where the horizon is genuinely
    /// long. A client reasoning "unbounded, therefore analytic, therefore an
    /// ellipse is fine" then draws a closed conic for an integrated trajectory:
    /// faithful at the sample instant, wrong as a path, and confident.</para>
    ///
    /// <para>An earlier draft carried the provider's literal id instead. That
    /// answered "who computed this" where the client needed "what is this like",
    /// and it put a vendor's name in a standard payload. An enumeration answers
    /// the real question completely, and every provider can state it, stock
    /// included, which is what makes it belong on the standard shape at all.</para>
    ///
    /// <para>Diagnostics keep their own home: <c>system.uplinks</c> already
    /// carries each Uplink's id, version and availability once per session, and
    /// a version is what a bug report wants more than a name.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public TrajectoryKind TrajectoryKind { get; set; }

    /// <summary>
    /// The last UT these elements answer for. Set if and only if
    /// <see cref="Kind"/> is <see cref="PropagationHorizonKind.Until"/>; null
    /// otherwise, never a sentinel standing in for "forever".
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? UntilUt { get; set; }
}

/// <summary>
/// Deliberately THREE arms, and the ordering is the point.
///
/// <para><see cref="Unspecified"/> is 0, so a producer that forgets the horizon
/// gets the REFUSING answer rather than the permissive one. Had
/// <see cref="Unbounded"/> been the default, a provider that failed to populate
/// it would have read as "trust this conic forever", which is the most dangerous
/// available reading and would have failed silently.</para>
///
/// <para><see cref="Unbounded"/> is a CLAIM, made by a provider that genuinely
/// has no limit (an analytic two-body solver), not a default nobody made. It is
/// its own arm rather than an infinite <see cref="PropagationHorizon.UntilUt"/>
/// so that "forever" never has to be recognised as an extreme number.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum PropagationHorizonKind
{
    /// <summary>No provider stated one. Treat as unpropagatable.</summary>
    Unspecified = 0,

    /// <summary>Authoritative for all future UT: an analytic solver with no horizon.</summary>
    Unbounded = 1,

    /// <summary>Authoritative until <see cref="PropagationHorizon.UntilUt"/>.</summary>
    Until = 2,
}

/// <summary>
/// What kind of thing an element set describes: a closed-form conic, or a
/// snapshot of an integrated path.
///
/// <para><see cref="Unspecified"/> is 0 for the same reason
/// <see cref="PropagationHorizonKind.Unspecified"/> is: a producer that forgets
/// the field gets the answer that WITHHOLDS rather than the one that permits.
/// Had <see cref="Analytic"/> been zero, a provider that failed to populate it
/// would have every client treating an integrated trajectory as an ellipse.</para>
/// </summary>
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
    /// SNAPSHOT of it, true at the sample instant and never the path itself, so
    /// a client that draws a closed ellipse from it is drawing something the
    /// craft will not fly.
    /// </summary>
    Integrated = 2,
}

/// <summary>One upcoming SOI patch transition: see <see cref="VesselOrbit.Encounter"/>.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class OrbitEncounter
{
    [SitrepUnit(Units.Enumeration)]
    public TransitionType TransitionType { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double TransitionUt { get; set; }

    /// <summary>Index into <c>system.bodies</c> of the body being transitioned INTO; null if that body couldn't be resolved.</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }
}
