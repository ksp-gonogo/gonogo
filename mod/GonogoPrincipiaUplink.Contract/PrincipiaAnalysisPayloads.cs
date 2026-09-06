#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoPrincipiaUplink;

/// <summary>
/// The <c>principia.analysis</c> channel: the producer's own n-body orbit
/// analysis, for the vessel now and for each coast of its flight plan.
///
/// <para><b>Why this is not derived from the elements the rest of the stream
/// carries.</b> These are MEAN elements: a boxcar filter over one sidereal
/// period applied to the equinoctial set, taken from a fixed-step n-body
/// integration in the primary-centred frame, with the primary chosen as the body
/// of smallest osculating period rather than the sphere-of-influence parent.
/// Nothing outside the producer computes that, and two numbers a few centimetres
/// apart on the same screen both labelled "mean semi-major axis" and disagreeing
/// is the failure this channel exists to avoid.</para>
///
/// <para><b>Absence is a first-class state here, and a common one.</b> Four of
/// the analysis's own seven fields are nullable, and the vessel analysis exists
/// only while the producer is running one. <see cref="PrincipiaOrbitAnalysis"/>
/// carries the distinction rather than substituting zeros.</para>
///
/// <para><c>DelayRole.Delayed</c>: a per-vessel telemetry fact about a craft,
/// subject to the reveal-gate like the plan channels beside it.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("principia.analysis")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaAnalysis
{
    /// <summary>The vessel every analysis below belongs to.</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>When the plugin was asked.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? SampledAtUt { get; set; }

    /// <summary>
    /// The vessel's own current-orbit analysis, or null when it holds none.
    ///
    /// <para>Null is the ordinary state, not a fault: the producer starts one
    /// only while its own main window is drawn, and destroys it outright when
    /// asked to analyse a different vessel. Reading it neither starts nor
    /// interrupts anything.</para>
    /// </summary>
    public PrincipiaOrbitAnalysis? Orbit { get; set; }

    /// <summary>
    /// One entry per coast of the selected flight plan, in plan order, burns
    /// excluded.
    ///
    /// <para>These need no request at all: the producer asks for a coast
    /// analysis inside every flight-plan recompute, and a plan carried in from a
    /// save is recomputed the first time anything opens it. So a coast analysis
    /// exists for a vessel whose flight planner the player has never
    /// opened.</para>
    /// </summary>
    public PrincipiaCoastAnalysis[]? Coasts { get; set; }
}

/// <summary>
/// One coast of the flight plan, and what orbit it puts the craft in.
///
/// <para>The coast before burn <c>n</c> carries index <c>n</c>; the last entry
/// is the coast after the final burn and is the orbit the plan ENDS in, which is
/// the one an operator is usually asking about.</para>
/// </summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaCoastAnalysis
{
    /// <summary>Position in the plan, from zero.</summary>
    [SitrepUnit(Units.Count)]
    public int? Index { get; set; }

    /// <summary>When the coast begins: the plan's own start for the first, the
    /// previous burn's cutoff for the rest. This is also the instant the coast's
    /// elements are measured from.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? StartsAtUt { get; set; }

    /// <summary>When the coast ends: the next burn's ignition, or the plan's
    /// final time for the last coast.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? EndsAtUt { get; set; }

    /// <summary>The analysis of this coast, or null when the producer had none:
    /// a coast following a burn it could not integrate has no valid initial
    /// state to analyse from.</summary>
    public PrincipiaOrbitAnalysis? Analysis { get; set; }
}

