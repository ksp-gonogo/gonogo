using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// One reading of a flight plan, taken at a known instant.
    ///
    /// <para>An OBSERVATION rather than a state, and the distinction is the point.
    /// The fields this is read from live on a window class and are refreshed only
    /// while that window renders, so there is no such thing as "the current plan"
    /// to model: there is only what was seen, and when. <see cref="ObservedAtUt"/>
    /// is therefore not optional and not a convenience.</para>
    ///
    /// <para>KSP-free and Harmony-free, so the pure builder and its headless tests
    /// never pull in the game surface. Nothing here interprets the values; that is
    /// <see cref="FlightPlanBuilder"/>'s job.</para>
    /// </summary>
    public sealed class FlightPlanObservation
    {
        /// <summary>The vessel guid the plan was drawn for, as handed to the
        /// observed method rather than inferred from the active vessel.</summary>
        public string? VesselId;

        /// <summary>When this reading was taken.</summary>
        public double ObservedAtUt;

        /// <summary>Whether a plan was seen to exist. False is a real observation
        /// of absence, never a stand-in for "not looked at".</summary>
        public bool PlanExists;

        public double? FinalTimeUt;
        public bool ReachedDeadline;

        /// <summary>Whether the plan integrated: true observed OK, false observed
        /// failed, <b>null when the status could not be read at all</b>. The third
        /// state is the point. Collapsing an unreadable status into "integrated"
        /// would report health from a failed reflection, and a plan whose status we
        /// cannot see is a plan we cannot vouch for.</summary>
        public bool? PlanIntegrated;

        /// <summary>The integrator's error code, when it failed.</summary>
        public int? StatusError;
        public string? StatusMessage;
        public int? FirstErrorBurnIndex;
        public int? FirstFutureBurnIndex;

        /// <summary>How many burns the integrator flagged. They are the LAST n of
        /// <see cref="Burns"/>; resolving which is the builder's job.</summary>
        public int AnomalousBurnCount;

        public List<BurnObservation> Burns = new List<BurnObservation>();
    }

    /// <summary>
    /// One burn as read off the plan. Every field comes from a plain managed field
    /// or a property over one, so the reading never asks the integrator to
    /// recompute anything.
    /// </summary>
    public sealed class BurnObservation
    {
        public int Index;
        public double? IgnitionUt;
        public double? CutoffUt;
        public double? DurationSeconds;
        public double? DeltaV;
        public double? ThrustKilonewtons;
        public double? SpecificImpulseSeconds;
        public double? InitialMassTons;
        public bool? InertiallyFixed;
        public int? CoordinateSystem;
    }
}
