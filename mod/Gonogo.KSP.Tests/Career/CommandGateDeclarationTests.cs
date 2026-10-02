using System.Linq;
using Gonogo.KSP.Gates;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// The declared gates and their evaluators, paired here rather than only at
    /// engine start.
    ///
    /// <para><c>ChannelEngine.ValidateGateDeclarations</c> already throws on a
    /// declared kind with no evaluator, but only inside a running KSP: a typo in
    /// a <c>CommandRequirement.Kind</c> would ship, and the first thing anyone
    /// would know is that the mod refused to start. This pairs the two lists at
    /// build time, off the same source the Uplinks read.</para>
    /// </summary>
    public class CommandGateDeclarationTests
    {
        /// <summary>
        /// A floor, not an equality: a gate may be added. It exists because the
        /// failure this whole exercise is about is a framework with no callers,
        /// and zero declared requirements reads exactly like a passing test.
        /// </summary>
        private const int MinimumDeclaredRequirements = 10;

        [Fact]
        public void EveryDeclaredGateKindHasAnEvaluator()
        {
            var kinds = KspGateEvaluators.All(new NoJudge()).Select(e => e.Kind).ToList();

            var orphans = GateDeclarations.All()
                .SelectMany(entry => entry.Value.Select(r => new { Command = entry.Key, r.Kind }))
                .Where(x => !kinds.Contains(x.Kind))
                .Select(x => $"{x.Command} requires \"{x.Kind}\"")
                .ToList();

            Assert.True(
                orphans.Count == 0,
                "a gate nobody can evaluate is a gate that silently does not exist. "
                    + "Registered kinds: " + string.Join(", ", kinds.OrderBy(k => k)) + ". "
                    + "Orphans: " + string.Join("; ", orphans));
        }

        [Fact]
        public void NoTwoEvaluatorsClaimTheSameKind()
        {
            // ChannelEngine.AddGateEvaluator throws on this, and it would throw
            // at startup rather than here. Which of two evaluators wins would
            // otherwise depend on registration order.
            var kinds = KspGateEvaluators.All(new NoJudge()).Select(e => e.Kind).ToList();
            Assert.Equal(kinds.Count, kinds.Distinct().Count());
            Assert.DoesNotContain(kinds, string.IsNullOrWhiteSpace);
        }

        [Fact]
        public void TheCommandsWithAKnownAuthorityDeclareIt()
        {
            var byCommand = GateDeclarations.All().ToDictionary(e => e.Key, e => e.Value);

            // Career mode is a permanent property of the save, so every
            // career-write control is answerable before it is pressed.
            var careerCommands = byCommand.Keys.Where(k => k.StartsWith("career.")).ToList();
            Assert.Equal(9, careerCommands.Count);
            foreach (var command in careerCommands)
            {
                Assert.Contains(byCommand[command], r => r.Kind == KspGateEvaluators.Kinds.GameMode);
            }

            Assert.Contains(
                byCommand["career.crew.hire"],
                r => r.Kind == KspGateEvaluators.Kinds.FacilityLimit
                    && r.Quantity == KspGateEvaluators.Quantities.ActiveCrew
                    && r.Facility == "AstronautComplex");
            Assert.Contains(
                byCommand["career.contract.accept"],
                r => r.Kind == KspGateEvaluators.Kinds.FacilityLimit
                    && r.Quantity == KspGateEvaluators.Quantities.ActiveContracts
                    && r.Facility == "MissionControl");
            /*
             * Activation declares NO facility limit. It used to, and the entry
             * counted every active strategy against the Administration cap: RP-1
             * exempts Leaders from that cap and spends it on program SLOTS, so
             * the gate darkened a control the game would have allowed. On-screen
             * CanBeActivated asks the same arm and answers with the game's own
             * reason; off-screen the actuator refuses whatever this says.
             */
            Assert.DoesNotContain(
                byCommand["career.strategy.activate"],
                r => r.Kind == KspGateEvaluators.Kinds.FacilityLimit
                    && r.Quantity == KspGateEvaluators.Quantities.ActiveStrategies);
            Assert.Contains(
                byCommand["career.crew.hire"],
                r => r.Kind == KspGateEvaluators.Kinds.Affordable
                    && r.Quantity == KspGateEvaluators.Quantities.RecruitHire);
            foreach (var revert in new[] { "ksp.revertToLaunch", "ksp.revertToEditor" })
            {
                Assert.Contains(
                    byCommand[revert],
                    r => r.Kind == KspGateEvaluators.Kinds.Scene && r.Quantity == "FLIGHT");
            }
            // The flag is asked only after the scene, which is the only scene it describes.
            Assert.Equal(
                new[] { KspGateEvaluators.Kinds.Scene, KspGateEvaluators.Kinds.RevertAvailable },
                byCommand["ksp.revertToLaunch"].Select(r => r.Kind));
            Assert.Equal(KspGateEvaluators.Quantities.RevertToLaunch, byCommand["ksp.revertToLaunch"][1].Quantity);
            Assert.Equal(
                new[] { KspGateEvaluators.Kinds.Scene, KspGateEvaluators.Kinds.RevertAvailable },
                byCommand["ksp.revertToEditor"].Select(r => r.Kind));
            Assert.Equal(KspGateEvaluators.Quantities.RevertToEditor, byCommand["ksp.revertToEditor"][1].Quantity);
            // The facility upgrade runs in every game scene, so it declares none.
            Assert.DoesNotContain(
                byCommand["career.facility.upgrade"],
                r => r.Kind == KspGateEvaluators.Kinds.Scene);
            Assert.Contains(
                byCommand["ksp.recover"],
                r => r.Kind == KspGateEvaluators.Kinds.ClearToSave);
            Assert.Contains(
                byCommand["ksp.launch"],
                r => r.Kind == KspGateEvaluators.Kinds.Scene && r.Quantity.Contains("SPACECENTER"));
            Assert.Contains(
                byCommand["ksp.launch"],
                r => r.Kind == KspGateEvaluators.Kinds.PreFlight
                    && r.Quantity == KspGateEvaluators.Quantities.LaunchSiteClear);
            Assert.Contains(
                byCommand["ksp.launch"],
                r => r.Kind == KspGateEvaluators.Kinds.PreFlight
                    && r.Quantity == KspGateEvaluators.Quantities.FacilityOperational);
        }

        /// <summary>
        /// Every requirement declared today is answerable before the press: with
        /// NO arguments, or per item, through an evaluator that names its items
        /// so the gate report can ask each one. That is what lets a control be
        /// dark with a reason instead of live and doomed. A requirement needing
        /// an argument nobody enumerates would abstain until the dispatch; if
        /// one is added, this assertion is the place to say so deliberately.
        /// </summary>
        [Fact]
        public void EveryDeclaredRequirementIsAskableInAdvance()
        {
            var requirements = GateDeclarations.All().SelectMany(e => e.Value).ToList();
            var itemKinds = KspGateEvaluators.All(new NoJudge())
                .Where(e => e is Sitrep.Contract.ICommandGateItems)
                .Select(e => e.Kind)
                .ToList();

            Assert.True(
                requirements.Count >= MinimumDeclaredRequirements,
                $"only {requirements.Count} requirements are declared; the gate framework spent "
                    + "months with exactly zero and a scan that finds none reads as a pass");

            Assert.All(requirements, r =>
            {
                if (r.Needs.Length == 0) return;
                Assert.Single(r.Needs);
                Assert.Contains(r.Kind, itemKinds);
            });
        }

        /// <summary>The four career commands whose verdict depends on which item is chosen name that item by the argument the client sends.</summary>
        [Fact]
        public void ThePerItemCommandsAreGatedOnTheirItem()
        {
            var byCommand = GateDeclarations.All().ToDictionary(e => e.Key, e => e.Value);
            var expected = new[]
            {
                ("career.facility.upgrade", ItemGates.Kinds.FacilityUpgrade, "facilityId"),
                ("career.tech.unlock", ItemGates.Kinds.TechUnlock, "techId"),
                ("career.strategy.activate", ItemGates.Kinds.StrategyActivate, "strategyId"),
                ("career.strategy.deactivate", ItemGates.Kinds.StrategyDeactivate, "strategyId"),
            };
            foreach (var (command, kind, argument) in expected)
            {
                var requirement = Assert.Single(byCommand[command], r => r.Kind == kind);
                Assert.Equal(new[] { argument }, requirement.Needs);
                // Career mode first, so a sandbox save says so once rather than per item.
                Assert.Equal(KspGateEvaluators.Kinds.GameMode, byCommand[command][0].Kind);
            }
        }

        /// <summary>Evaluators are only constructed here, so the judge they would ask is never reached.</summary>
        [Fact]
        public void WritingAManeuverNodeNeedsBothPlanningBuildingsAndRemovingOneNeedsNeither()
        {
            var byCommand = GateDeclarations.All().ToDictionary(e => e.Key, e => e.Value);

            foreach (var command in new[] { "vessel.maneuver.add", "vessel.maneuver.update" })
            {
                Assert.Contains(
                    byCommand[command],
                    r => r.Kind == KspGateEvaluators.Kinds.OrbitDisplay && r.Quantity == OrbitDisplayGate.PatchedConics);
                Assert.Contains(
                    byCommand[command],
                    r => r.Kind == KspGateEvaluators.Kinds.FacilityUnlocked
                        && r.Facility == "MissionControl"
                        && r.Quantity == KspGateEvaluators.Quantities.FlightPlanning);
            }
            Assert.False(byCommand.ContainsKey("vessel.maneuver.remove"));
        }

        [Fact]
        public void EveryRoboticsCommandNamesTheJointsItDrives()
        {
            var robotics = GateDeclarations.All().Where(e => e.Key.StartsWith("robotics.")).ToList();

            Assert.Equal(9, robotics.Count);
            foreach (var entry in robotics)
            {
                var requirement = Assert.Single(entry.Value);
                Assert.Equal(KspGateEvaluators.Kinds.PartModuleResearched, requirement.Kind);
                var expected = entry.Key.StartsWith("robotics.rotor.") ? "ModuleRoboticServoRotor" : "ModuleRoboticServoHinge";
                Assert.Contains(expected, requirement.Quantity);
            }
        }

        private sealed class NoJudge : ICareerItemJudge
        {
            public Sitrep.Contract.CommandResult JudgeUpgradeFacility(string facilityId) => throw new System.NotSupportedException();

            public Sitrep.Contract.CommandResult JudgeUnlockTech(string techId) => throw new System.NotSupportedException();

            public Sitrep.Contract.CommandResult JudgeActivateStrategy(string strategyId) => throw new System.NotSupportedException();

            public Sitrep.Contract.CommandResult JudgeDeactivateStrategy(string strategyId) => throw new System.NotSupportedException();
        }

        /// <summary>An ungated command gets an empty array, never a null the engine would have to guard.</summary>
        [Fact]
        public void AnUngatedCommandDeclaresNothing()
        {
            Assert.Empty(GateDeclarations.For("ksp.toTrackingStation"));
            Assert.Single(GateDeclarations.For("ksp.toSpaceCenter"));
            Assert.Single(GateDeclarations.For("ksp.switchVessel"));
            Assert.Equal(
                "FLIGHT|TRACKSTATION|SPACECENTER",
                GateDeclarations.For("ksp.switchVessel")[0].Quantity);
            Assert.Empty(GateDeclarations.For("no.such.command"));
        }
    }
}
