using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// What each per-item career gate declares as its inputs, which is what
    /// decides when the gate report asks its items again. An input left out
    /// here is a verdict that goes stale until another input moves.
    /// </summary>
    public class ItemGateInputTests
    {
        private static IReadOnlyList<string> InputsOf(string kind) =>
            ItemGates.All(new Judge())
                .OfType<ICommandGateInputs>()
                .Cast<ICommandGateEvaluator>()
                .Where(e => e.Kind == kind)
                .SelectMany(e => ((ICommandGateInputs)e).Inputs.Select(i => i.Name))
                .ToList();

        [Fact]
        public void EveryItemGateDeclaresItsInputs()
        {
            foreach (var evaluator in ItemGates.All(new Judge()))
            {
                var inputs = Assert.IsAssignableFrom<ICommandGateInputs>(evaluator);
                Assert.NotEmpty(inputs.Inputs);
            }
        }

        [Fact]
        public void AnUpgradeReadsTheFundsTheFacilitiesAndWhatStandsOnThem()
        {
            Assert.Equal(
                new[] { "scene", "funds", "facilities", "vessels", "strategies" },
                InputsOf(ItemGates.Kinds.FacilityUpgrade));
        }

        [Fact]
        public void AResearchReadsTheScienceAndTheTreeButNotTheFunds()
        {
            var inputs = InputsOf(ItemGates.Kinds.TechUnlock);

            Assert.Contains("science", inputs);
            Assert.Contains("research", inputs);
            Assert.DoesNotContain("funds", inputs);
        }

        [Fact]
        public void AnActivationReadsAllThreeCurrenciesAndTheRouteItIsJudgedBy()
        {
            var inputs = InputsOf(ItemGates.Kinds.StrategyActivate);

            Assert.Contains("funds", inputs);
            Assert.Contains("science", inputs);
            Assert.Contains("reputation", inputs);
            Assert.Contains("administration", inputs);
        }

        [Fact]
        public void ADeactivationReadsTheStrategiesAndNoCurrency()
        {
            Assert.Equal(new[] { "scene", "strategies" }, InputsOf(ItemGates.Kinds.StrategyDeactivate));
        }

        private sealed class Judge : ICareerItemJudge
        {
            public CommandResult JudgeUpgradeFacility(string facilityId) => throw new System.NotSupportedException();

            public CommandResult JudgeUnlockTech(string techId) => throw new System.NotSupportedException();

            public CommandResult JudgeActivateStrategy(string strategyId) => throw new System.NotSupportedException();

            public CommandResult JudgeDeactivateStrategy(string strategyId) => throw new System.NotSupportedException();

            public bool StrategyScreenOpen => false;
        }
    }
}
