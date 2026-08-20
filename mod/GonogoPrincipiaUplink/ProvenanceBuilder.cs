using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Pure mapper: a provenance observation into the <c>principia.provenance</c>
    /// dict. KSP-free and side-effect-free, so it is unit-tested headless.
    ///
    /// <para>The only judgement it makes is to leave the four prediction fields
    /// entirely absent when there is no prediction observation, rather than
    /// emitting nulls inside a present record. Both read as "unknown" on the wire,
    /// but keeping the shape empty means a future reader cannot mistake a
    /// half-filled record for a partial reading.</para>
    /// </summary>
    public static class ProvenanceBuilder
    {
        public static Dictionary<string, object?> Build(ProvenanceObservation observation)
        {
            var prediction = observation.Prediction;
            return new Dictionary<string, object?>
            {
                ["displayPatchedConics"] = observation.DisplayPatchedConics,
                ["historyLengthSeconds"] = observation.HistoryLengthSeconds,
                ["framesHidingUnpinnedMarkers"] = observation.FramesHidingUnpinnedMarkers,
                ["framesHidingUnpinnedCelestials"] = observation.FramesHidingUnpinnedCelestials,
                ["plottingFrameType"] = observation.PlottingFrameType,
                ["plottingFrameCentreBody"] = observation.PlottingFrameCentreBody,
                ["targetFrameSelected"] = observation.TargetFrameSelected,
                ["predictionToleranceMetres"] = prediction?.ToleranceMetres,
                ["predictionMaxSteps"] = prediction?.MaxSteps,
                ["predictionObservedAtUt"] = prediction?.ObservedAtUt,
                ["predictionVesselId"] = prediction?.VesselId,
            };
        }
    }
}
