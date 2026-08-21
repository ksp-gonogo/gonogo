using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Science
{
    /// <summary>
    /// The three refusals <c>ModuleScienceExperiment.DeployExperiment()</c>
    /// makes, which the console used to report as success.
    ///
    /// <para>That method returns <c>void</c> and refuses through
    /// <c>ScreenMessages</c>, so calling it and returning <c>Ok()</c> reports a
    /// green run for an experiment the game declined: shielded inside a fairing,
    /// missing the crew or control the experiment requires, or still cooling
    /// down. The screen message the player would have seen is on the KSP window,
    /// which the operator is not looking at, and the console's record says the
    /// experiment ran.</para>
    ///
    /// <para>All three are askable first. This is the order they are asked in,
    /// which is stock's own (decompiled body from offset 45/60/69).</para>
    /// </summary>
    public class ExperimentDeployRuleTests
    {
        [Fact]
        public void AnExperimentTheGameWouldRunIsNotRefused()
        {
            Assert.Null(Deploy());
        }

        [Fact]
        public void AShieldedPartIsRefusedRatherThanReportedAsRun()
        {
            var refusal = Deploy(shielded: true);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.NotClearToProceed, refusal!.Value.Code);
            Assert.Equal("Cannot deploy experiment while shielded", refusal.Value.Detail);
        }

        /// <summary>
        /// <c>ScienceUtil.RequiredUsageInternalAvailable</c> fills in the reason
        /// itself, in the player's language, so the console quotes it.
        /// </summary>
        [Fact]
        public void AnUnmetUsageRequirementCarriesTheGamesOwnMessage()
        {
            var refusal = Deploy(
                usageRequirementsMet: false,
                usageRequirementMessage: "Requires a crewed vessel");

            Assert.Equal(CommandErrorCode.CapabilityMismatch, refusal!.Value.Code);
            Assert.Equal("Requires a crewed vessel", refusal.Value.Detail);
        }

        [Fact]
        public void AnExperimentStillCoolingDownIsRefused()
        {
            var refusal = Deploy(coolingDown: true);

            Assert.Equal(CommandErrorCode.NotClearToProceed, refusal!.Value.Code);
            Assert.Equal("Experiment on cooldown: 12s", refusal.Value.Detail);
        }

        /// <summary>
        /// Stock asks shielding first, then the usage requirements, then the
        /// cooldown. Reporting a later arm would tell the operator to fix the
        /// wrong thing.
        /// </summary>
        [Fact]
        public void ShieldingIsReportedAheadOfEverythingElse()
        {
            var refusal = Deploy(
                shielded: true, usageRequirementsMet: false, coolingDown: true);

            Assert.Equal("Cannot deploy experiment while shielded", refusal!.Value.Detail);
        }

        [Fact]
        public void UsageRequirementsAreReportedAheadOfTheCooldown()
        {
            var refusal = Deploy(
                usageRequirementsMet: false,
                usageRequirementMessage: "Requires a Scientist",
                coolingDown: true);

            Assert.Equal("Requires a Scientist", refusal!.Value.Detail);
        }

        /// <summary>
        /// A refusal whose sentence came back blank still refuses. The message
        /// is the useful half and the code is the load-bearing one; losing the
        /// first must not lose the second.
        /// </summary>
        [Fact]
        public void ARefusalWithNoSentenceIsStillARefusal()
        {
            var refusal = Deploy(usageRequirementsMet: false, usageRequirementMessage: "");

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.CapabilityMismatch, refusal!.Value.Code);
        }

        private static Refusal? Deploy(
            bool shielded = false,
            bool usageRequirementsMet = true,
            string usageRequirementMessage = "",
            bool coolingDown = false) =>
            ExperimentDeployRule.RefusalFor(
                shielded,
                usageRequirementsMet,
                usageRequirementMessage,
                coolingDown,
                "Cannot deploy experiment while shielded",
                "Experiment on cooldown: 12s");
    }
}
