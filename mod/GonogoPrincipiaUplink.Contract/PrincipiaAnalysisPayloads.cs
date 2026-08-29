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
/// <para><b>What is deliberately absent.</b> There is no ground-track
/// recurrence, no equatorial-crossing longitudes and no solar times of nodes.
/// Asking for them means handing the producer a recurrence hypothesis, which
/// makes it construct an orbit recurrence behind seven checks whose arithmetic
/// this Uplink has not solved; passing nothing forfeits those three and removes
/// all seven. That is the trade, and it costs three rows rather than the
/// analysis.</para>
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
    /// The instant the elements are measured FROM, or null when it is not
    /// knowable.
    ///
    /// <para>Known for a coast, whose analysis is anchored at the coast's own
    /// start. Not known for the vessel's current-orbit analysis: that one is
    /// anchored wherever the craft's history happened to end when the producer
    /// last requested it, and the producer publishes no instant for it. Null
    /// therefore means "we cannot date these", which is a different statement
    /// from "these are current", and a client must not render it as the
    /// second.</para>
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

    /// <summary>The shorter run after which the track very nearly repeats, in
    /// turns of the primary. What an operator plans revisits around.</summary>
    [SitrepUnit(Units.Count)]
    public int? RecurrenceSubcycleRotations { get; set; }

    /// <summary>How far the track walks along the equator each revolution.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? RecurrenceEquatorialShiftDegrees { get; set; }

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
