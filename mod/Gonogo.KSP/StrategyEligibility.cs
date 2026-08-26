namespace Gonogo.KSP
{
    /// <summary>
    /// Whether a strategy can be activated, as a reading that is allowed to have
    /// no answer.
    ///
    /// <para>KSP answers the question only while the Administration Building is
    /// open. <c>Strategy.CanBeActivated</c>'s first three arms read the
    /// active-strategy count, the concurrent cap and the commit-level ceiling
    /// off <c>Administration.Instance</c>, a UI component that exists only while
    /// the player has that screen up, so with it closed the very first arm
    /// throws for every strategy on every tick. That is structural, not
    /// occasional.</para>
    ///
    /// <para>So the unanswered case is ABSENT and not false. A false with a
    /// reason beside it says the game judged this strategy and refused it, and
    /// an operator reads "eligibility check failed" as an intermittent fault in
    /// something. Neither is true, and a live RP-1 career published exactly that
    /// pair on every Program it had.</para>
    ///
    /// <para>A KSP-free rule so it can be pinned headless, the same shape as
    /// <see cref="StageRule"/> and the other decision types beside it. The
    /// Administration check itself lives at the call site, where the game object
    /// is.</para>
    /// </summary>
    public readonly struct StrategyEligibility
    {
        /// <summary>What an operator is told while the answer cannot be had at all.</summary>
        public const string AdministrationClosedReason =
            "unknown: KSP answers this only while the Administration Building is open";

        /// <summary>Null when the question could not be put to the game.</summary>
        public bool? CanActivate { get; }

        /// <summary>
        /// Why, whether that is the game's own refusal or our account of why it
        /// was never asked. Empty when the game said yes, which is what it does.
        /// </summary>
        public string? BlockedReason { get; }

        private StrategyEligibility(bool? canActivate, string? blockedReason)
        {
            CanActivate = canActivate;
            BlockedReason = blockedReason;
        }

        /// <summary>
        /// The Administration Building is shut, so nobody can answer. The same
        /// ground <c>KspCareerActuator.ActivateStrategy</c> refuses on.
        /// </summary>
        public static StrategyEligibility AdministrationClosed() =>
            new StrategyEligibility(null, AdministrationClosedReason);

        /// <summary>
        /// The walk threw somewhere we did not predict. Still absent rather than
        /// false, and the exception type is named so a bug report can start
        /// somewhere.
        /// </summary>
        public static StrategyEligibility Threw(string exceptionTypeName) =>
            new StrategyEligibility(null, "eligibility check failed: " + exceptionTypeName);

        /// <summary>The game answered. Its verdict and its own wording, both carried through.</summary>
        public static StrategyEligibility Answered(bool canActivate, string? reason) =>
            new StrategyEligibility(canActivate, reason);
    }
}
