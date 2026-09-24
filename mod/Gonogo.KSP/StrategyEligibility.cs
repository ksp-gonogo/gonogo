namespace Gonogo.KSP
{
    /// <summary>
    /// Whether a strategy can be activated, as a reading that is allowed to have
    /// no answer, and that says who answered.
    ///
    /// <para>KSP's own <c>Strategy.CanBeActivated</c> can only be called while the
    /// Administration Building is open: its first arm reads the active-strategy
    /// count and the concurrent cap off <c>Administration.Instance</c>, a UI
    /// component that exists only while the player has that screen up, so with it
    /// closed the method throws for every strategy on every tick. That used to
    /// make the whole roster unanswerable from a console, which is the whole
    /// feature missing rather than a gap in it.</para>
    ///
    /// <para>So the question is now put arm by arm instead
    /// (<see cref="StrategyActivationRule"/>), against the same members stock
    /// reads, and this type records WHICH route produced the answer. A consumer
    /// deciding whether to arm a control, rather than merely to print a sentence,
    /// can then tell the game's own verdict from one assembled out of its
    /// parts.</para>
    ///
    /// <para>The unanswered case stays ABSENT and never false. A false with a
    /// reason beside it says the game judged this strategy and refused it, and an
    /// operator reads "eligibility check failed" as an intermittent fault in
    /// something. Neither is true, and a live RP-1 career published exactly that
    /// pair on every Program it had.</para>
    ///
    /// <para>A KSP-free rule so it can be pinned headless, the same shape as
    /// <see cref="StageRule"/> and the other decision types beside it. The live
    /// reads live at the call site, where the game objects are.</para>
    /// </summary>
    public readonly struct StrategyEligibility
    {
        /// <summary>KSP's own <c>CanBeActivated</c>, with its screen open.</summary>
        public const string ScreenedSource = "screened";

        /// <summary>The same arms, put one at a time, with the screen shut.</summary>
        public const string DerivedSource = "derived";

        /// <summary>Nobody answered, so no verdict is carried.</summary>
        public const string NoSource = "none";

        /// <summary>Null when the question could not be put.</summary>
        public bool? CanActivate { get; }

        /// <summary>
        /// Why, whether that is the game's own refusal or our account of why it
        /// was never asked. Empty when the game said yes, which is what it does.
        /// </summary>
        public string? BlockedReason { get; }

        /// <summary>
        /// Which route produced <see cref="CanActivate"/>: one of
        /// <see cref="ScreenedSource"/>, <see cref="DerivedSource"/> or
        /// <see cref="NoSource"/>.
        /// </summary>
        public string VerdictSource { get; }

        private StrategyEligibility(bool? canActivate, string? blockedReason, string verdictSource)
        {
            CanActivate = canActivate;
            BlockedReason = blockedReason;
            VerdictSource = verdictSource;
        }

        /// <summary>
        /// KSP answered for itself, which it will do whenever the Administration
        /// screen happens to be up. Its verdict and its own wording, both carried
        /// through.
        /// </summary>
        public static StrategyEligibility Screened(bool canActivate, string? reason) =>
            new StrategyEligibility(canActivate, reason, ScreenedSource);

        /// <summary>
        /// The arms were put one at a time and agreed on an answer. The wording is
        /// still the game's, fetched from the localisation tag stock uses at the
        /// arm that refused.
        /// </summary>
        public static StrategyEligibility Derived(bool canActivate, string? reason) =>
            new StrategyEligibility(canActivate, reason, DerivedSource);

        /// <summary>
        /// One of the arms could not be put, so there is no verdict to carry.
        /// Every arm has to agree before a yes can be stood behind, and a refusal
        /// this never saw is one an operator would be armed against.
        /// </summary>
        public static StrategyEligibility Unasked(string what) =>
            new StrategyEligibility(null, "unknown: " + what, NoSource);

        /// <summary>
        /// The walk threw somewhere we did not predict. Still absent rather than
        /// false, and the exception type is named so a bug report can start
        /// somewhere.
        /// </summary>
        public static StrategyEligibility Threw(string exceptionTypeName) =>
            new StrategyEligibility(null, "eligibility check failed: " + exceptionTypeName, NoSource);
    }
}
