using System.Collections.Generic;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// The requirement kinds that name what a save is missing: a building's
    /// orbit display, a tech node, and a part module no researched part
    /// carries. The live reads arrive through each gate's constructor seam, as
    /// in <see cref="FacilityTierGateTests"/>.
    /// </summary>
    public class UnlockGateTests
    {
        private sealed class NoArguments : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }

        private static readonly IGateArguments Empty = new NoArguments();

        private static CommandRequirement Need(string kind, string quantity) =>
            new CommandRequirement { Kind = kind, Quantity = quantity };

        /// <summary>Stock's rule: below a normalised 0.2 the Tracking Station shows orbits but no patched conics.</summary>
        private static GameVariables.OrbitDisplayMode? StockDisplay(float norm) =>
            norm < 0.2f ? GameVariables.OrbitDisplayMode.AllOrbits : GameVariables.OrbitDisplayMode.PatchedConics;

        [Theory]
        [InlineData(3, 0.4f, 2)]
        [InlineData(3, 0.75f, 3)]
        [InlineData(11, 0.05f, 2)]
        [InlineData(5, -1f, 1)]
        public void TheLowestTierIsTheFirstLevelTheSwitchOpensAt(int levels, float threshold, int expected)
        {
            Assert.Equal(expected, FacilityTiers.LowestTier(levels, norm => norm > threshold));
        }

        [Fact]
        public void ACapabilityNoLevelUnlocksHasNoTier()
        {
            Assert.Null(FacilityTiers.LowestTier(3, _ => false));
        }

        [Fact]
        public void PatchedConicsAtTrackingStationLevelOneNamesLevelTwo()
        {
            var gate = new OrbitDisplayGate(
                scenarioLoaded: () => true,
                gameMode: () => Game.Modes.CAREER,
                displayModeAt: StockDisplay,
                trackingStationLevel: () => 0f,
                trackingStationLevelCount: () => 3);

            var verdict = gate.Evaluate(Need(KspGateEvaluators.Kinds.OrbitDisplay, OrbitDisplayGate.PatchedConics), Empty);

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.NotUnlocked, verdict.ErrorCode);
            var missing = Assert.Single(verdict.Missing!);
            Assert.Equal(UnlockKind.Facility, missing.Kind);
            Assert.Equal("TrackingStation", missing.Id);
            Assert.Equal(2, missing.Tier);
        }

        [Fact]
        public void EveryOrbitIsShownFromTheFirstLevel()
        {
            var gate = new OrbitDisplayGate(
                scenarioLoaded: () => true,
                gameMode: () => Game.Modes.CAREER,
                displayModeAt: StockDisplay,
                trackingStationLevel: () => 0f,
                trackingStationLevelCount: () => 3);

            var verdict = gate.Evaluate(Need(KspGateEvaluators.Kinds.OrbitDisplay, OrbitDisplayGate.AllOrbits), Empty);

            Assert.Equal(GateOutcome.Pass, verdict.Outcome);
        }

        [Fact]
        public void ASandboxSaveShowsPatchedConics()
        {
            var gate = new OrbitDisplayGate(scenarioLoaded: () => false, gameMode: () => Game.Modes.SANDBOX);
            var verdict = gate.Evaluate(Need(KspGateEvaluators.Kinds.OrbitDisplay, OrbitDisplayGate.PatchedConics), Empty);
            Assert.Equal(GateOutcome.Pass, verdict.Outcome);
        }

        [Fact]
        public void AnOrbitDisplayNobodyNamesIsUnknown()
        {
            var gate = new OrbitDisplayGate(scenarioLoaded: () => true, gameMode: () => Game.Modes.CAREER);
            var verdict = gate.Evaluate(Need(KspGateEvaluators.Kinds.OrbitDisplay, "everything"), Empty);
            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }

        [Fact]
        public void AnUnresearchedNodeIsNamedWithItsCost()
        {
            var gate = new TechResearchedGate(
                gameMode: () => Game.Modes.CAREER,
                researchLoaded: () => true,
                researched: _ => false,
                describe: _ => new TechDescription("Flight Control", 45));

            var verdict = gate.Evaluate(Need(KspGateEvaluators.Kinds.TechResearched, "flightControl"), Empty);

            Assert.Equal(CommandErrorCode.NotUnlocked, verdict.ErrorCode);
            var missing = Assert.Single(verdict.Missing!);
            Assert.Equal(UnlockKind.Tech, missing.Kind);
            Assert.Equal("flightControl", missing.Id);
            Assert.Equal("Flight Control", missing.Name);
            Assert.Equal(45, missing.ScienceCost);
            Assert.Null(missing.Tier);
        }

        [Fact]
        public void AResearchedNodePasses()
        {
            var gate = new TechResearchedGate(
                gameMode: () => Game.Modes.SCIENCE_SANDBOX,
                researchLoaded: () => true,
                researched: _ => true);
            Assert.Equal(GateOutcome.Pass, gate.Evaluate(Need(KspGateEvaluators.Kinds.TechResearched, "start"), Empty).Outcome);
        }

        [Fact]
        public void ACareerStillLoadingIsUnknownAndSandboxHasEveryNode()
        {
            var loading = new TechResearchedGate(gameMode: () => Game.Modes.CAREER, researchLoaded: () => false);
            var sandbox = new TechResearchedGate(gameMode: () => Game.Modes.SANDBOX, researchLoaded: () => false);
            var requirement = Need(KspGateEvaluators.Kinds.TechResearched, "flightControl");

            Assert.Equal(GateOutcome.Unknown, loading.Evaluate(requirement, Empty).Outcome);
            Assert.Equal(GateOutcome.Pass, sandbox.Evaluate(requirement, Empty).Outcome);
        }

        [Fact]
        public void AModuleNoResearchedPartCarriesNamesTheCheapestNode()
        {
            var carriers = new List<ModuleCarrier>
            {
                new ModuleCarrier("advUnmanned", false),
                new ModuleCarrier("flightControl", false),
                new ModuleCarrier("flightControl", false),
            };
            var costs = new Dictionary<string, TechDescription>
            {
                ["advUnmanned"] = new TechDescription("Advanced Unmanned Tech", 550),
                ["flightControl"] = new TechDescription("Flight Control", 45),
            };

            var verdict = PartModuleResearchedGate.Decide("ModuleExample", carriers, id => costs[id]);

            var missing = Assert.Single(verdict.Missing!);
            Assert.Equal("flightControl", missing.Id);
            Assert.Equal("Flight Control", missing.Name);
        }

        [Fact]
        public void OneResearchedCarrierIsEnough()
        {
            var carriers = new List<ModuleCarrier>
            {
                new ModuleCarrier("advUnmanned", false),
                new ModuleCarrier("flightControl", true),
            };
            Assert.Equal(GateOutcome.Pass, PartModuleResearchedGate.Decide("m", carriers, _ => default).Outcome);
        }

        [Fact]
        public void AModuleNoInstalledPartCarriesIsUnknownNotLocked()
        {
            var verdict = PartModuleResearchedGate.Decide("m", new List<ModuleCarrier>(), _ => default);
            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }
    }
}
