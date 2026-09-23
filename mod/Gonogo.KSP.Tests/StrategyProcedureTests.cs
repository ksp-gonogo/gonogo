using System.Collections.Generic;
using Gonogo.KSP.Career;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The reproduced body of stock's <c>Strategy.Activate()</c>, step for step
    /// and amount for amount. <c>StrategyActivateBodyTests</c> pins the same
    /// sequence against the installed <c>Assembly-CSharp</c>; between them, a
    /// change on either side is a red test.
    /// </summary>
    public class StrategyProcedureTests
    {
        [Fact]
        public void TheStepsRunInStocksOrder()
        {
            var strategy = new Recorder { Funds = 50000f, Reputation = 20f, Science = 30f };

            StrategyProcedure.Run(strategy);

            Assert.Equal(
                new[]
                {
                    "MarkActive",
                    "Register",
                    "StampActivated",
                    "ChargeFunds -50000",
                    "ChargeReputation -20",
                    "ChargeScience -30",
                },
                strategy.Steps);
        }

        /// <summary>
        /// Stock charges <c>-Mathf.Abs(cost)</c>, so a cost authored negative
        /// is still a deduction and never a payment.
        /// </summary>
        [Fact]
        public void ANegativeCostIsStillADeduction()
        {
            var strategy = new Recorder { Funds = -1200f, Reputation = -5f, Science = -7.5f };

            StrategyProcedure.Run(strategy);

            Assert.Contains("ChargeFunds -1200", strategy.Steps);
            Assert.Contains("ChargeReputation -5", strategy.Steps);
            Assert.Contains("ChargeScience -7.5", strategy.Steps);
        }

        /// <summary>
        /// A zero cost is never charged, so it fires none of the adder's currency
        /// events, exactly as stock skips it.
        /// </summary>
        [Fact]
        public void AZeroCostIsNotCharged()
        {
            var strategy = new Recorder { Funds = 0f, Reputation = 12f, Science = 0f };

            StrategyProcedure.Run(strategy);

            Assert.Equal(
                new[] { "MarkActive", "Register", "StampActivated", "ChargeReputation -12" },
                strategy.Steps);
        }

        /// <summary>
        /// Register runs before the charges: a registered effect that listens on
        /// the currency events hears the strategy's own setup cost, as it does in
        /// stock.
        /// </summary>
        [Fact]
        public void EffectsAreRegisteredBeforeAnythingIsCharged()
        {
            var strategy = new Recorder { Funds = 1f, Reputation = 1f, Science = 1f };

            StrategyProcedure.Run(strategy);

            var register = strategy.Steps.IndexOf("Register");
            Assert.True(register < strategy.Steps.FindIndex(s => s.StartsWith("Charge")));
        }

        [Fact]
        public void AGameRefusalIsTheGamesInItsOwnWords()
        {
            var result = StrategyProcedure.AtWrite(
                StrategyActivationRule.Verdict.Refused(StrategyArm.Funds),
                () => "Not enough Funds to set up this Strategy",
                _ => "unasked");

            Assert.NotNull(result);
            Assert.Equal(CommandErrorCode.WrongState, result!.ErrorCode);
            Assert.Equal("Not enough Funds to set up this Strategy", result.Detail);
        }

        /// <summary>
        /// Arm 8 is the reflected one. Its method going missing must neither
        /// refuse in the game's name nor let the write proceed.
        /// </summary>
        [Theory]
        [InlineData((int)StrategyArm.CommitCeiling)]
        [InlineData((int)StrategyArm.ReputationFloor)]
        [InlineData((int)StrategyArm.OwnCheck)]
        [InlineData((int)StrategyArm.Effect)]
        public void AnArmThatCouldNotBePutIsUnreadable(int unasked)
        {
            var arm = (StrategyArm)unasked;
            var result = StrategyProcedure.AtWrite(
                StrategyActivationRule.Verdict.Unanswerable(arm),
                () => "refused",
                a => "could not ask " + a);

            Assert.NotNull(result);
            Assert.Equal(CommandErrorCode.Unreadable, result!.ErrorCode);
            Assert.Equal("could not ask " + arm, result.Detail);
        }

        [Fact]
        public void OnlyArmOneLeftMeansAskItNext()
        {
            Assert.Null(StrategyProcedure.AtWrite(
                StrategyActivationRule.Verdict.Unanswerable(StrategyArm.ConcurrentCap),
                () => "refused",
                _ => "unasked"));
        }

        [Theory]
        [InlineData(0, 1, false)]
        [InlineData(2, 3, false)]
        [InlineData(3, 3, true)]
        [InlineData(4, 3, true)]
        [InlineData(0, 0, true)]
        public void TheConcurrentCapRefusesAtTheLimit(int active, int limit, bool refuses)
        {
            Assert.Equal(refuses, StrategyProcedure.ConcurrentCapRefuses(active, limit));
        }

        private sealed class Recorder : IStrategyProcedureTarget
        {
            public float Funds { get; set; }
            public float Reputation { get; set; }
            public float Science { get; set; }
            public List<string> Steps { get; } = new List<string>();

            public float InitialCostFunds => Funds;
            public float InitialCostReputation => Reputation;
            public float InitialCostScience => Science;

            public void MarkActive() => Steps.Add("MarkActive");
            public void Register() => Steps.Add("Register");
            public void StampActivated() => Steps.Add("StampActivated");
            public void ChargeFunds(double amount) => Steps.Add("ChargeFunds " + amount.ToString("R", System.Globalization.CultureInfo.InvariantCulture));
            public void ChargeReputation(float amount) => Steps.Add("ChargeReputation " + amount.ToString("R", System.Globalization.CultureInfo.InvariantCulture));
            public void ChargeScience(float amount) => Steps.Add("ChargeScience " + amount.ToString("R", System.Globalization.CultureInfo.InvariantCulture));
        }
    }
}