/// <summary>
/// One orbit analysis: the mean elements, the three periods, the precession of
/// the node, and the hazards found over the analysed span.
///
/// <para><b>Every element is a band, and flattening one is a fidelity loss.</b>
/// A mean element over an analysis window is a range with a midpoint, and the
/// width is the number that says whether the orbit is stable. The adjectives the
/// producer builds its orbit description from read the band ENDS, not the
/// midpoint: circular is <c>eccentricity.max &lt; 0.01</c>, not a midpoint
/// test.</para>
///
/// <para><b>The ground-track recurrence and the equatorial crossings are here,
/// and were always available.</b> This doc used to say the opposite: that asking
/// for them meant handing the producer a recurrence hypothesis and satisfying
/// seven checks "whose arithmetic this Uplink has not solved". The producer fits
/// a recurrence itself during the analysis and falls back to it when no
/// hypothesis is given, deriving the crossings on the way, so the only thing a
/// hypothesis buys is an operator's nominal orbit to compare against.</para>
///
/// <para><b>The solar times of the nodes are here too, as ANGLES.</b> They were
/// held back on the grounds that an angle with π at noon is a time of day rather
/// than a duration and this contract has no unit that says so. True, and beside
/// the point: what the reading is FOR is sun-synchronicity, which is decided by
/// how little the band widens. A drift in degrees answers that exactly, the same
/// way the crossings do. Rendering the position as a clock is a separate job
/// needing a unit nothing here has yet.</para>
/// </summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaOrbitAnalysis
{
    /// <summary>
    /// The span the analysis covers, and the qualifier every band below needs.
    ///
    /// <para>A band quoted without it is meaningless: widening the window widens
    /// every interval and can flip every adjective in the description.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? MissionDurationSeconds { get; set; }

    /// <summary>How far along the NEXT analysis is, from zero to one. Not the age
    /// of this one.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? ProgressOfNextAnalysis { get; set; }

    /// <summary>
    /// The body the elements are measured against, as the producer's own
    /// celestial index, or null when the craft is bound to nothing over this
    /// span.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? PrimaryIndex { get; set; }

    /// <summary>
    /// The primary's name, when the game's body table could answer for the
    /// index.
    ///
    /// <para>Resolved here rather than at a readout because the index is the
    /// PRODUCER's, and only the game the producer is running in can turn one into
    /// a body. It is also half the orbit description: "circular Kerbin orbit"
    /// needs the body as much as it needs the eccentricity.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? PrimaryBody { get; set; }

    /// <summary>
    /// True when a primary was found, false when the trajectory is unbound over
    /// the analysed span. The n-body answer to a question the stock conic
    /// widgets answer from a two-body eccentricity.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? GravitationallyBound { get; set; }

    /// <summary>
    /// True when the elements below were determined at all.
    ///
    /// <para>False is its own state and not an error: the interesting cause is a
    /// trajectory that does not span one sidereal period, which no amount of
    /// waiting on this end fixes.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? ElementsPresent { get; set; }

    /// <summary>
    /// The instant the elements are measured FROM: the start of the span the
    /// analysis integrated, on the same clock as every other instant here.
    ///
    /// <para>A coast's analysis is anchored at the coast's own start. The
    /// vessel's current-orbit analysis is anchored wherever the craft's history
    /// happened to have reached when the producer last ran one, which is what
    /// makes this the field that says how OLD the elements are. Both are the
    /// same quantity and a client can treat them alike.</para>
    ///
    /// <para>Null means the epoch could not be established, which is a different
    /// statement from "these are current" and must not be rendered as the second.
    /// Mean elements look exactly as confident an hour old, and the producer keeps
    /// its last completed analysis indefinitely once its own window shuts.</para>
    /// <internal>
    /// Recovered rather than read for the vessel's analysis, because nothing on
    /// the producer's struct carries it. Its own averaging makes the recovery an
    /// identity rather than an estimate: a mean element at t is a boxcar over
    /// t ± half a sidereal period, so the series starts at exactly
    /// t_min + period/2 and the anchor is the first sample less half a period.
    /// GonogoPrincipiaUplink.AnalysisReader.MeanElementsEpoch does it.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ElementsEpochUt { get; set; }

    /// <summary>The period of the mean longitude.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? SiderealPeriodSeconds { get; set; }

    /// <summary>Time between successive ascending nodes. Not the sidereal
    /// period, and the difference is the precession below.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? NodalPeriodSeconds { get; set; }

    /// <summary>Time between successive periapsides.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? AnomalisticPeriodSeconds { get; set; }

    /// <summary>
    /// The rate the ascending node drifts, in degrees per hour.
    ///
    /// <para>Unavoidable on an oblate body except for a strictly polar orbit, it
    /// is what makes the three periods differ, and it is the whole reason
    /// sun-synchronous orbits exist. Converted from the producer's radians per
    /// second here rather than at a readout, so every screen reads the same
    /// number. Per hour rather than the per day the producer's own window
    /// prints, because a day is not a fixed quantity in this game and an hour
    /// is.</para>
    /// </summary>
    [SitrepUnit(GonogoPrincipiaUplink.Contract.Units.DegreesPerHour)]
    public double? NodalPrecessionDegreesPerHour { get; set; }

    /// <summary>Size of the orbit, and how much it wanders.</summary>
    public PrincipiaLengthInterval? MeanSemimajorAxisMetres { get; set; }

    /// <summary>Shape and its variation. Drives the circular and
    /// highly-elliptical adjectives, from opposite ends of the band.</summary>
    public PrincipiaRatioInterval? MeanEccentricity { get; set; }

    /// <summary>Tilt against the primary's equator, and its variation.</summary>
    public PrincipiaAngleInterval? MeanInclinationDegrees { get; set; }

    /// <summary>
    /// How many turns of the PRIMARY the ground track takes to repeat, Capderou's
    /// Cᴛₒ.
    ///
    /// <para>Rotations rather than days: the producer counts the primary's own
    /// days, and a "day" is six hours or twenty-four under stock depending on a
    /// setting, and something else again under a planet pack.</para>
    ///
    /// <para>Absent when no repeating track could be fitted, which is the honest
    /// answer for an escape trajectory. Never zero, which would read as a very
    /// fast repeat rather than as no repeat.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? RecurrenceCycleRotations { get; set; }

    /// <summary>How many revolutions the craft makes in one whole cycle.</summary>
    [SitrepUnit(Units.Count)]
    public int? RecurrenceRevolutions { get; set; }

    /// <summary>
    /// Revolutions per single turn of the primary, Capderou's νₒ.
    ///
    /// <para>The number that names the orbit: one is synchronous, two is
    /// semi-synchronous. Carried rather than re-derived from the revolutions and
    /// the cycle, because that derivation is a rounding and a client that rounds
    /// differently renames the orbit.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? RecurrenceRevolutionsPerRotation { get; set; }

    /// <summary>The shorter run after which the track very nearly repeats, in
    /// turns of the primary. What an operator plans revisits around.</summary>
    [SitrepUnit(Units.Count)]
    public int? RecurrenceSubcycleRotations { get; set; }

    /// <summary>How far the track walks along the equator each revolution.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? RecurrenceEquatorialShiftDegrees { get; set; }

    /// <summary>
    /// Where the craft crosses the equator northbound, as a band of longitudes
    /// over the analysed span.
    ///
    /// <para>Read the WIDTH rather than the position. A band that barely widens
    /// is a track that repeats over the same ground, which is what decides
    /// whether an orbit may be called synchronous at all.</para>
    /// </summary>
    public PrincipiaAngleInterval? AscendingCrossingDegrees { get; set; }

    /// <summary>The same band for the southbound crossing.</summary>
    public PrincipiaAngleInterval? DescendingCrossingDegrees { get; set; }

    /// <summary>
    /// The local mean solar time at the northbound node, as a band of angles over
    /// a full turn, where 180 degrees is local noon.
    ///
    /// <para>An angle rather than a clock reading, which is both what the producer
    /// stores and what the question needs: sun-synchronicity is decided by how
    /// little this band WIDENS, not by where it sits. Rendering it as a time of day
    /// is a client's job and needs a unit this contract does not have.</para>
    ///
    /// <para>Absent unless the producer had a mean sun to measure against, which
    /// is the ordinary state for a body with no modelled star.</para>
    /// </summary>
    public PrincipiaAngleInterval? AscendingNodeSolarTimeDegrees { get; set; }

    /// <summary>The same band at the southbound node.</summary>
    public PrincipiaAngleInterval? DescendingNodeSolarTimeDegrees { get; set; }

    /// <summary>The spacing of the fully-populated longitude grid the whole cycle
    /// lays down.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? RecurrenceGridIntervalDegrees { get; set; }

    /// <summary>Where the orbit plane cuts the reference plane, and how far it
    /// swings.</summary>
    public PrincipiaAngleInterval? MeanLongitudeOfAscendingNodeDegrees { get; set; }

    /// <summary>Where periapsis sits within the plane. A band whose width is the
    /// apsidal drift over the window.</summary>
    public PrincipiaAngleInterval? MeanArgumentOfPeriapsisDegrees { get; set; }

    /// <summary>Low point above the surface, as a range. Altitude, not distance:
    /// the primary's radius is already taken off.</summary>
    public PrincipiaLengthInterval? MeanPeriapsisAltitudeMetres { get; set; }

    /// <summary>High point above the surface, as a range.</summary>
    public PrincipiaLengthInterval? MeanApoapsisAltitudeMetres { get; set; }

    /// <summary>
    /// The closest the craft comes to the surface over the whole window, as an
    /// altitude.
    ///
    /// <para>A safety number and a different claim from the mean periapsis
    /// altitude: this is the extreme of the actual integrated trajectory, where
    /// the periapsis band is an average over a filtered one.</para>
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? LowestAltitudeMetres { get; set; }

    /// <summary>When the trajectory hits the primary, or null for no impact over
    /// the window.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? FirstCollisionUt { get; set; }

    /// <summary>When it comes close enough to the primary to be at risk.
    /// Deliberately distinct from a certain collision.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? FirstCollisionRiskUt { get; set; }

    /// <summary>
    /// When it first enters the primary's atmosphere.
    ///
    /// <para>A vacuum figure: neither the producer nor this Uplink models drag,
    /// so it says when the craft first arrives at the atmosphere and nothing
    /// about what happens next.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? FirstReentryUt { get; set; }
}

