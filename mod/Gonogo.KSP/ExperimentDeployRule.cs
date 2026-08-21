using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The three refusals <c>ModuleScienceExperiment.DeployExperiment()</c>
    /// makes, in stock's own order.
    ///
    /// <para><b>What was wrong.</b> That method returns <c>void</c> and refuses
    /// through <c>ScreenMessages</c>, so calling it and returning <c>Ok()</c>
    /// reported a green run for an experiment the game declined. The screen
    /// message the player would have seen is on the KSP window, which the
    /// operator is not looking at, and the console's record said the experiment
    /// ran.</para>
    ///
    /// <para>Every one is askable first: <c>part.ShieldedFromAirstream</c>
    /// against the module's <c>availableShielded</c>,
    /// <c>ScienceUtil.RequiredUsageInternalAvailable</c> (a public static that
    /// fills in its own reason string), and <c>cooldownTimer</c>. Carved out
    /// here so the ORDER and the codes can be entered by a test; the facts
    /// themselves are read off the live module by the actuator.</para>
    /// </summary>
    internal static class ExperimentDeployRule
    {
        /// <summary>
        /// The refusal for one experiment module, or null when the game would
        /// have run it.
        ///
        /// <para>The two sentences are passed in already resolved because they
        /// live in KSP's localisation table under opaque <c>#autoLOC_</c>
        /// numbers, and this file carries no KSP type. The third
        /// (<paramref name="usageRequirementMessage"/>) is written by
        /// <c>ScienceUtil</c> itself.</para>
        /// </summary>
        public static Refusal? RefusalFor(
            bool shielded,
            bool usageRequirementsMet,
            string usageRequirementMessage,
            bool coolingDown,
            string shieldedMessage,
            string cooldownMessage)
        {
            if (shielded)
            {
                // Opening the bay or staging the fairing changes this, which is
                // what makes it a moment rather than a capability.
                return new Refusal(CommandErrorCode.NotClearToProceed, shieldedMessage);
            }

            if (!usageRequirementsMet)
            {
                // ExperimentUsageReqs: vessel control, crew aboard, crew in this
                // part, a Scientist. What the craft is, not when.
                return new Refusal(
                    CommandErrorCode.CapabilityMismatch, usageRequirementMessage);
            }

            if (coolingDown)
            {
                return new Refusal(CommandErrorCode.NotClearToProceed, cooldownMessage);
            }

            return null;
        }
    }
}
