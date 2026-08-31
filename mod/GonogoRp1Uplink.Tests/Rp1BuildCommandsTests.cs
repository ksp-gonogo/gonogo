using System;
using System.Collections.Generic;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The repeat-build command, run against the stand-in RP-1 object graph.
    ///
    /// <para>The case that decides whether this feature is safe is
    /// <see cref="Refuses_and_charges_nothing_when_the_career_cannot_afford_it"/>.
    /// RP-1's own <c>KCTUtilities.SpendFunds</c> performs NO affordability test:
    /// its body is an <c>AddFunds</c> of the negative amount, and the test lives
    /// in the popup-driven validator this handler deliberately does not call. So
    /// a handler that only reproduced the visible half of RP-1's Duplicate button
    /// would drive a career into negative funds and RP-1 would never say a word
    /// about it.</para>
    ///
    /// <para>What these cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: they prove the handler invokes the members it claims to
    /// and refuses where it claims to, and nothing whatever about the values a
    /// running RP-1 would hold.</para>
    /// </summary>
    public class Rp1BuildCommandsTests : IDisposable
    {
        private readonly Rp1BuildCommands _commands = new Rp1BuildCommands();

        public Rp1BuildCommandsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            Funding.Instance = new Funding { Funds = 1_000_000.0 };
            KCTUtilities.Reset();
            CurrencyModifierQueryRP0.Reset();
        }

        /// <summary>One centre, one operational complex, registered as the live SCM.</summary>
        private static LaunchComplex Centre(bool operational = true)
        {
            var lc = new LaunchComplex { Name = "LC-1", IsOperational = operational };
            var ksc = new LCSpaceCenter { KSCName = "Cape Canaveral" };
            ksc.LaunchComplexes.Add(lc);
            SpaceCenterManagement.Instance = new SpaceCenterManagement { ActiveSC = ksc };
            SpaceCenterManagement.Instance.KSCs.Add(ksc);
            return lc;
        }

        /// <summary>A vehicle on a complex's build list.</summary>
        private static VesselProject Integrating(LaunchComplex lc, string name = "Atlas", float cost = 40_000f)
        {
            var vp = new VesselProject { shipName = name, cost = cost, buildPoints = 1000.0 };
            vp.SetComplex(lc);
            lc.BuildList.Add(vp);
            return vp;
        }

        /// <summary>A vehicle in a complex's warehouse: finished, and the usual thing an operator repeats.</summary>
        private static VesselProject Built(LaunchComplex lc, string name = "Atlas", float cost = 40_000f)
        {
            var vp = new VesselProject { shipName = name, cost = cost, buildPoints = 1000.0 };
            vp.SetComplex(lc);
            lc.Warehouse.Add(vp);
            return vp;
        }

        private CommandResult Repeat(string? id) =>
            _commands.Repeat(new Rp1BuildRepeatArgs { Id = id });

        [Fact]
        public void Builds_another_copy_of_a_finished_vehicle_onto_the_build_list()
        {
            var lc = Centre();
            var original = Built(lc);

            var result = Repeat(original.KCTPersistentID);

            Assert.True(result.Success);
            var copy = Assert.Single(lc.BuildList);
            Assert.Equal("Atlas", copy.shipName);
            // A copy, not the original moved: the warehouse vehicle is still
            // there and still flyable, which is the whole point of building
            // another rather than rebuilding this one.
            Assert.Single(lc.Warehouse);
            Assert.NotEqual(original.KCTPersistentID, copy.KCTPersistentID);
        }

        [Fact]
        public void Charges_the_price_rp1_arrives_at_rather_than_the_stored_cost()
        {
            // Leaders and strategies move what a vessel purchase costs, so the
            // figure on the vehicle is a list price. At a multiplier of 1.0 a
            // handler reading the wrong one passes anyway; at 0.5 it cannot.
            CurrencyModifierQueryRP0.Multiplier = 0.5;
            var lc = Centre();
            var original = Built(lc, cost: 40_000f);
            Funding.Instance!.Funds = 100_000.0;

            var result = Repeat(original.KCTPersistentID);

            Assert.True(result.Success);
            // The fixture's add spends the LIST price, exactly as RP-1's does;
            // what the query decides is whether the career could bear the CHARGE.
            Assert.Equal(60_000.0, Funding.Instance.Funds);
        }

        [Fact]
        public void Repeats_a_vehicle_that_is_still_integrating()
        {
            var lc = Centre();
            var original = Integrating(lc);

            var result = Repeat(original.KCTPersistentID);

            Assert.True(result.Success);
            Assert.Equal(2, lc.BuildList.Count);
        }

        [Fact]
        public void Refuses_and_charges_nothing_when_the_career_cannot_afford_it()
        {
            var lc = Centre();
            var original = Built(lc, cost: 40_000f);
            Funding.Instance!.Funds = 1_000.0;

            var result = Repeat(original.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.InsufficientFunds, result.ErrorCode);
            Assert.Empty(lc.BuildList);
            Assert.Equal(1_000.0, Funding.Instance.Funds);
            // Both numbers, because the code alone cannot say how short.
            var breach = Assert.IsType<LimitBreach>(result.Breach);
            Assert.Equal(40_000.0, breach.Actual);
            Assert.Equal(1_000.0, breach.Limit);
            Assert.Equal(Units.Funds, breach.Unit);
        }

        [Fact]
        public void Refuses_and_charges_nothing_when_the_price_cannot_be_computed()
        {
            CurrencyModifierQueryRP0.ThrowOnQuery = true;
            var lc = Centre();
            var original = Built(lc);

            var result = Repeat(original.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(lc.BuildList);
            Assert.Equal(1_000_000.0, Funding.Instance!.Funds);
        }

        [Fact]
        public void Refuses_a_vehicle_no_complex_holds()
        {
            var lc = Centre();
            Built(lc);

            var result = Repeat("not-an-id-any-vehicle-carries");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(lc.BuildList);
        }

        [Fact]
        public void Refuses_an_empty_id_rather_than_picking_a_vehicle()
        {
            var lc = Centre();
            Built(lc);

            var result = Repeat(null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(lc.BuildList);
        }

        [Fact]
        public void Refuses_while_the_complex_is_being_built_or_renovated()
        {
            var lc = Centre(operational: false);
            var original = Built(lc);

            var result = Repeat(original.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotReady, result.ErrorCode);
            Assert.Contains("LC-1", result.Detail);
            Assert.Empty(lc.BuildList);
        }

        [Fact]
        public void Refuses_in_rp1s_own_words_when_the_complex_will_not_take_the_vehicle()
        {
            // The check that can change AFTER a vehicle is integrated: modifying
            // a complex moves the envelope it accepts, so a design it built last
            // year is not one it will build today. Without this the build starts,
            // the funds go, and the launch gate refuses the article at the pad.
            var lc = Centre();
            var original = Built(lc);
            original.FacilityRefusals.Add("Mass limit exceeded, currently at 120.00 tons, max 90.00");

            var result = Repeat(original.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotReady, result.ErrorCode);
            Assert.Contains("Mass limit exceeded", result.Detail);
            Assert.Empty(lc.BuildList);
            Assert.Equal(1_000_000.0, Funding.Instance!.Funds);
        }

        [Fact]
        public void Refuses_a_vehicle_rp1_has_no_stored_craft_for()
        {
            var lc = Centre();
            var original = Built(lc);
            original.ClearStoredDesign();

            var result = Repeat(original.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotReady, result.ErrorCode);
            Assert.Empty(lc.BuildList);
        }

        [Fact]
        public void Says_the_career_may_already_have_been_charged_when_the_add_fails_part_way()
        {
            KCTUtilities.ThrowOnAdd = true;
            var lc = Centre();
            var original = Built(lc);

            var result = Repeat(original.KCTPersistentID);

            Assert.False(result.Success);
            // A bare "refused" would invite a retry, and RP-1's add spends before
            // it appends, so a retry after this one pays twice.
            Assert.Contains("balance", result.Detail);
            Assert.Contains("the complex rejected the vehicle", result.Detail);
        }

        [Fact]
        public void Refuses_on_a_save_rp1_is_not_managing()
        {
            var lc = Centre();
            var original = Built(lc);
            SpaceCenterManagement.Instance!.enabledForSave = false;

            var result = Repeat(original.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(lc.BuildList);
        }

        [Fact]
        public void Finds_the_vehicle_at_whichever_centre_holds_it()
        {
            // RP-1 supports several space centres through KSCSwitcher, and a
            // command centre may be commanding one it is not standing in.
            var first = Centre();
            var second = new LaunchComplex { Name = "LC-2" };
            var other = new LCSpaceCenter { KSCName = "Woomera" };
            other.LaunchComplexes.Add(second);
            SpaceCenterManagement.Instance!.KSCs.Add(other);
            var original = Built(second, name: "Black Arrow");

            var result = Repeat(original.KCTPersistentID);

            Assert.True(result.Success);
            Assert.Empty(first.BuildList);
            Assert.Equal("Black Arrow", Assert.Single(second.BuildList).shipName);
        }

        // ── The gate ──────────────────────────────────────────────────────────

        [Fact]
        public void Gate_passes_while_rp1_is_managing_the_save()
        {
            Centre();

            var verdict = _commands.Evaluate(Rp1BuildCommands.Requirements()[0], NoArgs);

            Assert.Equal(GateOutcome.Pass, verdict.Outcome);
        }

        [Fact]
        public void Gate_darkens_the_control_on_a_save_rp1_is_not_managing()
        {
            Centre();
            SpaceCenterManagement.Instance!.enabledForSave = false;

            var verdict = _commands.Evaluate(Rp1BuildCommands.Requirements()[0], NoArgs);

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.ModeUnavailable, verdict.ErrorCode);
        }

        [Fact]
        public void Gate_answers_unknown_rather_than_blocked_while_the_scene_is_coming_up()
        {
            // No SCM instance. Unknown leaves the control live: an absent
            // authority is a read that failed, never the game's judgement, and a
            // Fail here would permanently dark a working control.
            var verdict = _commands.Evaluate(Rp1BuildCommands.Requirements()[0], NoArgs);

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }

        [Fact]
        public void Gate_requirement_is_answerable_with_no_arguments()
        {
            // Needs empty is what lets the engine evaluate this for the
            // addressability sample, which is the only way a control can be dark
            // BEFORE anyone presses it.
            var requirement = Assert.Single(Rp1BuildCommands.Requirements());
            Assert.Empty(requirement.Needs);
            Assert.Equal(Rp1BuildCommands.GateKind, requirement.Kind);
        }

        // ── The manifest ──────────────────────────────────────────────────────

        [Fact]
        public void Declares_every_write_command_undelayed_and_gated()
        {
            var declarations = new Rp1ScUplink().Manifest.Commands;

            Assert.Equal(
                new[]
                {
                    Rp1BuildCommands.RepeatCommand,
                    Rp1BuildStartCommands.StartCommand,
                    Rp1VehicleCommands.RolloutCommand,
                    Rp1VehicleCommands.RollbackCommand,
                    Rp1VehicleCommands.ScrapCommand,
                    Rp1VehicleCommands.RushCommand,
                    Rp1PersonnelCommands.AssignCommand,
                    Rp1FacilityUpgradeCommands.UpgradeCommand,
                    Rp1ResearchCommands.ResearchCommand,
                    Rp1StrategyCommands.ActivateCommand,
                    Rp1TargetCommands.CancelHireCommand,
                    Rp1TargetCommands.CancelFundCommand,
                    Rp1TargetCommands.SetHireCommand,
                    Rp1TargetCommands.SetFundCommand,
                    Rp1TrainingCommands.EnrolCommand,
                    Rp1TrainingCommands.CancelCommand,
                    Rp1TrainingCommands.RemoveCommand,
                    Rp1ComplexLifecycleCommands.RenameComplexCommand,
                    Rp1ComplexLifecycleCommands.DismantleComplexCommand,
                    Rp1ComplexLifecycleCommands.RenamePadCommand,
                    Rp1ComplexLifecycleCommands.DismantlePadCommand,
                    Rp1ComplexConstructionCommands.NewComplexCommand,
                    Rp1ComplexConstructionCommands.ModifyComplexCommand,
                    Rp1ComplexConstructionCommands.NewPadCommand,
                    Rp1WarpCommands.ToCompleteCommand,
                    Rp1WarpCommands.ToFundTargetCommand,
                },
                declarations.Select(d => d.Command).ToArray());
            Assert.All(declarations, declaration =>
            {
                // Ground-side KSC bookkeeping, like core's own nine career writes:
                // light-time separates a command centre from a CRAFT, and there is
                // no craft in any of these.
                Assert.False(declaration.Delayed);
                // Every one of them declares that RP-1 is managing the save, and
                // that is the only condition evaluable before the press for six
                // of the eight. Starting a build from a craft file declares a
                // second, because it also needs an install that can OPEN a craft
                // file, and that is core's rather than RP-1's. Upgrading a
                // facility declares a second for a different reason: the tiers
                // and prices it works from exist at the space centre only.
                Assert.Contains(
                    Rp1BuildCommands.GateKind,
                    declaration.Requires.Select(r => r.Kind).ToArray());
                Assert.All(declaration.Requires, requirement => Assert.Empty(requirement.Needs));
            });

            var start = declarations.Single(d => d.Command == Rp1BuildStartCommands.StartCommand);
            Assert.Equal(
                new[] { Rp1BuildCommands.GateKind, Rp1BuildStartCommands.GateKind },
                start.Requires.Select(r => r.Kind).ToArray());

            var upgrade = declarations.Single(d => d.Command == Rp1FacilityUpgradeCommands.UpgradeCommand);
            Assert.Equal(
                new[] { Rp1BuildCommands.GateKind, Rp1FacilityUpgradeCommands.GateKind },
                upgrade.Requires.Select(r => r.Kind).ToArray());
        }

        [Fact]
        public void Every_declared_requirement_has_an_evaluator_in_this_uplink()
        {
            // A declared kind with no evaluator is a startup failure for the whole
            // mod, and the pairing is only checked once every Uplink has
            // registered, so nothing else in this repo fails first.
            //
            // IN THIS UPLINK, and that is the assertion rather than a convenient
            // scoping. Core does ship kinds an Uplink could name, and naming one
            // would bet every other Uplink's startup on a spelling nothing here
            // can check: the constants live in an assembly an Uplink may not
            // reference. So a condition this Uplink wants is a kind this Uplink
            // declares and answers, and this list is what keeps that true.
            var kinds = new Rp1ScUplink().Manifest.Commands
                .SelectMany(c => c.Requires)
                .Select(r => r.Kind)
                .Distinct();

            Assert.Equal(
                new[]
                {
                    Rp1BuildCommands.GateKind,
                    Rp1BuildStartCommands.GateKind,
                    Rp1FacilityUpgradeCommands.GateKind,
                    Rp1WarpCommands.GateKind,
                },
                kinds.ToArray());
        }

        private static readonly IGateArguments NoArgs = new EmptyArguments();

        /// <summary>The addressability sample's bag: nothing in it at all.</summary>
        private sealed class EmptyArguments : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }
    }
}
