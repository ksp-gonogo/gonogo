using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The producer's own orbit analyses for one vessel, as read this tick.
    ///
    /// <para>KSP-free and Harmony-free like every observation type here, so the
    /// mapping and the publish decisions are provable headless.</para>
    /// </summary>
    public sealed class AnalysisObservation
    {
        public string? VesselId;
        public double SampledAtUt;

        /// <summary>The vessel's own current-orbit analysis, or null when it holds
        /// none. Null is the ordinary state and not a fault.</summary>
        public OrbitAnalysisObservation? Orbit;

        /// <summary>One entry per coast of the selected plan, in plan order.</summary>
        public List<CoastAnalysisObservation> Coasts = new List<CoastAnalysisObservation>();
    }

    /// <summary>One coast of the plan and the orbit it leaves the craft in.</summary>
    public sealed class CoastAnalysisObservation
    {
        public int Index;

        /// <summary>The instant the coast begins, which is also the instant its
        /// elements are measured from.</summary>
        public double? StartsAtUt;

        public double? EndsAtUt;

        /// <summary>Null when the producer had no analysis for this coast, which is
        /// what a coast following an unintegrable burn gets.</summary>
        public OrbitAnalysisObservation? Analysis;
    }

    /// <summary>
    /// One analysis, flattened out of the producer's nested structs.
    ///
    /// <para>Every field is nullable and none is defaulted, because four of the
    /// analysis's own seven fields are nullable and absence is a state the
    /// operator has to be able to see. A zero here would be a claim.</para>
    /// </summary>
    public sealed class OrbitAnalysisObservation
    {
        public double? MissionDurationSeconds;
        public double? ProgressOfNextAnalysis;

        /// <summary>The producer's celestial index for the primary, or null when
        /// the craft is bound to nothing over the analysed span.</summary>
        public int? PrimaryIndex;

        /// <summary>The primary's name, when the game's body table could answer
        /// for the index.</summary>
        public string? PrimaryBody;

        /// <summary>
        /// True when a primary was found, false when the trajectory is unbound.
        ///
        /// <para>Left null when the analysis struct did not read as the shape this
        /// Uplink was written against, so a renamed field publishes as "we cannot
        /// say" rather than as "this craft is escaping".</para>
        /// </summary>
        public bool? GravitationallyBound;

        public bool? ElementsPresent;

        /// <summary>The instant the elements are measured from, or null when it is
        /// not knowable. Known for a coast, never for the vessel's own
        /// analysis.</summary>
        public double? ElementsEpochUt;

        public double? SiderealPeriodSeconds;
        public double? NodalPeriodSeconds;
        public double? AnomalisticPeriodSeconds;
        public double? NodalPrecessionDegreesPerHour;

        public IntervalObservation? MeanSemimajorAxisMetres;
        public IntervalObservation? MeanEccentricity;
        public IntervalObservation? MeanInclinationDegrees;
        public IntervalObservation? MeanLongitudeOfAscendingNodeDegrees;
        public IntervalObservation? MeanArgumentOfPeriapsisDegrees;
        public IntervalObservation? MeanPeriapsisAltitudeMetres;
        public IntervalObservation? MeanApoapsisAltitudeMetres;

        public double? LowestAltitudeMetres;
        public double? FirstCollisionUt;
        public double? FirstCollisionRiskUt;
        public double? FirstReentryUt;
    }

    /// <summary>A closed interval, with either end absent when it could not be
    /// read.</summary>
    public sealed class IntervalObservation
    {
        public double? Min;
        public double? Max;
    }
}
