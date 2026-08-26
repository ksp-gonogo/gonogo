using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Pure mapper: a settings observation into the <c>principia.settings</c> dict.
    /// KSP-free and side-effect-free, so it is unit-tested headless.
    ///
    /// <para>It makes two judgements and no others. A suspended reading carries the
    /// outage and nothing else, rather than the outage next to whatever the last
    /// tick happened to hold: a stale tolerance beside "we have stopped reading" is
    /// the half-true payload the journal rule exists to avoid. And an empty
    /// collection is published as absent rather than as an empty array, because
    /// "this vessel's plan has no burns" and "we did not read the plan" are
    /// different claims and only one of them is ours to make.</para>
    /// </summary>
    public static class SettingsBuilder
    {
        public static Dictionary<string, object?> Build(SettingsObservation observation)
        {
            var payload = new Dictionary<string, object?>
            {
                ["observedAtUt"] = observation.SampledAtUt,
                ["pluginVersion"] = observation.PluginVersion,
                ["readingSuspended"] = observation.ReadingSuspended,
                ["readingSuspendedReason"] = observation.ReadingSuspendedReason,
            };
            if (observation.ReadingSuspended)
            {
                return payload;
            }

            payload["plottingFrame"] = Frame(observation.PlottingFrame);
            payload["burnFrames"] = Frames(observation.BurnFrames);
            payload["selectingTargetVessel"] = observation.SelectingTargetVessel;
            payload["targetVesselId"] = observation.TargetVesselId;
            payload["targetVesselName"] = observation.TargetVesselName;
            payload["selectingTargetCelestial"] = observation.SelectingTargetCelestial;
            payload["targetCelestialBody"] = observation.TargetCelestialBody;
            payload["displayPatchedConics"] = observation.DisplayPatchedConics;

            payload["analysisMissionDurationRequestedSeconds"] =
                observation.AnalysisMissionDurationRequestedSeconds;
            payload["recurrenceAutodetect"] = observation.RecurrenceAutodetect;
            payload["recurrenceRevolutionsPerCycle"] = observation.RecurrenceRevolutionsPerCycle;
            payload["recurrenceDaysPerCycle"] = observation.RecurrenceDaysPerCycle;
            payload["groundTrackRevolution"] = observation.GroundTrackRevolution;

            payload["predictionVesselId"] = observation.PredictionVesselId;
            payload["predictionToleranceMetres"] = observation.PredictionToleranceMetres;
            payload["predictionMaxSteps"] = observation.PredictionMaxSteps;
            payload["planToleranceMetres"] = observation.PlanToleranceMetres;
            payload["planMaxSteps"] = observation.PlanMaxSteps;
            payload["planInitialTimeUt"] = observation.PlanInitialTimeUt;
            payload["planDesiredFinalTimeUt"] = observation.PlanDesiredFinalTimeUt;
            payload["planActualFinalTimeUt"] = observation.PlanActualFinalTimeUt;
            payload["flightPlanCount"] = observation.FlightPlanCount;
            payload["selectedFlightPlan"] = observation.SelectedFlightPlan;
            payload["optimiserTargetAltitudeMetres"] = observation.OptimiserTargetAltitudeMetres;
            payload["optimiserTargetInclinationDegrees"] =
                observation.OptimiserTargetInclinationDegrees;

            payload["historyLengthSeconds"] = observation.HistoryLengthSeconds;
            payload["unpinnedMarkersHiddenHere"] = observation.UnpinnedMarkersHiddenHere;
            payload["framesHidingUnpinnedMarkers"] = observation.FramesHidingUnpinnedMarkers;
            payload["unpinnedCelestialsHiddenHere"] = observation.UnpinnedCelestialsHiddenHere;
            payload["framesHidingUnpinnedCelestials"] = observation.FramesHidingUnpinnedCelestials;
            payload["pinnedCelestials"] =
                observation.PinnedCelestials.Count == 0
                    ? null
                    : observation.PinnedCelestials.ToArray();
            payload["targetPinned"] = observation.TargetPinned;
            payload["showManoeuvreOnNavball"] = observation.ShowManoeuvreOnNavball;
            payload["stabilityGridMaxEccentricityMinInclination"] =
                observation.StabilityGridMaxEccentricityMinInclination;
            payload["stabilityGridMinEccentricityMaxInclination"] =
                observation.StabilityGridMinEccentricityMaxInclination;
            payload["showElementGraphs"] = observation.ShowElementGraphs;

            payload["verboseLevel"] = observation.VerboseLevel;
            payload["logThreshold"] = observation.LogThreshold;
            payload["stderrThreshold"] = observation.StderrThreshold;
            payload["flushThreshold"] = observation.FlushThreshold;
            payload["recordJournalRequested"] = observation.RecordJournalRequested;
            payload["journaling"] = observation.Journaling;
            return payload;
        }

        private static object? Frames(List<FrameObservation> frames)
        {
            if (frames.Count == 0)
            {
                return null;
            }
            var built = new Dictionary<string, object?>[frames.Count];
            for (var i = 0; i < frames.Count; i++)
            {
                built[i] = Frame(frames[i])!;
            }
            return built;
        }

        private static Dictionary<string, object?>? Frame(FrameObservation? frame) =>
            frame == null
                ? null
                : new Dictionary<string, object?>
                {
                    ["selector"] = frame.Selector,
                    ["type"] = frame.Type,
                    ["centreBody"] = frame.CentreBody,
                    ["primaryBody"] = frame.PrimaryBody,
                    ["secondaryBody"] = frame.SecondaryBody,
                    ["primaryBodies"] = Side(frame.PrimaryBodies),
                    ["secondaryBodies"] = Side(frame.SecondaryBodies),
                    ["targetFrameSelected"] = frame.TargetFrameSelected,
                    ["targetVesselId"] = frame.TargetVesselId,
                    ["targetVesselName"] = frame.TargetVesselName,
                    ["targetPrimaryBody"] = frame.TargetPrimaryBody,
                };

        /// <summary>One side's bodies, or null when the side is the single body the
        /// singular field already carries. Null rather than an empty array so a
        /// reader that finds a list knows it is being told something the pair
        /// cannot say.</summary>
        private static string[]? Side(List<string> bodies) =>
            bodies.Count == 0 ? null : bodies.ToArray();
    }
}
