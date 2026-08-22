#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// A sampled path a provider computed, as points in a NAMED frame.
///
/// <para><b>Why this exists rather than a client sampling the elements.</b>
/// <see cref="VesselOrbit"/>'s elements are osculating, so sampling them gives
/// the conic the craft is tangent to at the sample instant. That is exactly the
/// trajectory for an analytic provider and is NOT one for a provider that
/// integrates: the curve it flies leaves that conic immediately, and drawing the
/// conic under an integrated label is a confident wrong answer. So an
/// integrating provider puts its real points here, and a client that has them
/// draws them instead of solving anomalies.</para>
///
/// <para><b>Three dimensions and a frame, not two in the orbital plane.</b> An
/// n-body path has no perifocal plane to be flat in, and in a rotating frame it
/// has no central body either, so a pair of in-plane coordinates cannot express
/// one. <see cref="Frame"/> is beside the points rather than assumed, because
/// the same trajectory is a different SHAPE per frame and a curve quoted without
/// its frame is a curve whose meaning is unknown.</para>
///
/// <para><b>The far end is where authority stops, never where the path ends.</b>
/// <see cref="ToUt"/> is the last instant vouched for. A client draws a visible
/// mark there: a prediction that stops short and a trajectory that ends look
/// identical on a diagram and mean opposite things.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TrajectoryArc
{
    /// <summary>Which frame <see cref="Points"/> are expressed in.</summary>
    public TrajectoryFrameRef Frame { get; set; } = new();

    /// <summary>
    /// The path, in time order, first point at <see cref="FromUt"/> and last at
    /// <see cref="ToUt"/>. Never empty: a producer with no points publishes no
    /// arc and states a refusal instead, because "a trajectory with no points in
    /// it" and "there is no trajectory" read identically on a diagram.
    /// </summary>
    public List<TrajectoryPoint> Points { get; set; } = new();

    /// <summary>The instant of the first point.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double FromUt { get; set; }

    /// <summary>The instant of the last point, and the far end the horizon mark
    /// goes on.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double ToUt { get; set; }

    /// <summary>
    /// How many points the propagation actually produced, before decimation.
    /// Equal to <c>Points.Count</c> when nothing was dropped.
    ///
    /// <para>Carried so a reader can tell a DECIMATED curve from a short one.
    /// The two look the same as a polyline and are different facts: a decimated
    /// curve resolves less than the propagation knew, and no reader may treat
    /// one of its points as an event instant. Event instants are published as
    /// their own instants for that reason, never recovered from this
    /// polyline.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int SourcePointCount { get; set; }

    /// <summary>Where the curve came from, so the mark can travel ON it.</summary>
    [SitrepUnit(Units.Enumeration)]
    public TrajectoryDerivation Derivation { get; set; }

    /// <summary>What the integration was against, when the producer integrated.
    /// Null for a closed-form curve, which has no force model to describe.</summary>
    public TrajectoryForceModel? ForceModel { get; set; }
}

/// <summary>One sampled point: where, and when.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TrajectoryPoint
{
    /// <summary>The instant this point is at. An instant, so UT: the points are
    /// events on a path rather than offsets along one, and a reader interpolating
    /// between two of them needs to know which side of a burn it is on.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    [SitrepUnit(Units.Metres)]
    public double X { get; set; }

    [SitrepUnit(Units.Metres)]
    public double Y { get; set; }

    [SitrepUnit(Units.Metres)]
    public double Z { get; set; }
}

/// <summary>
/// Which frame a set of trajectory points is expressed in, named well enough
/// that the curve can be read.
///
/// <para>Deliberately not the producing mod's own frame vocabulary. A frame is a
/// property every provider's answer has, and putting one vendor's enum on the
/// standard payload would make every other provider translate into it.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TrajectoryFrameRef
{
    [SitrepUnit(Units.Enumeration)]
    public TrajectoryFrameKind Kind { get; set; }

    /// <summary>Index into <c>system.bodies</c> of the body the frame is centred
    /// on, or null for a frame with no centre. Three of the frames a player can
    /// plot in have none, which is also why apsides do not exist in them.</summary>
    [SitrepUnit(Units.Id)]
    public int? CentreBodyIndex { get; set; }

    /// <summary>
    /// True when the frame's lengths are not lengths.
    ///
    /// <para>A pulsating frame composes a dilatation onto a rotating one, so a
    /// fractional error in the scaling radius scales every coordinate. A readout
    /// the frame invalidates says so rather than showing a number.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool LengthsPulsate { get; set; }
}

/// <summary>
/// The frames a trajectory may be published in.
///
/// <para><see cref="Unspecified"/> is 0 so a producer that forgets gets the
/// answer a client must refuse to draw, on the same terms as
/// <see cref="PropagationHorizonKind.Unspecified"/>: the wrong direction to
/// default in is the one where an unnamed frame silently reads as the frame the
/// reader happened to expect.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TrajectoryFrameKind
{
    /// <summary>No producer stated one. The points cannot be drawn.</summary>
    Unspecified = 0,

    /// <summary>
    /// The orbit's own plane, periapsis on +x, centred on the body the elements
    /// are about. What a body-centric orbit diagram already draws in, and what a
    /// conic sampled from osculating elements is expressed in.
    /// </summary>
    Perifocal = 1,

    /// <summary>
    /// Centred on <see cref="TrajectoryFrameRef.CentreBodyIndex"/>, axes fixed
    /// against the stars. The frame an integrated path is naturally computed in.
    /// </summary>
    BodyCentredInertial = 2,

    /// <summary>
    /// Centred on a body and turning with its surface. A ground track is this
    /// frame by construction.
    /// </summary>
    BodyCentredRotating = 3,
}

