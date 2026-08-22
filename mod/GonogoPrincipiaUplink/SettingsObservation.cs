using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// One reference frame as observed, and the shape every frame-dependent
    /// quantity this Uplink publishes is stamped with.
    ///
    /// <para>Kept as a separate type rather than as a prefix of fields on the
    /// settings, because there is more than one frame in play at once: the global
    /// plotting frame and, per burn, that burn's own manœuvring frame. Flattening
    /// it would make the second impossible to express and the first look
    /// unique.</para>
    ///
    /// <para>The kind is the producer's own enum VALUE, not an index and not a
    /// name. Naming it would mean calling one of the producer's four namers, and
    /// every one of them reaches a fatal log through a default branch.</para>
    /// </summary>
    public sealed class FrameObservation
    {
        /// <summary>Which selector this came from: <c>plotting</c> or <c>burn</c>.</summary>
        public string? Selector;

        public int? Type;
        public string? CentreBody;
        public string? PrimaryBody;
        public string? SecondaryBody;

        /// <summary>
        /// The bodies on each side, of which the two singular fields above are the
        /// heads.
        ///
        /// <para>A pulsating frame turns about a pair of SETS rather than a pair of
        /// bodies, so the singular fields cannot express it: a Sun-Earth frame's
        /// primary side is Sun, Mercury and Venus. Left empty for the frames whose
        /// sides really are one body each, so an empty list means "the head is the
        /// whole of it" rather than "not read".</para>
        /// </summary>
        public List<string> PrimaryBodies = new List<string>();
        public List<string> SecondaryBodies = new List<string>();

        public bool? TargetFrameSelected;
        public string? TargetVesselId;
        public string? TargetVesselName;
    }

    /// <summary>
    /// The settings that decide what every other number means, as read in one
    /// main-thread tick.
    ///
    /// <para>KSP-free and Harmony-free, so the reader, the builder and their tests
    /// stay headless. Every field is nullable and left null when it could not be
    /// read: an invented tolerance is a fabricated basis for judging everything
    /// else on the screen, where a missing one is a gap an operator can act
    /// on.</para>
    ///
    /// <para><see cref="ReadingSuspended"/> is not an error state. It is the
    /// deliberate outage the journal rule produces: while the producer is
    /// recording, we read nothing rather than write our own polling into the
    /// artefact one of its bug reports is made of.</para>
    /// </summary>
    public sealed class SettingsObservation
    {
        /// <summary>The instant this reading was taken, and the sample's own UT.
        /// These settings are true as of now, which is why there is one instant
        /// here rather than the flight plan's two.</summary>
        public double SampledAtUt;

        public string? PluginVersion;
        public bool ReadingSuspended;
        public string? ReadingSuspendedReason;

        public FrameObservation? PlottingFrame;
        public List<FrameObservation> BurnFrames = new List<FrameObservation>();

        public bool? SelectingTargetVessel;
        public string? TargetVesselId;
        public string? TargetVesselName;
        public bool? SelectingTargetCelestial;
        public string? TargetCelestialBody;
        public bool? DisplayPatchedConics;

        public double? AnalysisMissionDurationRequestedSeconds;
        public bool? RecurrenceAutodetect;
        public int? RecurrenceRevolutionsPerCycle;
        public int? RecurrenceDaysPerCycle;
        public int? GroundTrackRevolution;

        public string? PredictionVesselId;
        public double? PredictionToleranceMetres;
        public double? PredictionMaxSteps;
        public double? PlanToleranceMetres;
        public double? PlanMaxSteps;
        public double? PlanInitialTimeUt;
        public double? PlanDesiredFinalTimeUt;
        public double? PlanActualFinalTimeUt;
        public int? FlightPlanCount;
        public int? SelectedFlightPlan;
        public double? OptimiserTargetAltitudeMetres;
        public double? OptimiserTargetInclinationDegrees;

        public double? HistoryLengthSeconds;
        public bool? UnpinnedMarkersHiddenHere;
        public int? FramesHidingUnpinnedMarkers;
        public bool? UnpinnedCelestialsHiddenHere;
        public int? FramesHidingUnpinnedCelestials;
        public List<string> PinnedCelestials = new List<string>();
        public bool? TargetPinned;
        public bool? ShowManoeuvreOnNavball;
        public bool? StabilityGridMaxEccentricityMinInclination;
        public bool? StabilityGridMinEccentricityMaxInclination;
        public bool? ShowElementGraphs;

        public int? VerboseLevel;
        public int? LogThreshold;
        public int? StderrThreshold;
        public int? FlushThreshold;
        public bool? RecordJournalRequested;
        public bool? Journaling;

        /// <summary>
        /// The whole reading, replaced by a stated outage.
        ///
        /// <para>Written as a constructor rather than by clearing fields, so a
        /// suspended sample can never carry a leftover value from the tick before:
        /// a stale tolerance next to "we have stopped reading" is exactly the
        /// half-true payload the rule exists to avoid.</para>
        /// </summary>
        public static SettingsObservation Suspended(double ut, string? version, string reason) =>
            new SettingsObservation
            {
                SampledAtUt = ut,
                PluginVersion = version,
                ReadingSuspended = true,
                ReadingSuspendedReason = reason,
            };
    }
}
