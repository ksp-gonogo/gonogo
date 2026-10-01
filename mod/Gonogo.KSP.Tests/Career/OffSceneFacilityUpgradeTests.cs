using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Gonogo.KSP.Career;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// A facility upgrade where no <c>UpgradeableFacility</c> is registered (the
    /// Tracking Station): the tier goes into the save, the funds are charged once,
    /// and both of <c>SetLevel</c>'s events fire, in the live path's order.
    /// </summary>
    public class OffSceneFacilityUpgradeTests
    {
        [Fact]
        public void ApplyChargesOnceFiresBothEventsAndWritesTheTierBetweenThem()
        {
            var node = new ConfigNode("SpaceCenter/TrackingStation");
            node.AddValue("lvl", 0f);
            var steps = new List<string>();

            OffSceneFacilityUpgrade.Apply(
                node,
                newTier: 1,
                maxLevel: 2,
                debit: () => steps.Add("debit"),
                upgrading: level => steps.Add("upgrading " + level + " lvl=" + node.GetValue("lvl")),
                upgraded: level => steps.Add("upgraded " + level + " lvl=" + node.GetValue("lvl")));

            Assert.Equal(
                new[] { "debit", "upgrading 1 lvl=0", "upgraded 1 lvl=0.5" },
                steps);
        }

        [Fact]
        public void ApplyCreatesTheLevelWhenTheSaveHasNone()
        {
            var node = new ConfigNode("SpaceCenter/TrackingStation");

            OffSceneFacilityUpgrade.Apply(node, 2, 2, () => { }, _ => { }, _ => { });

            Assert.Equal(2, OffSceneFacilityUpgrade.PersistedTier(node, 2));
        }

        /// <summary>
        /// What is written is what the component reads back on its next load
        /// (<c>setNormLevel</c>), for every tier of every ladder shape in use.
        /// </summary>
        [Theory]
        [InlineData(1)]
        [InlineData(2)]
        [InlineData(4)]
        [InlineData(8)]
        [InlineData(10)]
        public void EveryTierRoundTripsThroughTheSave(int maxLevel)
        {
            for (var tier = 0; tier <= maxLevel; tier++)
            {
                var node = new ConfigNode("f");
                OffSceneFacilityUpgrade.Apply(node, tier, maxLevel, () => { }, _ => { }, _ => { });
                Assert.Equal(tier, OffSceneFacilityUpgrade.PersistedTier(node, maxLevel));
            }
        }

        /// <summary>No <c>lvl</c> is the top tier, as <c>ProtoUpgradeable.GetLevel</c> reads it.</summary>
        [Fact]
        public void AMissingLevelIsTheTopTier()
        {
            Assert.Equal(2, OffSceneFacilityUpgrade.PersistedTier(new ConfigNode("f"), 2));
        }

        [Fact]
        public void NormalisedLevelsFloorToTheTierStockDerives()
        {
            Assert.Equal(0, FacilityLadder.TierFromNorm(0f, 2));
            Assert.Equal(1, FacilityLadder.TierFromNorm(0.5f, 2));
            Assert.Equal(2, FacilityLadder.TierFromNorm(1f, 2));
            Assert.Equal(2, FacilityLadder.TierFromNorm(7f, 2));
            Assert.Equal(0, FacilityLadder.TierFromNorm(-1f, 2));
        }

        [Fact]
        public void TheNextTiersCostIsTheRungAboveAndNothingAtTheTop()
        {
            var rungs = new FacilityLadder.Rungs(2, new[] { 0f, 75000f, 250000f }, null);

            Assert.Equal(75000f, FacilityLadder.NextTierCost(rungs, 0));
            Assert.Equal(250000f, FacilityLadder.NextTierCost(rungs, 1));
            Assert.Null(FacilityLadder.NextTierCost(rungs, 2));
        }

        /// <summary>
        /// The actuator reaches the off-scene arm whenever the facility is known
        /// and nothing is registered for it, rather than refusing on the scene.
        /// </summary>
        [Fact]
        public void TheUpgradeCommandTakesTheOffSceneArmWhenNoComponentIsRegistered()
        {
            var body = CareerSpendPaymentTests.MethodBody("KspCareerActuator.cs", "private CommandResult UpgradeFacility(string facilityId, bool commit)");

            Assert.Contains("if (known && !built)", body);
            Assert.Contains("return UpgradeFacilityOffScene(facilityId, sanitizedId, proto!, commit);", body);
        }

        /// <summary>
        /// The off-scene arm charges through <see cref="OffSceneFacilityUpgrade.Apply"/>'s
        /// one debit, and fires both events the live <c>SetLevel</c> would have.
        /// </summary>
        [Fact]
        public void TheOffSceneArmDebitsOnceAndFiresBothEvents()
        {
            var body = CareerSpendPaymentTests.MethodBody(
                "KspCareerActuator.cs", "private CommandResult UpgradeFacilityOffScene(");

            Assert.Single(Regex.Matches(body, @"AddFunds\("));
            Assert.Contains("() => funding.AddFunds(-cost, TransactionReasons.StructureConstruction)", body);
            Assert.Contains("OffSceneFacilityUpgrade.Apply(", body);
            Assert.Contains("GameEvents.OnKSCFacilityUpgrading.Fire(component, level)", body);
            Assert.Contains("GameEvents.OnKSCFacilityUpgraded.Fire(component, level)", body);
            Assert.DoesNotContain(".SetLevel(", body);
        }
    }
}
