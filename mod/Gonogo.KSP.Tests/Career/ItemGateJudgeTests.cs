using System;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// The per-item gates ask the actuator's own commands with <c>commit</c>
    /// off, every half second, for every item. A judge that reached a spend
    /// would charge the career on a timer, so each command must stop before its
    /// first write, and after its last check.
    /// </summary>
    public class ItemGateJudgeTests
    {
        private const string Stop = "if (!commit) return CommandResult.Ok();";

        [Theory]
        [InlineData("private CommandResult UpgradeFacility(string facilityId, bool commit)", "funding.AddFunds(", "CanAfford(")]
        [InlineData("private CommandResult UnlockTech(string techId, bool commit)", "rnd.AddScience(", "ScienceCostBreach")]
        [InlineData("private CommandResult DeactivateStrategy(string strategyId, bool commit)", "StrategyRelease.Deactivate(", "CanBeDeactivated(")]
        public void EveryJudgeStopsAfterTheLastCheckAndBeforeTheFirstWrite(string signature, string firstWrite, string lastCheck)
        {
            var body = CareerSpendPaymentTests.MethodBody("KspCareerActuator.cs", signature);

            var stop = body.IndexOf(Stop, StringComparison.Ordinal);
            Assert.True(stop >= 0, $"{signature} has no judge stop");
            Assert.True(stop < body.IndexOf(firstWrite, StringComparison.Ordinal), $"{signature} writes before its judge stop");
            Assert.True(body.IndexOf(lastCheck, StringComparison.Ordinal) < stop, $"{signature} checks after its judge stop");
        }

        [Fact]
        public void TheOffSceneUpgradeStopsBeforeItsOneDebit()
        {
            var body = CareerSpendPaymentTests.MethodBody("KspCareerActuator.cs", "private CommandResult UpgradeFacilityOffScene(");

            var stop = body.IndexOf(Stop, StringComparison.Ordinal);
            Assert.True(stop >= 0);
            Assert.True(stop < body.IndexOf("OffSceneFacilityUpgrade.Apply(", StringComparison.Ordinal));
            Assert.True(body.IndexOf("CanAfford(", StringComparison.Ordinal) < stop);
        }

        [Fact]
        public void ActivationIsJudgedByTheGateAloneAndNeverCommitted()
        {
            var body = CareerSpendPaymentTests.MethodBody(
                "KspCareerActuator.cs", "private CommandResult ActivateStrategy(string strategyId, double factor, bool commit)");

            Assert.Contains("commit ? StrategyCommit.Activate(live, factor) : live.Gate()", body, StringComparison.Ordinal);
            Assert.Contains(": StockStrategyActivation.Judge(strategy, system)", body, StringComparison.Ordinal);
        }
    }
}
