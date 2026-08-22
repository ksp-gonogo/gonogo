using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The selected flight plan as the plugin answered it, this tick.
    ///
    /// <para>KSP-free and Harmony-free, like every observation type here, so the
    /// mapping and the publish decisions are provable headless.</para>
    /// </summary>
    public sealed class PlanObservation
    {
        public string? VesselId;
        public double SampledAtUt;

        /// <summary>Whether the plugin says a plan exists. False is a positive
        /// observation of none, never a stand-in for "we did not ask".</summary>
        public bool PlanExists;

        public int? PlanCount;
        public int? SelectedPlan;
        public double? InitialTimeUt;
        public double? DesiredFinalTimeUt;
        public double? ActualFinalTimeUt;
        public int? AnomalousBurnCount;

        /// <summary>Whether the producer's optimiser is mid-run on this plan. Null
        /// when it could not be asked, which is not the same as "no".</summary>
        public bool? OptimisationRunning;

        public double? MaxSteps;
        public double? LengthToleranceMetres;
        public double? SpeedToleranceMetresPerSecond;
        public double? IntegratorKind;
        public double? GeneralizedIntegratorKind;

        /// <summary>Whether the write surface could be armed, whether it is, and
        /// why not.</summary>
        public bool WriteSurfaceAvailable;
        public bool WriteSurfaceArmed;
        public string? WriteSurfaceReason;
        public string? WriteAnalysedVersion;
        public string? WriteDetectedVersion;

        public List<PlannedBurnObservation> Burns = new List<PlannedBurnObservation>();
    }

    /// <summary>
    /// One burn as the plugin describes it: the burn struct's own fields, plus
    /// everything the plugin computed from integrating it.
    /// </summary>
    public sealed class PlannedBurnObservation
    {
        public int Index;
        public double? IgnitionUt;
        public double? CutoffUt;
        public double? DurationSeconds;
        public double? TimeToHalfDeltaVSeconds;
        public double? DeltaVTangent;
        public double? DeltaVNormal;
        public double? DeltaVBinormal;
        public int? CoordinateSystem;
        public bool? InertiallyFixed;
        public double? ThrustKilonewtons;
        public double? SpecificImpulseSeconds;
        public double? InitialMassTons;
        public double? FinalMassTons;
        public double? MassFlowKilogramsPerSecond;
        public int? FrameType;

        /// <summary>Whether this burn's frame is one an edit may be sent back
        /// with. Resolved here so no client repeats the whitelist, and so the
        /// answer a control greys itself out on is the same answer the write gate
        /// refuses on.</summary>
        public bool FrameEditable;

        /// <summary>Whether the burn is running at the observation instant.</summary>
        public bool Executing;

        public bool Anomalous;
    }
}
