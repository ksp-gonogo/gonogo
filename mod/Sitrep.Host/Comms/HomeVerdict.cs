namespace Sitrep.Host.Comms
{
    /// <summary>
    /// When the ground expects to hear a silent craft again, as it worked out at
    /// the instant the ground lost the craft. A forecast with no deadline says
    /// the ground can hear the craft again.
    /// </summary>
    public sealed class CraftForecast
    {
        public CraftForecast(string id, double capturedUt, double? onsetUt, double? deadlineUt, string? basis, double? predictedReacquisitionUt, double? predictionGraceSec)
        {
            Id = id;
            CapturedUt = capturedUt;
            OnsetUt = onsetUt;
            DeadlineUt = deadlineUt;
            Basis = basis;
            PredictedReacquisitionUt = predictedReacquisitionUt;
            PredictionGraceSec = predictionGraceSec;
        }

        /// <summary>The craft, as <c>vessel:&lt;guid&gt;</c>.</summary>
        public string Id { get; }

        /// <summary>The instant this was true at.</summary>
        public double CapturedUt { get; }

        /// <summary>The instant the ground lost the craft, or null while it can hear it.</summary>
        public double? OnsetUt { get; }

        /// <summary>The instant past which a craft still not heard may be declared lost, in the craft's own time, or null while the ground can hear it.</summary>
        public double? DeadlineUt { get; }

        /// <summary>One of <see cref="SilenceDeadlineBasis"/>, or null while the ground can hear the craft.</summary>
        public string? Basis { get; }

        /// <summary>The instant the ground is predicted to hear the craft again, or null when there is no prediction.</summary>
        public double? PredictedReacquisitionUt { get; }

        /// <summary>How long past the predicted return the craft may stay quiet before it is overdue, in seconds, or null when there is no prediction.</summary>
        public double? PredictionGraceSec { get; }
    }

    /// <summary>The home centre's judgement of one craft.</summary>
    public enum HomeVerdictState
    {
        Nominal,
        Silent,
        Lost,
        Gone,
    }

    /// <summary>The home centre's judgement of one craft, and the bookkeeping behind its Lost declarations.</summary>
    public sealed class HomeVerdict
    {
        public string Id = string.Empty;

        public HomeVerdictState State = HomeVerdictState.Nominal;

        /// <summary>The instant the craft was last declared lost, or null when it never was.</summary>
        public double? DeclaredLostUt;

        /// <summary>
        /// Moves once for each declaration and never on its withdrawal, so with
        /// the craft it names one declaration: a load that replays it has the
        /// same pair, and a later loss has a new one.
        /// </summary>
        public int LostSeq;

        /// <summary>The instant home last heard of contact with the craft after declaring it lost, which withdrew the declaration, or null when none was withdrawn.</summary>
        public double? WithdrawnUt;

        /// <summary>How many judgements in a row have found the craft past its wait. Not saved: a load starts it again.</summary>
        internal int Overdue;

        /// <summary>The verdict as it stands, apart from this one, which goes on being judged.</summary>
        public HomeVerdict Copy() => new HomeVerdict
        {
            Id = Id, State = State, DeclaredLostUt = DeclaredLostUt, LostSeq = LostSeq, WithdrawnUt = WithdrawnUt,
        };
    }
}
