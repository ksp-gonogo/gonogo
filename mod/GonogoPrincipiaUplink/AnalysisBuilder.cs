using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Pure mapper: an analysis observation into the <c>principia.analysis</c>
    /// dict. KSP-free and side-effect-free.
    /// </summary>
    public static class AnalysisBuilder
    {
        public static Dictionary<string, object?> Build(AnalysisObservation observation)
        {
            var coasts = new List<object?>();
            foreach (var coast in observation.Coasts)
            {
                coasts.Add(new Dictionary<string, object?>
                {
                    ["index"] = coast.Index,
                    ["startsAtUt"] = coast.StartsAtUt,
                    ["endsAtUt"] = coast.EndsAtUt,
                    ["analysis"] = Analysis(coast.Analysis),
                });
            }

            return new Dictionary<string, object?>
            {
                ["vesselId"] = observation.VesselId,
                ["sampledAtUt"] = observation.SampledAtUt,
                ["orbit"] = Analysis(observation.Orbit),
                ["coasts"] = coasts,
            };
        }

        /// <summary>
        /// One analysis, or null when there was none.
        ///
        /// <para>Null travels as null rather than as an empty dict, because a
        /// payload of absent fields and no analysis at all read identically at the
        /// widget and only one of them means "the producer is not analysing this
        /// craft".</para>
        /// </summary>
        private static Dictionary<string, object?>? Analysis(OrbitAnalysisObservation? analysis)
        {
            if (analysis == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["missionDurationSeconds"] = analysis.MissionDurationSeconds,
                ["progressOfNextAnalysis"] = analysis.ProgressOfNextAnalysis,
                ["primaryIndex"] = analysis.PrimaryIndex,
                ["primaryBody"] = analysis.PrimaryBody,
                ["gravitationallyBound"] = analysis.GravitationallyBound,
                ["elementsPresent"] = analysis.ElementsPresent,
                ["elementsEpochUt"] = analysis.ElementsEpochUt,
                ["siderealPeriodSeconds"] = analysis.SiderealPeriodSeconds,
                ["nodalPeriodSeconds"] = analysis.NodalPeriodSeconds,
                ["anomalisticPeriodSeconds"] = analysis.AnomalisticPeriodSeconds,
                ["nodalPrecessionDegreesPerHour"] = analysis.NodalPrecessionDegreesPerHour,
                ["meanSemimajorAxisMetres"] = Interval(analysis.MeanSemimajorAxisMetres),
                ["meanEccentricity"] = Interval(analysis.MeanEccentricity),
                ["meanInclinationDegrees"] = Interval(analysis.MeanInclinationDegrees),
                ["recurrenceCycleRotations"] = analysis.RecurrenceCycleRotations,
                ["recurrenceRevolutions"] = analysis.RecurrenceRevolutions,
                ["recurrenceRevolutionsPerRotation"] = analysis.RecurrenceRevolutionsPerRotation,
                ["recurrenceSubcycleRotations"] = analysis.RecurrenceSubcycleRotations,
                ["recurrenceEquatorialShiftDegrees"] = analysis.RecurrenceEquatorialShiftDegrees,
                ["recurrenceGridIntervalDegrees"] = analysis.RecurrenceGridIntervalDegrees,
                ["ascendingCrossingDegrees"] = Interval(analysis.AscendingCrossingDegrees),
                ["descendingCrossingDegrees"] = Interval(analysis.DescendingCrossingDegrees),
                ["meanLongitudeOfAscendingNodeDegrees"] =
                    Interval(analysis.MeanLongitudeOfAscendingNodeDegrees),
                ["meanArgumentOfPeriapsisDegrees"] =
                    Interval(analysis.MeanArgumentOfPeriapsisDegrees),
                ["meanPeriapsisAltitudeMetres"] = Interval(analysis.MeanPeriapsisAltitudeMetres),
                ["meanApoapsisAltitudeMetres"] = Interval(analysis.MeanApoapsisAltitudeMetres),
                ["lowestAltitudeMetres"] = analysis.LowestAltitudeMetres,
                ["firstCollisionUt"] = analysis.FirstCollisionUt,
                ["firstCollisionRiskUt"] = analysis.FirstCollisionRiskUt,
                ["firstReentryUt"] = analysis.FirstReentryUt,
            };
        }

        private static Dictionary<string, object?>? Interval(IntervalObservation? interval) =>
            interval == null
                ? null
                : new Dictionary<string, object?>
                {
                    ["min"] = interval.Min,
                    ["max"] = interval.Max,
                };
    }
}
