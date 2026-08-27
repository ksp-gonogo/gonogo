using System;
using System.Collections.Generic;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Roll out, roll back, scrap and a complex's rush mode, against the
    /// stand-in RP-1 object graph.
    ///
    /// <para>Three cases here decide whether the feature is safe, and each of
    /// them exists because the honest reading of the shipped disassembly is NOT
    /// the one a KCT-shaped guess would produce:</para>
    /// <list type="bullet">
    /// <item><see cref="Rolls_out_without_spending_anything_up_front"/>. A
    /// rollout is billed as it progresses and RP-1's own
    /// <c>IncrementProgress</c> throttles itself to what the career can afford,
    /// so an affordability check here would refuse rollouts the game would start.
    /// A handler that copied the repeat-build command's money discipline would be
    /// wrong in the safe-looking direction.</item>
    /// <item><see cref="Rushing_a_complex_never_touches_a_space_centre_pool"/>.
    /// RP-1 declares <c>ChangeEngineers</c> twice with the same arity, one taking
    /// a complex and one a whole space centre. A resolver matching on arity alone
    /// gets a coin flip, and the wrong side of it silently edits a centre's
    /// staffing.</item>
    /// <item><see cref="Refuses_to_scrap_a_vehicle_that_is_rolling_out"/>. RP-1's
    /// own Scrap button is drawn only when no rollout and no rollback is running,
    /// and the refund is what makes ignoring that expensive.</item>
    /// </list>
    ///
    /// <para>What these cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: they prove the handlers invoke the members they claim
    /// to and refuse where they claim to, and nothing whatever about the values a
    /// running RP-1 would hold.</para>
    /// </summary>
    public class Rp1VehicleCommandsTests : IDisposable
    {
        private readonly Rp1VehicleCommands _commands = new Rp1VehicleCommands();

        public Rp1VehicleCommandsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            Funding.Instance = new Funding { Funds = 1_000_000.0 };
            KCTUtilities.Reset();
            CurrencyModifierQueryRP0.Reset();
            ReconRolloutProject.Reschedules = 0;
        }

        /// <summary>One centre, one operational pad complex with one free pad.</summary>
        private static LaunchComplex Centre(int pads = 1, LaunchComplexType type = LaunchComplexType.Pad)
        {
            var lc = new LaunchComplex { Name = "LC-1", IsOperational = true, LcTypeValue = type };
            for (var i = 0; i < pads; i++)
                lc.LaunchPads.Add(new LCLaunchPad { name = i == 0 ? "LaunchPad" : $"LaunchPad {i + 1}" });
            var ksc = new LCSpaceCenter { KSCName = "Cape Canaveral" };
            ksc.LaunchComplexes.Add(lc);
            SpaceCenterManagement.Instance = new SpaceCenterManagement { ActiveSC = ksc };
            SpaceCenterManagement.Instance.KSCs.Add(ksc);
            return lc;
        }

        /// <summary>A finished vehicle in a complex's warehouse: the only kind that can roll out.</summary>
        private static VesselProject Built(LaunchComplex lc, string name = "Atlas", float cost = 40_000f)
        {
            var vp = new VesselProject { shipName = name, cost = cost, buildPoints = 1000.0, progress = 1000.0 };
            vp.SetComplex(lc);
            lc.Warehouse.Add(vp);
            return vp;
        }

        /// <summary>A vehicle still on the build list.</summary>
        private static VesselProject Integrating(LaunchComplex lc, string name = "Atlas", float cost = 40_000f)
        {
            var vp = new VesselProject { shipName = name, cost = cost, buildPoints = 1000.0 };
            vp.SetComplex(lc);
            lc.BuildList.Add(vp);
            return vp;
        }

        /// <summary>An operation of a given kind already attached to a vehicle.</summary>
        private static ReconRolloutProject Operation(
            LaunchComplex lc,
            VesselProject vp,
            ReconRolloutProject.RolloutReconType type,
            string pad = "LaunchPad")
        {
            var op = new ReconRolloutProject(vp, type, vp.shipID.ToString(), pad);
            lc.Recon_Rollout.Add(op);
            // A pad carrying an operation stops reading Free, which is what
            // RP-1's own State property derives and this fixture sets directly.
            var padObject = lc.LaunchPads.FirstOrDefault(p => p.name == pad);
            if (padObject != null)
            {
                padObject.StateValue = type == ReconRolloutProject.RolloutReconType.Rollback
                    ? LaunchPadState.Rollback
                    : LaunchPadState.Rollout;
            }
            return op;
        }

        /// <summary>
        /// A rollout. The pad defaults to the fixture's first pad HERE, in the
        /// test helper, rather than in the command: the command requires it (see
        /// <see cref="Refuses_a_rollout_that_names_no_pad"/>), and a helper
        /// default keeps every case that is not about pad choice readable.
        /// </summary>
        private CommandResult Rollout(string? id, string? pad = "LaunchPad") =>
            _commands.Rollout(new Rp1RolloutArgs { Id = id, Pad = pad });

        private CommandResult Rollback(string? id) =>
            _commands.Rollback(new Rp1VehicleArgs { Id = id });

        private CommandResult Scrap(string? id) =>
            _commands.Scrap(new Rp1VehicleArgs { Id = id });

        private CommandResult Rush(string? lcId, bool? rushing) =>
            _commands.Rush(new Rp1ComplexRushArgs { LcId = lcId, Rushing = rushing });

        // ── Roll out ────────────────────────────────────────────────────────────

        [Fact]
        public void Rolls_out_without_spending_anything_up_front()
        {
            var lc = Centre();
            var vessel = Built(lc);
            Funding.Instance!.Funds = 5_000.0;

            var result = Rollout(vessel.KCTPersistentID);

            Assert.True(result.Success);
            var operation = Assert.Single(lc.Recon_Rollout);
            Assert.Equal(ReconRolloutProject.RolloutReconType.Rollout, operation.RRType);
            // Attached by shipID, which is NOT the KCTPersistentID the command
            // addressed. Getting these two the wrong way round produces an
            // operation RP-1 can never match back to a vehicle.
            Assert.Equal(vessel.shipID.ToString(), operation.associatedID);
            // A cost is COMPUTED and nothing is charged: the balance is what it
            // was, on a career that could not have afforded the rollout up front.
            Assert.True(operation.cost > 0.0);
            Assert.Equal(5_000.0, Funding.Instance.Funds);
            // The vehicle stays in the warehouse. A rollout is an operation on
            // the complex, not a move between lists.
            Assert.Single(lc.Warehouse);
        }

        [Fact]
        public void Binds_the_vehicle_to_the_pad_it_was_rolled_out_to()
        {
            var lc = Centre(pads: 3);
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID, "LaunchPad 3");

            Assert.True(result.Success);
            Assert.Equal("LaunchPad 3", Assert.Single(lc.Recon_Rollout).launchPadID);
            // The INDEX as well as the name. RP-1's warehouse row resolves which
            // pad a vehicle is bound for through this field, so a rollout that
            // set only the name leaves the game pointing at the wrong pad.
            Assert.Equal(2, vessel.launchSiteIndex);
        }

        [Fact]
        public void Rolls_out_to_the_pad_the_command_named_and_not_another_free_one()
        {
            var lc = Centre(pads: 3);
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID, "LaunchPad 2");

            Assert.True(result.Success);
            Assert.Equal("LaunchPad 2", Assert.Single(lc.Recon_Rollout).launchPadID);
            Assert.Equal(1, vessel.launchSiteIndex);
        }

        [Fact]
        public void Refuses_a_rollout_that_names_no_pad()
        {
            var lc = Centre();
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID, pad: null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Refuses_a_rollout_with_no_pad_even_when_only_one_could_be_meant()
        {
            // OPERATOR RULING, 2026-08-27. An earlier draft used the single free
            // pad here and that was rejected: choosing a launch site is a
            // decision an operator makes, and a mod that picks when the choice
            // looks obvious has taken the decision anyway. Requiring it also puts
            // the chosen pad on the wire, so a dispatch log records where a
            // vehicle was sent rather than leaving it to be inferred.
            var lc = Centre(pads: 1);
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID, pad: null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Theory]
        [InlineData(LaunchPadState.Destroyed, CommandErrorCode.FacilityDamaged)]
        [InlineData(LaunchPadState.Nonoperational, CommandErrorCode.NotReady)]
        [InlineData(LaunchPadState.Reconditioning, CommandErrorCode.NotReady)]
        [InlineData(LaunchPadState.Rollout, CommandErrorCode.SiteOccupied)]
        public void Tells_a_pad_that_needs_repair_from_one_that_needs_waiting(
            LaunchPadState state,
            CommandErrorCode expected)
        {
            var lc = Centre();
            lc.LaunchPads[0].StateValue = state;
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            // Four different next moves hide behind RP-1's one enum, and an
            // operator does entirely different things about "repair it" and
            // "wait for the vehicle already there".
            Assert.Equal(expected, result.ErrorCode);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Refuses_a_pad_that_reads_free_and_has_a_craft_sitting_on_it()
        {
            var lc = Centre();
            lc.LaunchPads[0].Waiting = new Vessel { vesselName = "Vanguard" };
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.SiteOccupied, result.ErrorCode);
            // The one condition the pad's own State cannot see: it reports Free
            // for a pad with no OPERATION on it, and a craft already sent to the
            // launch site sits there in PRELAUNCH with no operation at all.
            Assert.Contains("Vanguard", result.Detail);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Refuses_to_roll_out_a_vehicle_that_is_still_integrating()
        {
            var lc = Centre();
            var vessel = Integrating(lc);

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Refuses_to_roll_out_of_a_hangar()
        {
            var lc = Centre(type: LaunchComplexType.Hangar);
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            // A hangar's vehicles are MOUNTED for air launch, which is a
            // different operation with different preconditions, and RP-1 draws no
            // rollout control for one at all.
            Assert.Contains("air-launched", result.Detail);
        }

        [Fact]
        public void Refuses_a_vehicle_whose_parts_this_install_no_longer_has()
        {
            var lc = Centre();
            var vessel = Built(lc);
            vessel.AllPartsValid = false;

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Quotes_rp1s_own_reasons_when_the_complex_will_not_take_the_vehicle()
        {
            var lc = Centre();
            var vessel = Built(lc);
            vessel.FacilityRefusals.Add("too heavy for this complex");

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotReady, result.ErrorCode);
            Assert.Contains("too heavy for this complex", result.Detail);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Refuses_a_second_rollout_for_a_vehicle_already_on_its_way()
        {
            var lc = Centre();
            var vessel = Built(lc);
            Operation(lc, vessel, ReconRolloutProject.RolloutReconType.Rollout);

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            // One operation, not two. A second would have the complex paying for
            // the same trip twice.
            Assert.Single(lc.Recon_Rollout);
        }

        [Fact]
        public void Rolling_out_a_vehicle_that_is_rolling_back_reverses_it()
        {
            var lc = Centre();
            var vessel = Built(lc);
            var operation = Operation(lc, vessel, ReconRolloutProject.RolloutReconType.Rollback);

            var result = Rollout(vessel.KCTPersistentID);

            Assert.True(result.Success);
            // RP-1's own row does exactly this, and it is what keeps the command
            // a DIRECTION rather than a toggle: whatever the vehicle was doing,
            // rollout ends with it heading for the pad.
            Assert.Equal(ReconRolloutProject.RolloutReconType.Rollout, operation.RRType);
            Assert.Single(lc.Recon_Rollout);
            Assert.Equal(1, ReconRolloutProject.Reschedules);
        }

        [Fact]
        public void Will_not_reverse_a_rollback_onto_a_pad_another_vehicle_has_claimed()
        {
            var lc = Centre();
            var mine = Built(lc, name: "Atlas");
            var theirs = Built(lc, name: "Vanguard");
            var operation = Operation(lc, mine, ReconRolloutProject.RolloutReconType.Rollback);
            lc.Recon_Rollout.Add(
                new ReconRolloutProject(theirs, ReconRolloutProject.RolloutReconType.Rollout, theirs.shipID.ToString(), "LaunchPad"));

            var result = Rollout(mine.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.SiteOccupied, result.ErrorCode);
            // Named, because "the pad is taken" leaves an operator with nothing
            // to do and "Vanguard is rolling out to it" tells them what to move.
            Assert.Contains("Vanguard", result.Detail);
            Assert.Equal(ReconRolloutProject.RolloutReconType.Rollback, operation.RRType);
        }

        [Fact]
        public void Refuses_a_rollout_from_a_complex_that_is_still_being_built()
        {
            var lc = Centre();
            lc.IsOperational = false;
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotReady, result.ErrorCode);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Refuses_a_pad_this_complex_does_not_have()
        {
            var lc = Centre();
            var vessel = Built(lc);

            var result = Rollout(vessel.KCTPersistentID, "Runway");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(lc.Recon_Rollout);
        }

        [Fact]
        public void Treats_a_blank_pad_name_as_no_pad_named_rather_than_as_a_pad_called_nothing()
        {
            var lc = Centre();
            var vessel = Built(lc);

            // A client rendering a text field sends one the first time an
            // operator clears it. Refused as "named no pad", which is what
            // happened, rather than as "no pad called """, which reads as a
            // missing pad and sends an operator looking for one.
            var result = Rollout(vessel.KCTPersistentID, "  ");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Contains("named no pad", result.Detail);
            Assert.Empty(lc.Recon_Rollout);
        }

        // ── Roll back ───────────────────────────────────────────────────────────

        [Fact]
        public void Rolls_a_vehicle_back_off_the_pad()
        {
            var lc = Centre();
            var vessel = Built(lc);
            var operation = Operation(lc, vessel, ReconRolloutProject.RolloutReconType.Rollout);

            var result = Rollback(vessel.KCTPersistentID);

            Assert.True(result.Success);
            Assert.Equal(ReconRolloutProject.RolloutReconType.Rollback, operation.RRType);
            // The reschedule as well as the flip. RP-1's own SwitchDirection asks
            // the maintenance handler to recompute, and a handler that only
            // flipped the enum would look identical from the enum alone.
            Assert.Equal(1, ReconRolloutProject.Reschedules);
            Assert.Equal(1_000_000.0, Funding.Instance!.Funds);
        }

        [Fact]
        public void Refuses_to_roll_back_a_vehicle_that_is_already_rolling_back()
        {
            var lc = Centre();
            var vessel = Built(lc);
            var operation = Operation(lc, vessel, ReconRolloutProject.RolloutReconType.Rollback);

            var result = Rollback(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            // SwitchDirection is symmetric, so a command built straight onto it
            // would send this vehicle back OUT to the pad and report success.
            Assert.Equal(ReconRolloutProject.RolloutReconType.Rollback, operation.RRType);
            Assert.Equal(0, ReconRolloutProject.Reschedules);
        }

        [Fact]
        public void Refuses_to_roll_back_a_vehicle_that_never_left()
        {
            var lc = Centre();
            var vessel = Built(lc);

            var result = Rollback(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
        }

        [Fact]
        public void Does_not_mistake_another_vehicles_rollout_for_this_ones()
        {
            var lc = Centre();
            var mine = Built(lc, name: "Atlas");
            var theirs = Built(lc, name: "Vanguard");
            Operation(lc, theirs, ReconRolloutProject.RolloutReconType.Rollout);

            var result = Rollback(mine.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Equal(0, ReconRolloutProject.Reschedules);
        }

        [Fact]
        public void Ignores_a_pads_reconditioning_when_looking_for_a_vehicles_operation()
        {
            var lc = Centre();
            var vessel = Built(lc);
            // Reconditioning has no vehicle. RP-1 stamps it with the PAD's id, so
            // a walk matching on associatedID alone would attribute a pad's
            // maintenance to whichever vehicle happened to share the complex.
            lc.Recon_Rollout.Add(new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Reconditioning,
                associatedID = vessel.shipID.ToString(),
            });

            var rollout = Rollout(vessel.KCTPersistentID);

            Assert.True(rollout.Success);
            Assert.Equal(2, lc.Recon_Rollout.Count);
        }

        // ── Scrap ───────────────────────────────────────────────────────────────

        [Fact]
        public void Scraps_a_finished_vehicle_and_refunds_it_in_full()
        {
            var lc = Centre();
            var vessel = Built(lc, cost: 40_000f);
            Funding.Instance!.Funds = 10_000.0;

            var result = Scrap(vessel.KCTPersistentID);

            Assert.True(result.Success);
            Assert.Empty(lc.Warehouse);
            // RP-1 PAYS the career for a scrap, which is why this command needs
            // no affordability check of any kind and why it needs a confirm.
            Assert.Equal(50_000.0, Funding.Instance.Funds);
        }

        [Fact]
        public void Scraps_a_vehicle_that_is_still_integrating()
        {
            var lc = Centre();
            var vessel = Integrating(lc, cost: 40_000f);
            Funding.Instance!.Funds = 10_000.0;

            var result = Scrap(vessel.KCTPersistentID);

            Assert.True(result.Success);
            // Both lists, because RP-1's own Scrap button is drawn on both: a
            // queue filled by mistake is exactly what this corrects.
            Assert.Empty(lc.BuildList);
            Assert.Equal(50_000.0, Funding.Instance.Funds);
        }

        [Fact]
        public void Refuses_to_scrap_a_vehicle_that_is_rolling_out()
        {
            var lc = Centre();
            var vessel = Built(lc);
            Operation(lc, vessel, ReconRolloutProject.RolloutReconType.Rollout);
            Funding.Instance!.Funds = 10_000.0;

            var result = Scrap(vessel.KCTPersistentID);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            // RP-1's own rule, not a caution added here. Scrapping a vehicle on
            // its way to a pad leaves the operation attached to nothing.
            Assert.Single(lc.Warehouse);
            Assert.Equal(10_000.0, Funding.Instance.Funds);
        }

        [Fact]
        public void Says_the_vehicle_may_be_gone_when_the_scrap_throws_part_way()
        {
            var lc = Centre();
            var vessel = Built(lc);
            KCTUtilities.ThrowOnScrap = true;

            var result = Scrap(vessel.KCTPersistentID);

            Assert.False(result.Success);
            // The refund is the LAST thing ScrapVessel does, so a throw between
            // the removal and the payment loses a vehicle and pays nothing. An
            // operator who read a plain "refused" would go looking for it.
            Assert.Contains("part-way", result.Detail);
            Assert.Empty(lc.Warehouse);
        }

        // ── Rush ────────────────────────────────────────────────────────────────

        [Fact]
        public void Rushing_a_complex_never_touches_a_space_centre_pool()
        {
            var lc = Centre();
            var centre = SpaceCenterManagement.Instance!.ActiveSC!;
            lc.Engineers = 20;
            centre.Engineers = 60;

            var result = Rush(lc.ID.ToString(), rushing: true);

            Assert.True(result.Success);
            Assert.True(lc.IsRushing);
            // The recalculation RP-1's own toggle fires, and the SUBJECT of it.
            // RP-1 has a same-arity ChangeEngineers taking a space CENTRE, so a
            // resolver matching on arity alone would edit centre staffing while
            // a call counter looked perfectly correct.
            var change = Assert.Single(KCTUtilities.EngineerChanges);
            Assert.Same(lc, change.Key);
            Assert.Equal(0, change.Value);
            Assert.Equal(20, lc.Engineers);
            Assert.Equal(60, centre.Engineers);
        }

        [Fact]
        public void Takes_a_complex_back_out_of_rush_mode()
        {
            var lc = Centre();
            lc.IsRushing = true;

            var result = Rush(lc.ID.ToString(), rushing: false);

            Assert.True(result.Success);
            Assert.False(lc.IsRushing);
        }

        [Fact]
        public void Setting_the_mode_it_is_already_in_is_not_an_error()
        {
            var lc = Centre();
            lc.IsRushing = true;

            var result = Rush(lc.ID.ToString(), rushing: true);

            // A SET, not a toggle. An operator commanding on a view that is
            // already stale gets the state they asked for either way, which is
            // the property that makes it safe to re-send.
            Assert.True(result.Success);
            Assert.True(lc.IsRushing);
        }

        [Fact]
        public void Refuses_a_rush_that_does_not_say_which_way()
        {
            var lc = Centre();

            var result = Rush(lc.ID.ToString(), rushing: null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.False(lc.IsRushing);
            Assert.Empty(KCTUtilities.EngineerChanges);
        }

        [Fact]
        public void Refuses_a_rush_for_a_complex_that_does_not_exist()
        {
            Centre();

            var result = Rush(Guid.NewGuid().ToString(), rushing: true);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(KCTUtilities.EngineerChanges);
        }

        [Fact]
        public void Rushes_the_named_complex_and_not_its_neighbour()
        {
            var first = Centre();
            var second = new LaunchComplex { Name = "LC-2", IsOperational = true };
            SpaceCenterManagement.Instance!.ActiveSC!.LaunchComplexes.Add(second);

            var result = Rush(second.ID.ToString(), rushing: true);

            Assert.True(result.Success);
            Assert.True(second.IsRushing);
            Assert.False(first.IsRushing);
        }

        // ── Shared refusals ─────────────────────────────────────────────────────

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        public void Every_vehicle_command_refuses_an_unnamed_vehicle(string? id)
        {
            Centre();

            foreach (var result in new[] { Rollout(id), Rollback(id), Scrap(id) })
            {
                Assert.False(result.Success);
                Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            }
        }

        [Fact]
        public void Every_command_refuses_a_save_rp1_is_not_managing()
        {
            var lc = Centre();
            var vessel = Built(lc);
            SpaceCenterManagement.Instance!.enabledForSave = false;

            var results = new List<CommandResult>
            {
                Rollout(vessel.KCTPersistentID),
                Rollback(vessel.KCTPersistentID),
                Scrap(vessel.KCTPersistentID),
                Rush(lc.ID.ToString(), rushing: true),
            };

            Assert.All(results, result =>
            {
                Assert.False(result.Success);
                Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            });
            Assert.Empty(lc.Recon_Rollout);
            Assert.Single(lc.Warehouse);
            Assert.False(lc.IsRushing);
        }

        [Fact]
        public void Every_command_refuses_when_rp1s_space_centre_is_not_loaded()
        {
            SpaceCenterManagement.Instance = null;

            var results = new List<CommandResult>
            {
                Rollout("anything"),
                Rollback("anything"),
                Scrap("anything"),
                Rush(Guid.NewGuid().ToString(), rushing: true),
            };

            Assert.All(results, result =>
            {
                Assert.False(result.Success);
                Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            });
        }

        [Fact]
        public void Finds_a_vehicle_at_a_second_space_centre()
        {
            var first = Centre();
            var other = new LCSpaceCenter { KSCName = "Baikonur" };
            var otherLc = new LaunchComplex { Name = "Site 1", IsOperational = true };
            otherLc.LaunchPads.Add(new LCLaunchPad { name = "Site 1/5" });
            other.LaunchComplexes.Add(otherLc);
            SpaceCenterManagement.Instance!.KSCs.Add(other);
            var vessel = Built(otherLc);

            // The other centre's pad has its own name, so this also pins that the
            // pad is resolved against the complex holding the VEHICLE rather than
            // against the active centre's complex.
            var result = Rollout(vessel.KCTPersistentID, "Site 1/5");

            Assert.True(result.Success);
            // RP-1 supports several centres (KSCSwitcher), so a walk that stopped
            // at the active one would report a real vehicle as not found.
            Assert.Single(otherLc.Recon_Rollout);
            Assert.Empty(first.Recon_Rollout);
        }

        [Fact]
        public void Both_availability_flags_are_true_against_the_full_stand_in()
        {
            // The stand-in carries every type and member both flags test, so a
            // false here means a name in the production resolver stopped matching
            // the disassembly rather than that a test set up the wrong world.
            Assert.True(_commands.IsAvailable);
            Assert.True(_commands.IsMoveAvailable);
        }
    }
}
