using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Pure mapper: an observation into the <c>principia.flightPlan</c> dict.
    /// KSP-free and side-effect-free, so it is unit-tested headless.
    ///
    /// <para>It resolves exactly one thing the observation leaves raw: WHICH burns
    /// are anomalous. The integrator reports a count, and its own rule is that the
    /// flagged burns are the last n of the list. Applying that here means no client
    /// has to know it, and a client that guessed differently could not silently
    /// disagree with the integrator about which burn is broken.</para>
    /// </summary>
    public static class FlightPlanBuilder
    {
        /// <summary>
        /// Whether the burn at <paramref name="index"/> is one of the
        /// <paramref name="anomalousCount"/> the integrator flagged, given a plan of
        /// <paramref name="burnCount"/> burns.
        ///
        /// <para>The rule is read off the integrator's own call site, which passes
        /// <c>index &gt;= count - n</c> as its anomalous flag. A negative or
        /// oversized count is clamped rather than trusted: it arrives from a
        /// reflected field, and an out-of-range value should narrow to "flag
        /// nothing" or "flag everything" instead of throwing inside a render
        /// postfix.</para>
        /// </summary>
        public static bool IsAnomalous(int index, int burnCount, int anomalousCount)
        {
            if (anomalousCount <= 0)
            {
                return false;
            }
            if (anomalousCount >= burnCount)
            {
                return true;
            }
            return index >= burnCount - anomalousCount;
        }

        public static Dictionary<string, object?> Build(FlightPlanObservation observation)
        {
            var burns = new List<object?>();
            var count = observation.Burns.Count;
            for (var i = 0; i < count; i++)
            {
                var burn = observation.Burns[i];
                burns.Add(new Dictionary<string, object?>
                {
                    ["index"] = burn.Index,
                    ["ignitionUt"] = burn.IgnitionUt,
                    ["cutoffUt"] = burn.CutoffUt,
                    ["durationSeconds"] = burn.DurationSeconds,
                    ["deltaV"] = burn.DeltaV,
                    ["thrustKilonewtons"] = burn.ThrustKilonewtons,
                    ["specificImpulseSeconds"] = burn.SpecificImpulseSeconds,
                    ["initialMassTons"] = burn.InitialMassTons,
                    ["inertiallyFixed"] = burn.InertiallyFixed,
                    ["coordinateSystem"] = burn.CoordinateSystem,
                    ["anomalous"] = IsAnomalous(burn.Index, count, observation.AnomalousBurnCount),
                });
            }

            return new Dictionary<string, object?>
            {
                ["vesselId"] = observation.VesselId,
                ["observedAtUt"] = observation.ObservedAtUt,
                ["planExists"] = observation.PlanExists,
                ["finalTimeUt"] = observation.FinalTimeUt,
                ["reachedDeadline"] = observation.ReachedDeadline,
                ["planIntegrated"] = observation.PlanIntegrated,
                ["statusError"] = observation.StatusError,
                ["statusMessage"] = observation.StatusMessage,
                ["firstErrorBurnIndex"] = observation.FirstErrorBurnIndex,
                ["firstFutureBurnIndex"] = observation.FirstFutureBurnIndex,
                ["anomalousBurnCount"] = observation.AnomalousBurnCount,
                ["burns"] = burns,
            };
        }
    }
}
