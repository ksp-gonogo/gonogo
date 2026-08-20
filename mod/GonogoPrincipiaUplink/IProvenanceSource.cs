namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Where the provenance reader gets its two objects, and where the prediction
    /// observation comes from.
    ///
    /// <para>A seam for the same reason <see cref="IFlightPlanObserver"/> is one:
    /// finding the producer's addon instance needs the game, and the decisions made
    /// around it should not. Everything behind this interface is a lookup; every
    /// judgement about what to publish stays in <see cref="PrincipiaUplink"/> where
    /// a test can drive it.</para>
    /// </summary>
    public interface IProvenanceSource
    {
        /// <summary>Starts observing, if the producer is there to observe.
        /// Idempotent, and false rather than throwing when it cannot.</summary>
        bool TryAttach();

        /// <summary>The producer's main window, or null when it cannot be
        /// found.</summary>
        object? MainWindow { get; }

        /// <summary>The producer's plotting-frame selector, or null.</summary>
        object? FrameSelector { get; }

        /// <summary>The prediction settings as last observed, or null when the
        /// producer's settings UI has not rendered yet. Null is "not observed",
        /// never a default.</summary>
        PredictionSettingsObservation? Prediction { get; }
    }
}