/// <summary>
/// A closed interval in metres.
///
/// <para><b>Why three interval types rather than one.</b> A unit travels with a
/// TYPE on this wire, not with the field that holds it, so a single shared
/// interval could carry only one unit for every band that used it. Sharing one
/// would land a semi-major axis and an eccentricity in the same renderer with the
/// same symbol, and a dimensionless number printed in metres is a wrong number
/// rather than an ugly one.</para>
///
/// <para>Kept as the two ENDS rather than a midpoint and a half-width, because
/// the ends are what the producer's own adjective tests read: a midpoint is a
/// derivation a client can make, and an end is not one it can recover.</para>
/// </summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaLengthInterval
{
    [SitrepUnit(Units.Metres)]
    public double? Min { get; set; }

    [SitrepUnit(Units.Metres)]
    public double? Max { get; set; }
}

/// <summary>A closed interval in degrees. See
/// <see cref="PrincipiaLengthInterval"/> for why the unit is in the type.</summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaAngleInterval
{
    [SitrepUnit(Units.Degrees)]
    public double? Min { get; set; }

    [SitrepUnit(Units.Degrees)]
    public double? Max { get; set; }
}

/// <summary>A closed interval of a dimensionless quantity. See
/// <see cref="PrincipiaLengthInterval"/> for why the unit is in the type.</summary>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaRatioInterval
{
    [SitrepUnit(Units.Dimensionless)]
    public double? Min { get; set; }

    [SitrepUnit(Units.Dimensionless)]
    public double? Max { get; set; }
}
