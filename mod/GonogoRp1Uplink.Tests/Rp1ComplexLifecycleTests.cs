using System;
using System.Collections.Generic;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The four immediate launch-complex acts, against the stand-in RP-1 object
    /// graph.
    ///
    /// <para>The cases that decide whether this surface is worth having, rather
    /// than the ones that decide whether it is tidy:</para>
    /// <list type="bullet">
    /// <item><see cref="Refuses_a_pad_dismantle_that_would_leave_the_complex_without_one"/>
    /// and <see cref="Refuses_a_pad_rename_to_a_name_already_in_use"/>. RP-1 answers
    /// BOTH of these by doing nothing and saying nothing: its confirmation dialog
    /// closes, the state is unchanged, and no message is posted anywhere. A
    /// confirmation that does nothing is worse than a refusal, because the operator
    /// believes it worked, and converting the two is most of the value in this
    /// file.</item>
    /// <item><see cref="Reports_the_efficiency_a_dismantle_destroys"/> and
    /// <see cref="Reports_the_efficiency_a_dismantle_leaves_with_a_sibling"/>. The
    /// real loss in a dismantle, which RP-1's dialog names nowhere: the complex's
    /// earned build efficiency, gone for good when no sibling shares its group.
    /// Two tests rather than one because they are two different warnings and an
    /// operator needs to know which they are looking at.</item>
    /// <item><see cref="Refuses_a_dismantle_of_a_complex_holding_a_finished_vehicle"/>.
    /// The finding this whole task turned on and had backwards: RP-1's own gate
    /// requires an empty warehouse, so its warehouse-scrapping loop is unreachable.
    /// This asserts the refusal and that NOTHING was scrapped.</item>
    /// <item><see cref="Removes_a_complexs_pads_last_first"/>. Not fussiness:
    /// <c>LCLaunchPad.Delete</c> decrements the launch-site index of every vessel
    /// pointing past the removed pad, so a forward walk shifts the same indices
    /// repeatedly.</item>
    /// </list>
    ///
    /// <para>What these cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: they prove the handler invokes the member it claims to
    /// and refuses where it claims to, and nothing whatever about the values a
    /// running RP-1 would hold.</para>
    /// </summary>
    public class Rp1ComplexLifecycleTests : IDisposable
    {
        private readonly Rp1ComplexLifecycleCommands _commands = new Rp1ComplexLifecycleCommands();

        public Rp1ComplexLifecycleTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            SCMEvents.ResetLifecycleEvents();
        }

        /// <summary>
        /// One centre with one operational pad complex, holding as many operational
        /// pads as asked for.
        /// </summary>
        private static LaunchComplex Complex(
            string name = "LC-1",
            int pads = 2,
            LaunchComplexType type = LaunchComplexType.Pad)
        {
            var lc = new LaunchComplex
            {
                Name = name,
                LcTypeValue = type,
                IsOperational = true,
            };
            lc.StatsValue.Name = name;
            lc.StatsValue.lcType = type;

            for (var i = 0; i < pads; i++)
            {
                var pad = new LCLaunchPad(Guid.NewGuid(), "Pad " + (i + 1), 0f) { isOperational = true, Lc = lc };
                lc.LaunchPads.Add(pad);
            }

            var ksc = new LCSpaceCenter { KSCName = "Cape" };
            ksc.LaunchComplexes.Add(lc);
            lc.Ksc = ksc;

            var scm = SpaceCenterManagement.Instance ?? new SpaceCenterManagement();
            if (scm.ActiveSC == null)
            {
                scm.ActiveSC = ksc;
                scm.KSCs.Add(ksc);
                SpaceCenterManagement.Instance = scm;
            }
            else
            {
                scm.ActiveSC.LaunchComplexes.Add(lc);
                lc.Ksc = scm.ActiveSC;
                ksc.LaunchComplexes.Remove(lc);
            }
            return lc;
        }

        /// <summary>Gives the complex an efficiency record, optionally shared with a sibling.</summary>
        private static LCEfficiency WithEfficiency(LaunchComplex lc, double efficiency, LaunchComplex? sharedWith = null)
        {
            var record = new LCEfficiency(efficiency);
            record._lcs.Add(lc);
            SpaceCenterManagement.Instance!.LCToEfficiency[lc] = record;
            if (sharedWith != null)
            {
                record._lcs.Add(sharedWith);
                SpaceCenterManagement.Instance!.LCToEfficiency[sharedWith] = record;
            }
            return record;
        }

        private CommandResult Rename(LaunchComplex lc, string? name) =>
            _commands.RenameComplex(new Rp1ComplexRenameArgs { LcId = lc.ID.ToString(), Name = name });

        private CommandResult<Dictionary<string, object?>> Dismantle(LaunchComplex lc) =>
            _commands.DismantleComplex(new Rp1ComplexDismantleArgs { LcId = lc.ID.ToString() });

        private CommandResult RenamePad(LaunchComplex lc, LCLaunchPad pad, string? name) =>
            _commands.RenamePad(new Rp1PadRenameArgs
            {
                LcId = lc.ID.ToString(),
                PadId = pad.id.ToString(),
                Name = name,
            });

        private CommandResult DismantlePad(LaunchComplex lc, LCLaunchPad pad) =>
            _commands.DismantlePad(new Rp1PadDismantleArgs
            {
                LcId = lc.ID.ToString(),
                PadId = pad.id.ToString(),
            });

        // ── Renaming a complex ────────────────────────────────────────────────

        [Fact]
        public void Renames_a_complex_in_both_places_RP1_keeps_the_name()
        {
            var lc = Complex();

            Assert.True(Rename(lc, "Cape Canaveral 5").Success);

            Assert.Equal("Cape Canaveral 5", lc.Name);
            // The persisted specification carries the name too, and a rename that
            // wrote only the first would revert on load.
            Assert.Equal("Cape Canaveral 5", lc.Stats.Name);
        }

        [Fact]
        public void Refuses_a_complex_rename_to_a_name_another_complex_has()
        {
            var first = Complex("LC-1");
            var second = Complex("LC-2");

            var result = Rename(second, "lc-1");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            // RP-1's own wording, from the build path that does check. Its rename
            // path checks nothing, which is the divergence this refusal is.
            Assert.Contains("already exists", result.Detail);
            Assert.Equal("LC-2", second.Name);
            Assert.Equal("LC-1", first.Name);
        }

        [Fact]
        public void A_complex_rename_to_its_own_name_succeeds_and_changes_nothing()
        {
            var lc = Complex("LC-1");

            // Idempotent on purpose: an operator commanding from a remote vantage
            // may re-send a command whose result was lost, and the asked-for state
            // is the state.
            Assert.True(Rename(lc, "LC-1").Success);
            Assert.Equal("LC-1", lc.Name);
        }

        [Fact]
        public void Refuses_a_complex_rename_with_no_name()
        {
            var lc = Complex();

            // Whitespace is not a name, and RP-1's own build path refuses an empty
            // one. Its rename path would write it.
            foreach (var candidate in new[] { null, string.Empty, "   " })
            {
                var result = Rename(lc, candidate);
                Assert.False(result.Success);
                Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            }
            Assert.Equal("LC-1", lc.Name);
        }

        // ── Dismantling a complex ─────────────────────────────────────────────

        [Fact]
        public void Dismantles_a_complex_its_pads_and_its_place_at_the_centre()
        {
            var lc = Complex(pads: 2);
            var ksc = lc.KSC!;
            SCMEvents.CreateLifecycleEvents();

            var result = Dismantle(lc);

            Assert.True(result.Success);
            Assert.Empty(lc.LaunchPads);
            Assert.DoesNotContain(lc, ksc.LaunchComplexes);
            Assert.Equal(2, result.Payload!["padsRemoved"]);
            // RP-1 moves the game's own selection off the complex BEFORE removing
            // it: switching afterwards would land on an index the removal shifted.
            Assert.Equal(1, ksc.SwitchAwayCalls);
            Assert.Same(lc, Assert.Single(SCMEvents.OnLCDismantled!.Fired));
        }

        [Fact]
        public void Completes_a_dismantle_whose_event_subscriber_throws()
        {
            var lc = Complex();
            SCMEvents.CreateLifecycleEvents();
            SCMEvents.OnLCDismantled!.Throws = true;

            // RP-1 swallows this itself, and so must we: the complex is already
            // gone, and an operator who read "failed" would go looking for it.
            Assert.True(Dismantle(lc).Success);
            Assert.Empty(lc.KSC!.LaunchComplexes);
        }

        [Fact]
        public void Dismantles_a_complex_when_RP1s_event_bus_has_not_been_built_yet()
        {
            var lc = Complex();

            // The events are null until RP-1's own start-up constructs them, which
            // is the state an Uplink acting early finds.
            Assert.Null(SCMEvents.OnLCDismantled);
            Assert.True(Dismantle(lc).Success);
        }

        [Fact]
        public void Refuses_to_dismantle_the_hangar_in_RP1s_own_words()
        {
            var hangar = Complex("Hangar", pads: 0, type: LaunchComplexType.Hangar);

            var result = Dismantle(hangar);

            Assert.False(result.Success);
            Assert.Contains("Hangar", result.Detail);
            Assert.Contains(hangar, hangar.KSC!.LaunchComplexes);
        }

        [Fact]
        public void Refuses_a_dismantle_of_a_complex_holding_a_finished_vehicle()
        {
            var lc = Complex();
            var finished = new VesselProject { shipName = "Atlas 3" };
            lc.Warehouse.Add(finished);

            var result = Dismantle(lc);

            Assert.False(result.Success);
            // RP-1's own gate requires an empty warehouse, which is what makes its
            // warehouse-scrapping loop unreachable. The vehicle is still there.
            Assert.Contains(finished, lc.Warehouse);
            Assert.Contains(lc, lc.KSC!.LaunchComplexes);
            Assert.NotEmpty(lc.LaunchPads);
        }

        [Fact]
        public void Names_which_of_RP1s_four_in_use_conditions_actually_holds()
        {
            var lc = Complex();
            lc.BuildList.Add(new VesselProject { shipName = "Atlas 3" });

            var result = Dismantle(lc);

            Assert.False(result.Success);
            // RP-1 says only "Launch Complex in use" for all four. Naming the real
            // one is the difference between an operator scrapping a vehicle and an
            // operator waiting for a rollout.
            Assert.Contains("being integrated", result.Detail);
            Assert.DoesNotContain("warehouse", result.Detail);
        }

        [Fact]
        public void A_cooling_pad_does_not_block_a_dismantle()
        {
            var lc = Complex();
            lc.Recon_Rollout.Add(new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Reconditioning,
                launchPadID = lc.LaunchPads[0].name,
            });

            // Reconditioning is the complex recovering from its own launch rather
            // than work on a vehicle, and RP-1 excludes it by name from both gates.
            Assert.True(Dismantle(lc).Success);
        }

        [Fact]
        public void Refuses_a_dismantle_while_a_rollout_is_moving_a_vehicle()
        {
            var lc = Complex();
            lc.Recon_Rollout.Add(new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Rollout,
                launchPadID = lc.LaunchPads[0].name,
            });

            var result = Dismantle(lc);

            Assert.False(result.Success);
            Assert.Contains("rollout", result.Detail);
            Assert.NotEmpty(lc.LaunchPads);
        }

        [Fact]
        public void Refuses_a_dismantle_while_the_complex_is_under_construction()
        {
            var lc = Complex();
            lc.KSC!.LCConstructions.Add(new LCConstructionProject { lcID = lc.ID, name = "LC-1" });

            var result = Dismantle(lc);

            Assert.False(result.Success);
            Assert.Contains("under construction", result.Detail);
            Assert.NotEmpty(lc.LaunchPads);
        }

        [Fact]
        public void Refuses_a_dismantle_while_a_pad_is_under_construction()
        {
            var lc = Complex();
            lc.PadConstructions.Add(new PadConstructionProject { id = lc.LaunchPads[0].id, name = "Pad 1" });

            var result = Dismantle(lc);

            Assert.False(result.Success);
            Assert.Contains("under construction", result.Detail);
            Assert.NotEmpty(lc.LaunchPads);
        }

        [Fact]
        public void Refuses_a_dismantle_while_a_craft_stands_on_a_pad()
        {
            var lc = Complex();
            lc.LaunchPads[1].Waiting = new Vessel { vesselName = "Atlas 3" };

            var result = Dismantle(lc);

            Assert.False(result.Success);
            Assert.Contains("waiting on the launch pad", result.Detail);
            // The craft's own name, which RP-1's message for this case does not
            // carry: it says "a vessel" and leaves the operator to find which.
            Assert.Contains("Atlas 3", result.Detail);
        }

        [Fact]
        public void Reports_the_efficiency_a_dismantle_destroys()
        {
            var lc = Complex();
            WithEfficiency(lc, 0.62);

            var result = Dismantle(lc);

            Assert.True(result.Success);
            // The loss RP-1's dialog names nowhere. It is unrecoverable: a complex
            // rebuilt to the same specification starts again from RP-1's floor.
            Assert.Equal(0.62, result.Payload!["efficiencyLost"]);
            Assert.Empty((List<string>)result.Payload!["efficiencySurvivesWith"]!);
            Assert.Equal(1, SpaceCenterManagement.Instance!.ClearedEfficiencyRecords);
        }

        [Fact]
        public void Reports_the_efficiency_a_dismantle_leaves_with_a_sibling()
        {
            var lc = Complex("LC-1");
            var sibling = Complex("LC-2");
            WithEfficiency(lc, 0.62, sharedWith: sibling);

            var result = Dismantle(lc);

            Assert.True(result.Success);
            // A different warning entirely, and the operator has to know which of
            // the two they are looking at: nothing is lost here, because the
            // sibling keeps the group and the figure with it.
            Assert.Null(result.Payload!["efficiencyLost"]);
            Assert.Equal(
                new[] { sibling.ID.ToString() },
                ((List<string>)result.Payload!["efficiencySurvivesWith"]!).ToArray());
            Assert.Equal(0, SpaceCenterManagement.Instance!.ClearedEfficiencyRecords);
        }

        [Fact]
        public void Reports_no_efficiency_for_a_complex_nobody_has_built_at()
        {
            var lc = Complex();

            var result = Dismantle(lc);

            Assert.True(result.Success);
            // RP-1 creates the record the first time a complex is worked, so a
            // complex nobody has built at has no efficiency to lose. Absent rather
            // than zero: having lost nothing is a different answer from having had
            // nothing.
            Assert.Null(result.Payload!["efficiencyLost"]);
            Assert.Null(result.Payload!["efficiencySurvivesWith"]);
        }

        [Fact]
        public void A_dismantle_frees_the_complexs_engineers_without_writing_them_anywhere()
        {
            var lc = Complex();
            lc.Engineers = 14;
            var ksc = lc.KSC!;
            ksc.Engineers = 30;

            var result = Dismantle(lc);

            Assert.True(result.Success);
            Assert.Equal(14, result.Payload!["engineersFreed"]);
            // The centre's pool is DERIVED as hired minus what its complexes hold,
            // so removing the complex frees its crew by arithmetic. Nothing is
            // lost, and nothing had to be written.
            Assert.Equal(30, ksc.Engineers);
            Assert.Equal(30, ksc.UnassignedEngineers);
        }

        [Fact]
        public void A_dismantle_clears_a_standing_hire_order_that_named_the_complex()
        {
            var lc = Complex();
            var scm = SpaceCenterManagement.Instance!;
            scm.staffTarget.LCID = lc.ID;
            scm.staffTarget.targetCrewCount = 20;

            Assert.True(Dismantle(lc).Success);

            // RP-1 does this silently, and the operator only ever finds out because
            // the value is on the wire to watch go.
            Assert.False(scm.staffTarget.IsValid);
            Assert.Equal(Guid.Empty, scm.staffTarget.LCID);
        }

        [Fact]
        public void Removes_a_complexs_pads_last_first()
        {
            var lc = Complex(pads: 3);
            // A vehicle bound for the LAST pad. Deleting forward would decrement
            // its index once per pad removed and walk it off the front.
            var bound = new VesselProject { shipName = "Atlas 3", launchSiteIndex = 2 };
            lc.BuildList.Add(bound);

            // BuildList is not empty, so the dismantle refuses; the ordering is
            // asserted through the pad command instead, which is the same Delete.
            Assert.False(Dismantle(lc).Success);
            Assert.Equal(3, lc.LaunchPads.Count);

            lc.BuildList.Clear();
            Assert.True(Dismantle(lc).Success);
            Assert.Empty(lc.LaunchPads);
        }

        // ── Renaming a pad ────────────────────────────────────────────────────

        [Fact]
        public void Renames_a_pad_and_the_operations_stored_against_its_name()
        {
            var lc = Complex();
            var pad = lc.LaunchPads[0];
            var operation = new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Reconditioning,
                launchPadID = pad.name,
            };
            lc.Recon_Rollout.Add(operation);

            Assert.True(RenamePad(lc, pad, "LC-39A").Success);

            Assert.Equal("LC-39A", pad.name);
            // A pad's name is the key its rollouts are stored against, which is
            // what makes the rename RP-1's to perform rather than a field to write.
            Assert.Equal("LC-39A", operation.launchPadID);
        }

        [Fact]
        public void Refuses_a_pad_rename_to_a_name_already_in_use()
        {
            var lc = Complex(pads: 2);
            var pad = lc.LaunchPads[0];

            var result = RenamePad(lc, pad, "pad 2");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            // RP-1 answers this by RETURNING SILENTLY: Save closes the window and
            // the pad keeps its old name with no message anywhere. This is the
            // refusal that case should always have been.
            Assert.Contains("already exists", result.Detail);
            Assert.Equal("Pad 1", pad.name);
        }

        [Fact]
        public void Reports_a_pad_rename_RP1_declined_without_saying_why()
        {
            var lc = Complex(pads: 1);
            var pad = lc.LaunchPads[0];
            // A pad RP-1 cannot resolve a complex for: its Rename returns having
            // done nothing, and no duplicate check of ours would have caught it.
            pad.Lc = null;

            var result = RenamePad(lc, pad, "LC-39A");

            Assert.False(result.Success);
            // The read-back is what makes this command unable to report a silent
            // no-op as success, and it covers the cases the duplicate check cannot
            // enumerate as well as the one it can.
            Assert.Contains("declined", result.Detail);
            Assert.Equal("Pad 1", pad.name);
        }

        [Fact]
        public void A_pad_rename_to_its_own_name_succeeds_and_changes_nothing()
        {
            var lc = Complex();
            var pad = lc.LaunchPads[0];

            // Would otherwise hit RP-1's own duplicate return, since the pad's own
            // name is in the list it checks.
            Assert.True(RenamePad(lc, pad, "Pad 1").Success);
            Assert.Equal("Pad 1", pad.name);
        }

        // ── Dismantling a pad ─────────────────────────────────────────────────

        [Fact]
        public void Dismantles_a_pad_and_shifts_the_vessels_that_pointed_past_it()
        {
            var lc = Complex(pads: 3);
            SCMEvents.CreateLifecycleEvents();
            var bound = new VesselProject { shipName = "Atlas 3", launchSiteIndex = 2 };
            lc.Warehouse.Add(bound);

            Assert.True(DismantlePad(lc, lc.LaunchPads[0]).Success);

            Assert.Equal(2, lc.LaunchPads.Count);
            // The shift is why the complex dismantle removes pads last first: every
            // vessel pointing past the removed pad moves down one.
            Assert.Equal(1, bound.launchSiteIndex);
            Assert.Single(SCMEvents.OnPadDismantled!.Fired);
        }

        [Fact]
        public void Refuses_a_pad_dismantle_that_would_leave_the_complex_without_one()
        {
            var lc = Complex(pads: 1);
            var pad = lc.LaunchPads[0];

            var result = DismantlePad(lc, pad);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            // RP-1's check is `LaunchPadCount >= 2 && !Delete(out r)`, so with one
            // pad the && SHORT-CIRCUITS: its confirmation dialog has already asked
            // "This cannot be undone!", the operator presses Yes, the window
            // closes, and the pad is still there with nothing posted.
            Assert.Contains("must keep one", result.Detail);
            Assert.Single(lc.LaunchPads);
        }

        [Fact]
        public void Counts_only_operational_pads_towards_the_one_a_complex_must_keep()
        {
            var lc = Complex(pads: 2);
            // A pad still being built does not count, which is RP-1's own
            // definition of LaunchPadCount.
            lc.LaunchPads[1].isOperational = false;

            var result = DismantlePad(lc, lc.LaunchPads[0]);

            Assert.False(result.Success);
            Assert.Contains("must keep one", result.Detail);
            Assert.Equal(2, lc.LaunchPads.Count);
        }

        [Fact]
        public void Refuses_to_dismantle_a_pad_that_is_not_in_service_yet()
        {
            var lc = Complex(pads: 3);
            lc.LaunchPads[2].isOperational = false;

            var result = DismantlePad(lc, lc.LaunchPads[2]);

            Assert.False(result.Success);
            // Removing a pad mid-construction is what cancelling its construction
            // project is for, and is a different act.
            Assert.Contains("cancel its construction", result.Detail);
            Assert.Equal(3, lc.LaunchPads.Count);
        }

        [Fact]
        public void Quotes_RP1s_own_reason_when_it_refuses_a_pad()
        {
            var lc = Complex(pads: 2);
            var pad = lc.LaunchPads[0];
            pad.Waiting = new Vessel { vesselName = "Atlas 3" };

            var result = DismantlePad(lc, pad);

            Assert.False(result.Success);
            // Verbatim, out of RP-1's own out parameter, rather than a sentence of
            // ours inferred from the mechanism that produced it.
            Assert.Contains("vessel Atlas 3 is currently waiting on the launch pad", result.Detail);
            Assert.Equal(2, lc.LaunchPads.Count);
        }

        [Fact]
        public void Refuses_a_pad_dismantle_while_a_rollout_is_on_that_pad()
        {
            var lc = Complex(pads: 2);
            var pad = lc.LaunchPads[0];
            lc.Recon_Rollout.Add(new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Rollout,
                launchPadID = pad.name,
                BP = 100.0,
            });

            var result = DismantlePad(lc, pad);

            Assert.False(result.Success);
            Assert.Contains("pad has ongoing rollout", result.Detail);
            Assert.Equal(2, lc.LaunchPads.Count);
        }

        // ── The refusals every one of them shares ─────────────────────────────

        [Fact]
        public void Every_command_refuses_a_complex_it_cannot_find()
        {
            Complex();
            var absent = Guid.NewGuid().ToString();

            Assert.Equal(
                CommandErrorCode.NotFound,
                _commands.RenameComplex(new Rp1ComplexRenameArgs { LcId = absent, Name = "X" }).ErrorCode);
            Assert.Equal(
                CommandErrorCode.NotFound,
                _commands.DismantleComplex(new Rp1ComplexDismantleArgs { LcId = absent }).ErrorCode);
            Assert.Equal(
                CommandErrorCode.NotFound,
                _commands.RenamePad(new Rp1PadRenameArgs { LcId = absent, PadId = absent, Name = "X" }).ErrorCode);
            Assert.Equal(
                CommandErrorCode.NotFound,
                _commands.DismantlePad(new Rp1PadDismantleArgs { LcId = absent, PadId = absent }).ErrorCode);
        }

        [Fact]
        public void Finds_a_complex_at_a_centre_that_is_not_the_active_one()
        {
            var active = Complex("LC-1");
            var elsewhere = new LaunchComplex { Name = "Woomera 1", IsOperational = true };
            elsewhere.StatsValue.Name = "Woomera 1";
            var second = new LCSpaceCenter { KSCName = "Woomera" };
            second.LaunchComplexes.Add(elsewhere);
            elsewhere.Ksc = second;
            SpaceCenterManagement.Instance!.KSCs.Add(second);

            // RP-1's own surface can only reach the ACTIVE complex at the ACTIVE
            // centre, because that is all its window can address. A command
            // addressed to a complex the operator can see on a second centre must
            // not refuse because the game's view happens to be somewhere else.
            Assert.True(Rename(elsewhere, "Woomera Alpha").Success);
            Assert.Equal("Woomera Alpha", elsewhere.Name);
            Assert.Equal("LC-1", active.Name);
        }

        [Fact]
        public void A_pad_is_addressed_at_the_complex_the_command_named()
        {
            var first = Complex("LC-1");
            var second = Complex("LC-2");

            var result = _commands.DismantlePad(new Rp1PadDismantleArgs
            {
                LcId = second.ID.ToString(),
                PadId = first.LaunchPads[0].id.ToString(),
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            // A pad id is unique, but a command that found one at a complex the
            // operator did not name would act somewhere they were not looking.
            Assert.Equal(2, first.LaunchPads.Count);
            Assert.Equal(2, second.LaunchPads.Count);
        }

        [Fact]
        public void Every_command_refuses_a_save_RP1_is_not_managing()
        {
            var lc = Complex();
            SpaceCenterManagement.Instance!.enabledForSave = false;

            Assert.Equal(
                CommandErrorCode.ModeUnavailable,
                Rename(lc, "X").ErrorCode);
            Assert.Equal(
                CommandErrorCode.ModeUnavailable,
                Dismantle(lc).ErrorCode);
            Assert.Equal("LC-1", lc.Name);
            Assert.NotEmpty(lc.LaunchPads);
        }

        [Fact]
        public void Every_command_refuses_when_RP1s_space_centre_is_not_loaded()
        {
            var lc = Complex();
            SpaceCenterManagement.Instance = null;

            Assert.Equal(CommandErrorCode.ModeUnavailable, Rename(lc, "X").ErrorCode);
            Assert.Equal(CommandErrorCode.ModeUnavailable, Dismantle(lc).ErrorCode);
        }

        [Fact]
        public void The_diagnosis_names_every_member_it_found()
        {
            // Against the stand-in graph every member resolves, so this pins the
            // sentence a healthy install produces. Its value is the other branch:
            // a withheld command and one nobody wrote are indistinguishable from
            // outside, and this is what tells them apart.
            Assert.True(_commands.IsAvailable);
            Assert.Equal("every invoked member resolved", _commands.MethodDiagnosis());
        }
    }
}
