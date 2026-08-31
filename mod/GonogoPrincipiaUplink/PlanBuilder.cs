using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Pure mapper: a plan observation into the <c>principia.plan</c> dict, and a
    /// write result into the receipt beside it. KSP-free and side-effect-free.
    /// </summary>
    public static class PlanBuilder
    {
        public static Dictionary<string, object?> Build(PlanObservation observation)
        {
            var burns = new List<object?>();
            foreach (var burn in observation.Burns)
            {
                burns.Add(new Dictionary<string, object?>
                {
                    ["index"] = burn.Index,
                    ["ignitionUt"] = burn.IgnitionUt,
                    ["cutoffUt"] = burn.CutoffUt,
                    ["durationSeconds"] = burn.DurationSeconds,
                    ["timeToHalfDeltaVSeconds"] = burn.TimeToHalfDeltaVSeconds,
                    ["deltaV"] = PlanReader.Magnitude(
                        burn.DeltaVTangent, burn.DeltaVNormal, burn.DeltaVBinormal),
                    ["deltaVTangent"] = burn.DeltaVTangent,
                    ["deltaVNormal"] = burn.DeltaVNormal,
                    ["deltaVBinormal"] = burn.DeltaVBinormal,
                    ["coordinateSystem"] = burn.CoordinateSystem,
                    ["inertiallyFixed"] = burn.InertiallyFixed,
                    ["thrustKilonewtons"] = burn.ThrustKilonewtons,
                    ["specificImpulseSeconds"] = burn.SpecificImpulseSeconds,
                    ["initialMassTons"] = burn.InitialMassTons,
                    ["finalMassTons"] = burn.FinalMassTons,
                    ["massFlowKilogramsPerSecond"] = burn.MassFlowKilogramsPerSecond,
                    ["frameType"] = burn.FrameType,
                    ["centreBody"] = burn.Frame?.CentreBody,
                    ["primaryBody"] = burn.Frame?.PrimaryBody,
                    ["secondaryBody"] = burn.Frame?.SecondaryBody,
                    ["primaryBodies"] = BodySet(burn.Frame?.PrimaryBodies),
                    ["secondaryBodies"] = BodySet(burn.Frame?.SecondaryBodies),
                    ["frameEditable"] = burn.FrameEditable,
                    ["executing"] = burn.Executing,
                    ["anomalous"] = burn.Anomalous,
                });
            }

            return new Dictionary<string, object?>
            {
                ["vesselId"] = observation.VesselId,
                ["sampledAtUt"] = observation.SampledAtUt,
                ["planExists"] = observation.PlanExists,
                ["writeSurface"] = new Dictionary<string, object?>
                {
                    ["available"] = observation.WriteSurfaceAvailable,
                    ["armed"] = observation.WriteSurfaceArmed,
                    ["reason"] = observation.WriteSurfaceReason,
                    ["analysedVersion"] = observation.WriteAnalysedVersion,
                    ["detectedVersion"] = observation.WriteDetectedVersion,
                },
                ["planCount"] = observation.PlanCount,
                ["selectedPlan"] = observation.SelectedPlan,
                ["initialTimeUt"] = observation.InitialTimeUt,
                ["desiredFinalTimeUt"] = observation.DesiredFinalTimeUt,
                ["actualFinalTimeUt"] = observation.ActualFinalTimeUt,
                ["anomalousBurnCount"] = observation.AnomalousBurnCount,
                ["planIntegrated"] = observation.PlanIntegrated,
                ["statusError"] = observation.StatusError,
                ["statusMessage"] = observation.StatusMessage,
                ["reachedDeadline"] = observation.ReachedDeadline,
                ["firstFutureBurnIndex"] = observation.FirstFutureBurnIndex,
                ["optimisationRunning"] = observation.OptimisationRunning,
                ["integrator"] = new Dictionary<string, object?>
                {
                    ["maxSteps"] = observation.MaxSteps,
                    ["lengthToleranceMetres"] = observation.LengthToleranceMetres,
                    ["speedToleranceMetresPerSecond"] = observation.SpeedToleranceMetresPerSecond,
                    ["integratorKind"] = observation.IntegratorKind,
                    ["generalizedIntegratorKind"] = observation.GeneralizedIntegratorKind,
                },
                ["burns"] = burns,
            };
        }

        /// <summary>One side of a frame's pair, or null when the head is the whole
        /// of it. The reading empties the list in that case, and an empty array on
        /// the wire would read as a side with no bodies in it.</summary>
        private static object? BodySet(List<string>? bodies) =>
            bodies == null || bodies.Count == 0 ? null : bodies.ToArray();

        /// <summary>
        /// The receipt for one attempted write.
        ///
        /// <para><paramref name="plan"/> is the reading taken AFTER the write, in
        /// the same frame, and it is null exactly when nothing was attempted. That
        /// pairing is what makes the receipt falsifiable: a client can see that the
        /// burn count changed, or that the plan's end instant moved without being
        /// asked to, rather than taking our word that the edit did what it said.</para>
        /// </summary>
        public static Dictionary<string, object?> BuildReceipt(
            string? requestId,
            PrincipiaWriteResult result,
            PlanObservation? plan,
            bool replayed = false) =>
            new Dictionary<string, object?>
            {
                ["requestId"] = requestId,
                ["replayed"] = replayed,
                ["outcome"] = (int)result.Outcome,
                ["refusal"] = (int)result.Refusal,
                ["refusalDetail"] = result.Detail,
                ["statusError"] = result.StatusError,
                ["statusMessage"] = result.StatusMessage,
                ["plan"] = plan == null ? null : Build(plan),
            };
    }
}
