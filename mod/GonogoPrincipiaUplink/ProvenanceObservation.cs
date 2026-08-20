namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The settings that decide whether a propagated number can be trusted, split
    /// by whether reading them cold gives the truth.
    ///
    /// <para>The fields down to <see cref="TargetFrameSelected"/> are operator state:
    /// a toggle holds what the operator set, a length is restored from the save, and
    /// a frame kind holds the current frame. All correct whenever read.</para>
    ///
    /// <para><see cref="Prediction"/> is not, and it is separated for that reason
    /// rather than for tidiness. It carries the two settings this whole surface
    /// exists for, and they are only true at the instant they were observed.</para>
    ///
    /// <para>KSP-free and Harmony-free, so the builder and its tests stay
    /// headless.</para>
    /// </summary>
    public sealed class ProvenanceObservation
    {
        /// <summary>The instant this reading was taken, used as the sample's own UT.
        ///
        /// <para>Not the same thing as <see cref="PredictionSettingsObservation.ObservedAtUt"/>
        /// and the pair is worth keeping straight: this one says "these settings are
        /// the settings AS OF now", which is a claim we can make every tick because
        /// the fields are current. The other says "the prediction bound was last seen
        /// at THIS past instant", which is a claim about the past that does not become
        /// truer by being repeated. Two instants because there are two kinds of
        /// statement in one payload.</para></summary>
        public double SampledAtUt;

        public bool? DisplayPatchedConics;
        public double? HistoryLengthSeconds;
        public int? FramesHidingUnpinnedMarkers;
        public int? FramesHidingUnpinnedCelestials;
        public int? PlottingFrameType;
        public string? PlottingFrameCentreBody;
        public bool? TargetFrameSelected;

        /// <summary>The prediction settings as last seen, or null when the
        /// producer's own settings UI has not rendered yet. Null is "not observed",
        /// never a default.</summary>
        public PredictionSettingsObservation? Prediction;
    }

    /// <summary>
    /// The prediction accuracy bound, as observed at an instant, for a vessel.
    ///
    /// <para>Both halves of the bound come from the same reading and neither means
    /// much alone: a tight tolerance with a low step limit is a prediction that
    /// stops early, not an accurate one. They travel together for that reason.</para>
    ///
    /// <para><see cref="VesselId"/> is not optional. The producer's own source for
    /// these is per-vessel, so a tolerance with no vessel attached would read as a
    /// global setting and mislead about every other craft in the fleet.</para>
    /// </summary>
    public sealed class PredictionSettingsObservation
    {
        public double ObservedAtUt;
        public string? VesselId;
        public double? ToleranceMetres;
        public double? MaxSteps;
    }
}