/// <summary>
/// Who derived a curve, and how faithfully.
///
/// <para>The mark travels ON the curve rather than beside the widget, for the
/// same reason a horizon does: a substituted answer that only says so in a panel
/// elsewhere is a substituted answer nobody reads as one.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TrajectoryDerivation
{
    /// <summary>No producer stated one.</summary>
    Unspecified = 0,

    /// <summary>The points are the n-body mod's own, read from it directly.</summary>
    Foreign = 1,

    /// <summary>
    /// Our integration, against the n-body model we read from the installed
    /// mod's own configuration.
    /// </summary>
    OwnNBody = 2,

    /// <summary>
    /// Our integration, with the force model incompletely matched: some body's
    /// parameters could not be resolved, and
    /// <see cref="TrajectoryForceModel.MissingTerm"/> says which.
    /// </summary>
    OwnNBodyDegraded = 3,

    /// <summary>A closed-form conic, ours, from the elements alone.</summary>
    OwnClosedForm = 4,
}

/// <summary>
/// What an integration was actually against, so a reader can tell how far to
/// trust the curve without being told to trust it.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TrajectoryForceModel
{
    /// <summary>True when the force model's configuration was found and parsed.
    /// False means the curve is degraded and says which term is missing.</summary>
    [SitrepUnit(Units.Flag)]
    public bool GravityModelFound { get; set; }

    /// <summary>How many perturbing bodies were summed, not counting the primary.</summary>
    [SitrepUnit(Units.Count)]
    public int PerturbingBodyCount { get; set; }

    /// <summary>The highest geopotential degree used for any body. Zero means
    /// point masses throughout, which is a statement rather than an omission:
    /// oblateness is worth about 4e-8 of a frame's angular velocity at lunar
    /// distance and is deliberately not computed.</summary>
    [SitrepUnit(Units.Count)]
    public int GeopotentialDegree { get; set; }

    /// <summary>
    /// How the perturbing bodies' FUTURE positions were obtained, and the one
    /// approximation in the whole curve.
    ///
    /// <para><c>kepler-from-snapshot</c> means each body was Kepler-propagated
    /// forward from its present state rather than read from an integrated
    /// ephemeris. The n-body mod evaluates every body from its own integrated
    /// ephemeris fitted to a millimetre; no export it offers takes a future time
    /// that we may honestly call, so this is the substitute. It is acceptable
    /// because body positions enter only through the PERTURBING terms and
    /// planetary orbits are near-Keplerian over a week. It is NOT acceptable
    /// where a third body dominates: near a libration point, during a close
    /// flyby, or anywhere else <see cref="ThirdBodyDominance"/> is large, this
    /// approximation becomes the leading error and the curve diverges
    /// qualitatively rather than numerically. That is why the dominance is
    /// published on every arc and why the horizon closes when it crosses its
    /// bound.</para>
    ///
    /// <para>Stated on every payload rather than in documentation, because a
    /// caveat a reader has to go and find is a caveat nobody meets.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? BodyEphemeris { get; set; }

    /// <summary>The largest perturbing acceleration as a fraction of the
    /// primary's, over the arc. Makes the chaotic regime visible rather than
    /// inferred.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? ThirdBodyDominance { get; set; }

    /// <summary>Which term is absent, when the model could not be fully matched.
    /// Null when nothing is missing; a degraded curve always names one.</summary>
    [SitrepUnit(Units.Text)]
    public string? MissingTerm { get; set; }

    /// <summary>The integrator's name.</summary>
    [SitrepUnit(Units.Text)]
    public string? Integrator { get; set; }

    /// <summary>The step actually used. An interval, so seconds.</summary>
    [SitrepUnit(Units.Seconds)]
    public double StepSeconds { get; set; }

    /// <summary>How many steps were taken.</summary>
    [SitrepUnit(Units.Count)]
    public int StepCount { get; set; }

    /// <summary>
    /// True when neither drag nor thrust was modelled, which is always. A
    /// reentry countdown computed in a vacuum is a vacuum countdown, and a reader
    /// that does not know that will read it as a reentry one.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Vacuum { get; set; }
}

/// <summary>
/// Why a producer that CAN integrate published no arc this sample.
///
/// <para>Separate from <see cref="PropagationHorizon"/>, which answers reach and
/// shape for the ELEMENTS. These are refusals about the ARC, and each names a
/// different remedy: a client that had to borrow the horizon's sentence for one
/// of them would tell the operator to do the wrong thing.</para>
///
/// <para><see cref="Unspecified"/> is 0 so silence is not a refusal: a producer
/// that never attempts an arc is not refusing one, and only a producer that
/// tried and stopped fills this in.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TrajectoryRefusal
{
    /// <summary>Nothing was refused. Either an arc is present or none was attempted.</summary>
    Unspecified = 0,

    /// <summary>
    /// The integration hit its step budget before reaching the requested instant.
    /// The operator can shorten the window, or wait: it may resolve on its own.
    /// </summary>
    BeyondBudget = 1,

    /// <summary>
    /// The force model's configuration was not found or could not be parsed, so
    /// there is nothing to integrate against. There is no operator remedy: it is
    /// an install problem and it says so.
    /// </summary>
    NoForceModel = 2,
}
