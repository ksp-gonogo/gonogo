using System.Collections.Generic;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// What the two facility gates answer when there is no
    /// <c>ScenarioUpgradeableFacilities</c> to read.
    ///
    /// <para><b>The bug.</b> That scenario is declared
    /// <c>[KSPScenario((ScenarioCreationOptions)1056, ...)]</c>, which is
    /// <c>AddToNewMissionGames | AddToNewCareerGames</c>, so its <c>Instance</c>
    /// is null in a sandbox save. Both gates guarded on that null and answered
    /// Unknown, and Unknown refuses at dispatch. The consequence was not that a
    /// sandbox player could not upgrade a building - there is nothing to upgrade
    /// - it was that a capability gated on a facility TIER was refused in the one
    /// mode where every facility is already at its ceiling. Flight planning is
    /// Mission Control's; patched conics is the Tracking Station's; sandbox has
    /// both, maximally, from the first second.</para>
    ///
    /// <para><b>And the case it must NOT break.</b> A career save whose scenario
    /// has not woken up yet presents the same null, and there "max" would be a
    /// lie. The mode tells them apart because the mode is what KSP itself decides
    /// scenario existence from (<c>Game.CreateNew</c> and
    /// <c>Game.UpdateScenarioModules</c> both switch on it), and
    /// <c>Game.Mode</c> is a plain field on the save that is set before any
    /// scenario module exists. So both halves are asserted here: widening Pass
    /// past sandbox would be the same bug pointing the other way.</para>
    ///
    /// <para>The two live reads arrive through the gates' constructor seam. They
    /// have to: <c>HighLogic.CurrentGame</c>'s setter is a no-op without a
    /// <c>HighLogic</c> MonoBehaviour, so a headless test cannot present a
    /// sandbox game to the statics at all, and a branch nothing can execute is a
    /// claim with no evidence.</para>
    /// </summary>
    public class FacilityTierGateTests
    {
        /// <summary>The addressability bag: no arguments at all, as the engine samples with.</summary>
        private sealed class NoArguments : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }

        private static readonly IGateArguments Empty = new NoArguments();

        /// <summary>
        /// A <see cref="GateOutcome"/>'s name, spelled out rather than asked for.
        ///
        /// <para>Nothing in this process can RENDER one. The type is reached
        /// through Sitrep.Contract's netstandard2.0 build, where it carries
        /// <c>[TsEnum]</c>, and <c>Reinforced.Typings</c> is a build-only
        /// dependency that is not beside the test binary, so anything that walks
        /// the enum's attributes throws <c>FileNotFoundException</c>: both
        /// <c>Enum.ToString</c> (via its <c>[Flags]</c> probe) and xUnit's own
        /// argument formatter, which is why an <c>Assert.Equal</c> on one fails
        /// with the same unreadable sentence on both sides. This file is about
        /// four outcomes that are easy to confuse, and a failure that names
        /// neither of them is a failure nobody can act on.
        /// <c>Sitrep.Host.IntegrationTests</c> sidesteps the same thing by
        /// asserting on <c>(int)</c>.</para>
        /// </summary>
        private static string Name(GateOutcome outcome)
        {
            switch (outcome)
            {
                case GateOutcome.Pass: return "Pass";
                case GateOutcome.Fail: return "Fail";
                case GateOutcome.Abstain: return "Abstain";
                case GateOutcome.Unknown: return "Unknown";
                default: return "outcome " + (int)outcome;
            }
        }

        /// <summary>Asserts the outcome, and says which one arrived when it is the wrong one.</summary>
        private static void AssertOutcome(GateOutcome expected, GateVerdict verdict, string because)
        {
            Assert.True(
                verdict.Outcome == expected,
                $"{because}: expected {Name(expected)}, got {Name(verdict.Outcome)}"
                    + (string.IsNullOrEmpty(verdict.Detail) ? "" : $" (\"{verdict.Detail}\")"));
        }

        private static GateVerdict Unlocked(Game.Modes? mode, string quantity = "flightPlanning") =>
            new FacilityUnlockedGate(scenarioLoaded: () => false, gameMode: () => mode)
                .Evaluate(
                    CareerGates.FacilityUnlocked(SpaceCenterFacility.MissionControl, quantity), Empty);

        private static GateVerdict Limit(Game.Modes? mode) =>
            new FacilityLimitGate(scenarioLoaded: () => false, gameMode: () => mode)
                .Evaluate(
                    CareerGates.FacilityLimit(
                        SpaceCenterFacility.AstronautComplex,
                        KspGateEvaluators.Quantities.ActiveCrew),
                    Empty);

        [Theory]
        [InlineData(Game.Modes.SANDBOX)]
        [InlineData(Game.Modes.SCIENCE_SANDBOX)]
        public void ACapabilityGatedOnAFacilityTierIsUnlockedInASaveWithNoTiers(Game.Modes mode)
        {
            // Pass, and not merely "not Fail": Unknown is the answer this
            // replaces, and it refuses at dispatch just as thoroughly while
            // rendering the control as though nothing were wrong.
            AssertOutcome(
                GateOutcome.Pass,
                Unlocked(mode),
                $"flight planning in a {mode} save, where Mission Control is at its ceiling");
        }

        [Theory]
        [InlineData(Game.Modes.SANDBOX)]
        [InlineData(Game.Modes.SCIENCE_SANDBOX)]
        public void AFacilityLimitIsNotBreachedInASaveWithNoTiers(Game.Modes mode)
        {
            AssertOutcome(
                GateOutcome.Pass,
                Limit(mode),
                $"the crew cap in a {mode} save, where there is no tier to impose one");
        }

        /// <summary>
        /// The half that keeps this from being a fail-open. Career and mission
        /// both GET the scenario, so a null Instance there is a load in progress
        /// and there is no honest answer yet.
        /// </summary>
        [Theory]
        [InlineData(Game.Modes.CAREER)]
        [InlineData(Game.Modes.MISSION)]
        [InlineData(Game.Modes.MISSION_BUILDER)]
        [InlineData(Game.Modes.SCENARIO)]
        [InlineData(Game.Modes.SCENARIO_NON_RESUMABLE)]
        [InlineData(null)]
        public void AMissingScenarioAnywhereElseIsStillUnknown(Game.Modes? mode)
        {
            AssertOutcome(
                GateOutcome.Unknown, Unlocked(mode), $"a {mode} save with the scenario not yet loaded");
            AssertOutcome(
                GateOutcome.Unknown, Limit(mode), $"a {mode} save with the scenario not yet loaded");
        }

        /// <summary>
        /// A declaration KSP cannot make sense of is answered the same way in
        /// every mode. Deciding the tiers first would have let sandbox pass a
        /// typo confidently, which is the failure mode this whole change is
        /// about, one level down.
        /// </summary>
        [Fact]
        public void ADeclarationNamingSomethingKspDoesNotHaveIsUnknownEvenInSandbox()
        {
            AssertOutcome(
                GateOutcome.Unknown,
                Unlocked(Game.Modes.SANDBOX, quantity: "teleportation"),
                "a capability KSP has no switch for, in sandbox");

            var noSuchFacility = new FacilityUnlockedGate(
                    scenarioLoaded: () => false, gameMode: () => Game.Modes.SANDBOX)
                .Evaluate(
                    new CommandRequirement
                    {
                        Kind = KspGateEvaluators.Kinds.FacilityUnlocked,
                        Facility = "OrbitalShipyard",
                        Quantity = KspGateEvaluators.Quantities.FlightPlanning,
                    },
                    Empty);
            AssertOutcome(
                GateOutcome.Unknown, noSuchFacility, "a facility KSP does not have, in sandbox");
        }

        /// <summary>
        /// Every mode <c>Game.Modes</c> has is decided one way or the other, so
        /// a mode KSP adds later cannot arrive as a silent Pass. The list is the
        /// enum itself rather than a copy of it.
        /// </summary>
        [Fact]
        public void EveryGameModeGetsADecision()
        {
            var maxed = new List<Game.Modes>();
            foreach (Game.Modes mode in System.Enum.GetValues(typeof(Game.Modes)))
            {
                var outcome = Unlocked(mode).Outcome;
                Assert.True(
                    outcome == GateOutcome.Pass || outcome == GateOutcome.Unknown,
                    $"{mode} answered {Name(outcome)} with no facilities scenario, which is neither "
                        + "\"this save has no tiers\" nor \"cannot tell yet\"");
                if (outcome == GateOutcome.Pass) maxed.Add(mode);
            }

            Assert.Equal(
                "SANDBOX, SCIENCE_SANDBOX",
                string.Join(", ", maxed));
        }

        /// <summary>
        /// The scenario BEING there is still read live, in every mode. The seam
        /// exists to present its absence, and a seam that changed the present
        /// case would have made the other tests meaningless.
        /// </summary>
        [Fact]
        public void APresentScenarioIsStillReadLive()
        {
            // ScenarioUpgradeableFacilities.Instance is null in this process, so
            // the live read past the tier decision reaches GameVariables and
            // finds nothing. Unknown for THAT reason, not for the scenario's.
            var verdict = new FacilityUnlockedGate(
                    scenarioLoaded: () => true, gameMode: () => Game.Modes.SANDBOX)
                .Evaluate(
                    CareerGates.FacilityUnlocked(
                        SpaceCenterFacility.MissionControl,
                        KspGateEvaluators.Quantities.FlightPlanning),
                    Empty);

            AssertOutcome(GateOutcome.Unknown, verdict, "a present scenario, read live");
            Assert.Equal("GameVariables is not loaded", verdict.Detail);
        }
    }
}
