using System;
using System.Collections.Generic;
using System.Linq;
using ROUtils;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Building a launch complex, renovating one, and adding a pad, against the
    /// stand-in RP-1 object graph.
    ///
    /// <para>The PRICE these commands carry is pinned separately and far more
    /// thoroughly, in <see cref="Rp1LcCostModelTests"/>. What this file is for is
    /// everything around it: that the figure reaches the project at all, that the
    /// write ORDER is RP-1's, that a renovation cannot strand a vehicle, and that
    /// the two lists RP-1 keeps as observable are added to through the shadowing
    /// overload rather than the base one.</para>
    ///
    /// <para>The cases that decide whether this surface is safe:</para>
    /// <list type="bullet">
    /// <item><see cref="A_queued_project_is_added_through_the_SHADOWING_Add"/>. RP-1's
    /// <c>LCConstructions</c> is a <c>PersistentObservableList</c> whose <c>Add</c>
    /// hides <c>List&lt;T&gt;.Add</c> and fires the events its own UI listens on.
    /// Bind to the base one and the project is queued while every subscriber is told
    /// nothing, and a count-based assertion agrees completely.</item>
    /// <item><see cref="A_renovation_refuses_rather_than_stranding_a_vehicle"/>. RP-1's
    /// own <c>ModifyFailure</c>. A renovation past a half-built vehicle's limits
    /// leaves it unbuildable at the only complex that holds it.</item>
    /// <item><see cref="A_renovation_takes_the_crew_off_BEFORE_it_queues_anything"/>.
    /// The order is RP-1's and it is load-bearing: the staff target is cleared before
    /// the crew move, and the crew move happens before the project exists.</item>
    /// <item><see cref="A_renovation_carries_the_BUILD_tonnage_through_untouched"/>.
    /// <c>massOrig</c> fixes the renovation envelope for the complex's life AND is
    /// the curve the per-metre charge is lerped over. Substituting the new limit
    /// would widen the envelope illegally and misprice every axis.</item>
    /// <item><see cref="Outside_a_career_the_change_is_applied_rather_than_queued"/>.
    /// <c>enabledForSave</c> is true for sandbox too, so this is a real branch: a
    /// funded project on a save with no funding stalls forever with nothing saying
    /// why.</item>
    /// </list>
    ///
    /// <para>What these cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged, with one addition of their own: the price is checked to
    /// have ARRIVED, never to be right. Rightness is the cost model's suite, and
    /// beyond that a comparison against a running RP-1 that has not been done.</para>
    /// </summary>
    public class Rp1ComplexConstructionTests : IDisposable
    {
        private readonly Rp1ComplexConstructionCommands _commands = new Rp1ComplexConstructionCommands();

        public Rp1ComplexConstructionTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            SCMEvents.ResetLifecycleEvents();
            KSPUtils.IsCareer = true;
            Database.ResourceInfo.LCResourceTypes.Clear();
            Formula.TankCostPerUnit.Clear();
        }

        private static LCSpaceCenter Centre(string name = "Cape")
        {
            var ksc = new LCSpaceCenter { KSCName = name, Engineers = 30 };
            var scm = SpaceCenterManagement.Instance;
            if (scm == null)
            {
                SpaceCenterManagement.Instance = new SpaceCenterManagement { ActiveSC = ksc };
                SpaceCenterManagement.Instance.KSCs.Add(ksc);
            }
            else
            {
                scm.KSCs.Add(ksc);
            }
            return ksc;
        }

        private static LaunchComplex ComplexAt(
            LCSpaceCenter ksc,
            string name = "LC-1",
            float massMax = 100f,
            float? massOrig = null,
            int engineers = 0,
            int pads = 1,
            LaunchComplexType type = LaunchComplexType.Pad)
        {
            var lc = new LaunchComplex
            {
                Name = name,
                IsOperational = true,
                Engineers = engineers,
                Ksc = ksc,
                StatsValue = new LCData
                {
                    Name = name,
                    massMax = massMax,
                    massOrig = massOrig ?? massMax,
                    sizeMax = new UnityEngine.Vector3(20f, 30f, 20f),
                    lcType = type,
                },
            };
            lc.SyncFromStats();
            for (var i = 0; i < pads; i++)
            {
                lc.LaunchPads.Add(new LCLaunchPad(Guid.NewGuid(), "Pad " + (i + 1), 0f)
                {
                    isOperational = true,
                    Lc = lc,
                });
            }
            ksc.LaunchComplexes.Add(lc);
            return lc;
        }

        private static Rp1ComplexSizeArgs Size(double width = 20, double height = 30, double depth = 20) =>
            new Rp1ComplexSizeArgs
            {
                SizeMaxWidth = width,
                SizeMaxHeight = height,
                SizeMaxDepth = depth,
            };

        private CommandResult<Dictionary<string, object?>> New(
            string? ksc = "Cape",
            string? name = "LC-2",
            double? mass = 120,
            bool? humanRated = false,
            Rp1ComplexSizeArgs? size = null,
            Dictionary<string, double>? resources = null,
            bool? assignOnComplete = null) =>
            _commands.NewComplex(new Rp1ComplexNewArgs
            {
                KscName = ksc,
                Name = name,
                MassMax = mass,
                HumanRated = humanRated,
                Size = size ?? Size(),
                Resources = resources,
                AssignEngineersOnComplete = assignOnComplete,
            });

        private CommandResult<Dictionary<string, object?>> Modify(
            LaunchComplex lc,
            double? mass = 150,
            bool? humanRated = false,
            Rp1ComplexSizeArgs? size = null,
            Dictionary<string, double>? resources = null,
            bool? assignOnComplete = null) =>
            _commands.ModifyComplex(new Rp1ComplexModifyArgs
            {
                LcId = lc.ID.ToString(),
                MassMax = mass,
                HumanRated = humanRated,
                Size = size ?? Size(),
                Resources = resources,
                AssignEngineersOnComplete = assignOnComplete,
            });

        private CommandResult<Dictionary<string, object?>> NewPad(LaunchComplex lc, string? name = "LP-2") =>
            _commands.NewPad(new Rp1PadNewArgs { LcId = lc.ID.ToString(), Name = name });

        // ── Building a complex ────────────────────────────────────────────────

        [Fact]
        public void Queues_a_new_complex_out_of_service_with_a_project_priced_against_it()
        {
            var ksc = Centre();
            SCMEvents.CreateLifecycleEvents();

            var result = New();

            Assert.True(result.Success);
            var complex = Assert.Single(ksc.LaunchComplexes);
            Assert.Equal("LC-2", complex.Name);
            // Out of service for the whole construction, which is what stops an
            // operator staffing or launching from a complex that does not exist yet.
            Assert.False(complex.IsOperational);

            var project = Assert.Single(ksc.LCConstructions);
            Assert.Equal(complex.ID, project.lcID);
            Assert.False(project.isModify);
            Assert.Equal((double)result.Payload!["cost"]!, project.cost, 6);
            // The duration, by RP-1's own curve, with a prior cost of zero because a
            // new complex has no prior.
            Assert.Equal(1, project.BpCalls);
            Assert.Equal(0.0, project.BpOldCostArgument);
            Assert.Same(project, Assert.Single(SCMEvents.OnLCConstructionQueued!.Fired).Value);
        }

        [Fact]
        public void A_new_complex_is_ALWAYS_a_pad_because_RP1_never_builds_a_hangar()
        {
            var ksc = Centre();

            Assert.True(New().Success);

            // RP-1's own new-complex path assigns Pad unconditionally, and the one
            // hangar a career has is seeded at career start. There is no argument for
            // this, and a complex built as a hangar would meet code paths RP-1 does
            // not expect.
            Assert.Equal(LaunchComplexType.Pad, Assert.Single(ksc.LaunchComplexes).LCType);
        }

        [Fact]
        public void A_new_complex_is_built_at_the_tonnage_that_fixes_its_envelope_for_life()
        {
            var ksc = Centre();

            Assert.True(New(mass: 120).Success);

            var built = Assert.Single(ksc.LaunchComplexes);
            // massOrig == massMax at build time, which is what makes the renovation
            // envelope 60t to 240t rather than something derived from a limit that
            // moves.
            Assert.Equal(120f, built.Stats.massMax);
            Assert.Equal(120f, built.Stats.massOrig);
        }

        [Fact]
        public void Building_sets_RP1s_first_run_flag_so_the_career_stops_asking()
        {
            Centre();
            Assert.False(SpaceCenterManagement.Instance!.StarterLCBuilding);

            Assert.True(New().Success);

            // RP-1 gates its own start-up guidance on this. A career whose first
            // complex was ordered from here would otherwise still be told to order
            // one.
            Assert.True(SpaceCenterManagement.Instance!.StarterLCBuilding);
        }

        [Fact]
        public void A_new_complex_can_be_told_to_staff_itself_when_it_finishes()
        {
            var ksc = Centre();

            var result = New(assignOnComplete: true);

            Assert.True(result.Success);
            var project = Assert.Single(ksc.LCConstructions);
            // Up to the finished complex's OWN maximum, which is the figure RP-1's
            // dialog offers for a build (a renovation offers the crew it took off
            // instead).
            Assert.Equal((int)result.Payload!["maxEngineers"]!, project.engineersToReadd);
            Assert.True(project.engineersToReadd > 0);
        }

        [Fact]
        public void Building_without_the_toggle_readds_nobody()
        {
            var ksc = Centre();

            Assert.True(New(assignOnComplete: null).Success);

            Assert.Equal(0, Assert.Single(ksc.LCConstructions).engineersToReadd);
        }

        [Fact]
        public void Refuses_a_new_complex_at_a_centre_the_career_does_not_have()
        {
            Centre("Cape");

            var result = New(ksc: "Woomera");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Contains("Woomera", result.Detail);
        }

        [Fact]
        public void Refuses_a_new_complex_with_no_centre_named()
        {
            Centre();

            // REQUIRED, and the one place these commands ask for a choice RP-1 does
            // not offer: its window has no centre picker and builds wherever the
            // game's view happens to be. Requiring it means the wire records which
            // was chosen.
            var result = New(ksc: null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(SpaceCenterManagement.Instance!.KSCs[0].LaunchComplexes);
        }

        [Fact]
        public void Refuses_a_new_complex_whose_name_a_sibling_at_that_centre_has()
        {
            var ksc = Centre();
            ComplexAt(ksc, "LC-1");

            var result = New(name: "lc-1");

            Assert.False(result.Success);
            // RP-1's own words, and its own case-insensitive comparison.
            Assert.Contains("already exists", result.Detail);
            Assert.Single(ksc.LaunchComplexes);
        }

        [Fact]
        public void Refuses_a_new_complex_with_no_tonnage_limit_in_RP1s_own_words()
        {
            var ksc = Centre();

            foreach (var mass in new double?[] { null, 0.0, -5.0 })
            {
                var result = New(mass: mass);
                Assert.False(result.Success);
                Assert.Contains("valid tonnage limit", result.Detail);
            }
            Assert.Empty(ksc.LaunchComplexes);
            Assert.Empty(ksc.LCConstructions);
        }

        [Fact]
        public void Refuses_a_complex_with_a_missing_or_zero_size_axis()
        {
            var ksc = Centre();

            // Each axis is priced independently, and height at twice the rate of the
            // other two, so a substituted default on any one of them builds to an
            // envelope nobody chose.
            var missing = New(size: new Rp1ComplexSizeArgs { SizeMaxWidth = 20, SizeMaxHeight = 30 });
            Assert.False(missing.Success);
            Assert.Contains("all three size limits", missing.Detail);

            var zero = New(size: Size(height: 0));
            Assert.False(zero.Success);
            Assert.Contains("valid size", zero.Detail);

            Assert.Empty(ksc.LaunchComplexes);
        }

        [Fact]
        public void Refuses_a_complex_that_did_not_say_whether_it_takes_crew()
        {
            var ksc = Centre();

            var result = New(humanRated: null);

            Assert.False(result.Success);
            // Refused rather than defaulted to false: human rating multiplies the pad
            // price by 1.5 and the integration price by 2, so either default halves
            // or doubles the cost of the thing being bought.
            Assert.Contains("human-rated", result.Detail);
            Assert.Empty(ksc.LaunchComplexes);
        }

        // ── Renovating a complex ──────────────────────────────────────────────

        [Fact]
        public void Queues_a_renovation_against_the_complex_it_renovates()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            SCMEvents.CreateLifecycleEvents();

            var result = Modify(lc, mass: 150);

            Assert.True(result.Success);
            var project = Assert.Single(ksc.LCConstructions);
            Assert.Equal(lc.ID, project.lcID);
            Assert.True(project.isModify);
            // The specification the complex BECOMES, held as a copy.
            Assert.Equal(150f, project.lcData.massMax);
            Assert.NotSame(lc.Stats, project.lcData);
            // Out of service for the renovation, exactly as for a build.
            Assert.False(lc.IsOperational);
            Assert.Same(lc, Assert.Single(SCMEvents.OnLCConstructionQueued!.Fired).Reason);
        }

        [Fact]
        public void A_renovation_takes_the_crew_off_BEFORE_it_queues_anything()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f, engineers: 14);
            var scm = SpaceCenterManagement.Instance!;
            scm.staffTarget.LCID = lc.ID;
            scm.staffTarget.targetCrewCount = 20;

            var result = Modify(lc, mass: 150);

            Assert.True(result.Success);
            // RP-1 does this first and pops a dialog saying so. The count comes back
            // in the payload so a client can repeat the game's own sentence.
            Assert.Equal(0, lc.Engineers);
            Assert.Equal(14, result.Payload!["engineersUnassigned"]);
            // And the standing hire order that named this complex is gone, which RP-1
            // does silently.
            Assert.False(scm.staffTarget.IsValid);
            // The game's own selection moved off the complex before it went out of
            // service.
            Assert.Equal(1, ksc.SwitchAwayCalls);
        }

        [Fact]
        public void A_renovation_can_be_told_to_put_the_SAME_crew_back()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f, engineers: 14);

            Assert.True(Modify(lc, mass: 150, assignOnComplete: true).Success);

            // The crew it TOOK OFF, not the finished complex's maximum: RP-1's own
            // wording for this case is "they will be reassigned if available when
            // renovation completes".
            Assert.Equal(14, Assert.Single(ksc.LCConstructions).engineersToReadd);
        }

        [Fact]
        public void A_renovation_leaves_the_crew_off_when_it_was_not_told_to()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f, engineers: 14);

            Assert.True(Modify(lc, mass: 150, assignOnComplete: null).Success);

            // RP-1's other wording: "remember to reassign engineers when it finishes
            // renovation". The toggle is what decides which sentence is true.
            Assert.Equal(0, Assert.Single(ksc.LCConstructions).engineersToReadd);
        }

        [Fact]
        public void A_renovation_carries_the_BUILD_tonnage_through_untouched()
        {
            var ksc = Centre();
            // Already renovated once: built at 100, currently at 150.
            var lc = ComplexAt(ksc, massMax: 150f, massOrig: 100f);

            Assert.True(Modify(lc, mass: 180).Success);

            var project = Assert.Single(ksc.LCConstructions);
            Assert.Equal(180f, project.lcData.massMax);
            // THE ASSERTION THIS TEST EXISTS FOR. massOrig fixes the envelope for the
            // complex's life and is the curve the per-metre charge is lerped over, so
            // a command that carried the new limit here would widen the envelope
            // illegally and misprice every axis of every later renovation.
            Assert.Equal(100f, project.lcData.massOrig);
        }

        [Fact]
        public void Refuses_a_renovation_outside_the_complexs_own_envelope_in_RP1s_words()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f, massOrig: 100f);

            // Above double the build tonnage.
            var tooBig = Modify(lc, mass: 201);
            Assert.False(tooBig.Success);
            Assert.Contains("cannot upgrade tonnage above the limit of 200t", tooBig.Detail);

            // Below half of it.
            var tooSmall = Modify(lc, mass: 49);
            Assert.False(tooSmall.Success);
            Assert.Contains("cannot downgrade tonnage below the limit of 50t", tooSmall.Detail);

            Assert.Empty(ksc.LCConstructions);
            Assert.True(lc.IsOperational);
            Assert.Equal(100f, lc.Stats.massMax);
        }

        [Fact]
        public void A_renovation_refuses_rather_than_stranding_a_vehicle()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 200f, massOrig: 200f);
            var heavy = new VesselProject { shipName = "Atlas 3", MeetsRequirements = false };
            lc.BuildList.Add(heavy);

            var result = Modify(lc, mass: 120);

            Assert.False(result.Success);
            // RP-1's own ModifyFailure, and it NAMES the vehicles: a renovation past a
            // half-built vehicle's limits leaves it unbuildable at the only complex
            // that holds it.
            Assert.Contains("Atlas 3", result.Detail);
            Assert.Contains("incompatible", result.Detail);
            // And nothing moved: the crew is still on, the complex is still in
            // service, no project exists.
            Assert.True(lc.IsOperational);
            Assert.Empty(ksc.LCConstructions);
        }

        [Fact]
        public void A_vehicle_the_new_limits_still_support_does_not_block_a_renovation()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 200f, massOrig: 200f);
            lc.BuildList.Add(new VesselProject { shipName = "Vanguard", MeetsRequirements = true });

            // The weaker of RP-1's two gates: a renovation permits vehicles in the
            // complex, unlike a dismantle. Only the ones it would strand refuse it.
            Assert.True(Modify(lc, mass: 120).Success);
        }

        [Fact]
        public void Refuses_a_renovation_while_an_operation_is_moving_a_vehicle()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            lc.Recon_Rollout.Add(new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Rollout,
                launchPadID = lc.LaunchPads[0].name,
            });

            var result = Modify(lc, mass: 150);

            Assert.False(result.Success);
            Assert.Contains("rollout, rollback, or recovery", result.Detail);
            Assert.True(lc.IsOperational);
        }

        [Fact]
        public void A_cooling_pad_does_not_block_a_renovation()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            lc.Recon_Rollout.Add(new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Reconditioning,
                launchPadID = lc.LaunchPads[0].name,
            });

            // Reconditioning is the complex recovering from its own launch rather
            // than work on a vehicle, and RP-1 excludes it by name from both gates.
            Assert.True(Modify(lc, mass: 150).Success);
        }

        [Fact]
        public void A_renovation_reprices_the_complexs_in_flight_pad_constructions()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            var pending = new PadConstructionProject { id = Guid.NewGuid(), name = "LP-2", cost = 1.0 };
            lc.PadConstructions.Add(pending);

            var result = Modify(lc, mass: 150);

            Assert.True(result.Success);
            // A renovation rebuilds the pads too, so a pad already being built is
            // repriced to the NEW pad cost rather than left at the old one.
            Assert.True(pending.cost > 1.0);
            Assert.Equal(pending.cost, pending.BpCostArgument);
            Assert.Equal(0.0, pending.BpOldCostArgument);
        }

        [Fact]
        public void Reports_a_reduction_AS_a_reduction_because_it_still_costs()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f, massOrig: 100f);

            // A smaller envelope on every axis, which is what makes it a reduction by
            // RP-1's own test (the integration cost, not the tonnage).
            var result = Modify(lc, mass: 100, size: Size(10, 10, 10));

            Assert.True(result.Success);
            Assert.True((bool)result.Payload!["isDowngrade"]!);
            // The point of reporting it: an operator shrinking a complex is the one
            // most likely to expect a refund, and RP-1 charges half the difference.
            Assert.True((double)result.Payload!["cost"]! > 0.0);
        }

        [Fact]
        public void Refuses_a_tonnage_or_a_rating_for_the_hangar_rather_than_discarding_it()
        {
            var ksc = Centre();
            var hangar = ComplexAt(ksc, "Hangar", type: LaunchComplexType.Hangar);

            var withMass = Modify(hangar, mass: 200, humanRated: null);
            Assert.False(withMass.Success);
            Assert.Contains("no tonnage limit", withMass.Detail);

            var withRating = Modify(hangar, mass: null, humanRated: true);
            Assert.False(withRating.Success);
            Assert.Contains("always human-rated", withRating.Detail);

            // Refused rather than silently dropped, because a discarded argument is a
            // command that reported success for something it did not do.
            Assert.Empty(ksc.LCConstructions);
        }

        [Fact]
        public void Renovates_the_hangar_on_size_alone()
        {
            var ksc = Centre();
            var hangar = ComplexAt(ksc, "Hangar", type: LaunchComplexType.Hangar);

            var result = Modify(hangar, mass: null, humanRated: null, size: Size(40, 15, 40));

            Assert.True(result.Success);
            var project = Assert.Single(ksc.LCConstructions);
            Assert.Equal(15f, project.lcData.sizeMax.y);
            // Its kind survives the renovation, and RP-1 forces its rating true.
            Assert.Equal(LaunchComplexType.Hangar, project.lcData.lcType);
            Assert.True(project.lcData.isHumanRated);
        }

        // ── Adding a pad ─────────────────────────────────────────────────────

        [Fact]
        public void Queues_a_pad_out_of_service_at_the_complexs_own_tonnage_band()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f, pads: 1);
            lc.StatsValue.PadFracLevelValue = 3f;
            SCMEvents.CreateLifecycleEvents();

            var result = NewPad(lc);

            Assert.True(result.Success);
            Assert.Equal(2, lc.LaunchPads.Count);
            var pad = lc.LaunchPads[1];
            Assert.Equal("LP-2", pad.name);
            // A pad in the list and NOT operational is exactly a pad being built,
            // which is why isOperational is on the wire beside its state.
            Assert.False(pad.isOperational);
            Assert.Equal(3f, pad.fractionalLevel);
            Assert.Equal(3, pad.level);

            var project = Assert.Single(lc.PadConstructions);
            Assert.Equal(pad.id, project.id);
            Assert.Equal((double)result.Payload!["cost"]!, project.cost, 6);
            Assert.Equal(1, project.BpCalls);
            Assert.Same(project, Assert.Single(SCMEvents.OnPadConstructionQueued!.Fired).Value);
        }

        [Fact]
        public void A_pad_still_counts_as_not_operational_so_the_dismantle_rule_holds()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, pads: 1);

            Assert.True(NewPad(lc).Success);

            // Two pads in the list, ONE operational. That is the state that makes
            // "a complex must keep a working pad" bite while a second is being
            // built, and the reason the count is asked of RP-1 rather than taken
            // from the list length.
            Assert.Equal(2, lc.LaunchPads.Count);
            Assert.Equal(1, lc.LaunchPadCount);
        }

        [Fact]
        public void Refuses_a_pad_whose_name_a_sibling_has()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, pads: 1);

            var result = NewPad(lc, "pad 1");

            Assert.False(result.Success);
            Assert.Contains("already exists", result.Detail);
            Assert.Single(lc.LaunchPads);
        }

        [Fact]
        public void Refuses_a_pad_with_no_name_in_RP1s_own_words()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, pads: 1);

            foreach (var name in new[] { null, "", "   " })
            {
                var result = NewPad(lc, name);
                Assert.False(result.Success);
                Assert.Contains("name for the new launchpad", result.Detail);
            }
            Assert.Single(lc.LaunchPads);
        }

        [Fact]
        public void Refuses_a_pad_at_the_hangar_which_has_none()
        {
            var ksc = Centre();
            var hangar = ComplexAt(ksc, "Hangar", pads: 0, type: LaunchComplexType.Hangar);

            var result = NewPad(hangar);

            Assert.False(result.Success);
            // RP-1 prices a hangar's pad half at zero and never draws the control, so
            // a pad queued here would cost nothing and do nothing.
            Assert.Contains("no launch pads", result.Detail);
            Assert.Empty(hangar.LaunchPads);
        }

        [Fact]
        public void Refuses_a_pad_when_RP1_has_no_tonnage_band_for_it()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, pads: 1);
            // RP-1's own "no band" answer, which happens when its tonnage table is
            // absent. A pad built at that level would be unusable.
            lc.StatsValue.PadFracLevelValue = -1f;

            var result = NewPad(lc);

            Assert.False(result.Success);
            Assert.Contains("tonnage band", result.Detail);
            Assert.Single(lc.LaunchPads);
        }

        // ── The observable lists ─────────────────────────────────────────────

        [Fact]
        public void A_queued_project_is_added_through_the_SHADOWING_Add()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);

            Assert.True(New().Success);
            Assert.True(Modify(lc, mass: 150).Success);
            Assert.True(NewPad(lc).Success);

            // THE ASSERTION THIS TEST EXISTS FOR. Both lists are
            // PersistentObservableList, whose Add HIDES List<T>.Add and fires the
            // events RP-1's own UI listens on. Bound to the base overload the
            // projects are queued and every subscriber is told nothing, and a
            // count-based assertion agrees completely. Observed is what the shadowing
            // Add records, so it is empty exactly when the wrong overload was bound.
            Assert.Equal(ksc.LCConstructions.Count, ksc.LCConstructions.Observed.Count);
            Assert.Equal(2, ksc.LCConstructions.Observed.Count);
            Assert.Single(lc.PadConstructions.Observed);
        }

        [Fact]
        public void A_complex_and_a_pad_go_in_through_the_BASE_Add_as_RP1_adds_them()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, pads: 1);

            Assert.True(New().Success);
            Assert.True(NewPad(lc).Success);

            // The other half of the same rule, and it is not symmetric: RP-1 keeps
            // LaunchComplexes and LaunchPads as plain PersistentList and its own IL
            // calls the BASE Add on both. Matching whichever RP-1 uses is the whole
            // discipline; guessing one for all four would be wrong twice.
            Assert.Equal(2, ksc.LaunchComplexes.Count);
            Assert.Equal(2, lc.LaunchPads.Count);
        }

        // ── The career branch ────────────────────────────────────────────────

        [Fact]
        public void Outside_a_career_the_change_is_applied_rather_than_queued()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f, pads: 1);
            KSPUtils.IsCareer = false;

            var built = New();
            var renovated = Modify(lc, mass: 150);
            var padded = NewPad(lc);

            Assert.True(built.Success);
            Assert.True(renovated.Success);
            Assert.True(padded.Success);

            // Nothing queued anywhere: there is no funding to draw a project
            // against, so RP-1 applies the change at once and so do we.
            Assert.Empty(ksc.LCConstructions);
            Assert.Empty(lc.PadConstructions);
            Assert.False((bool)built.Payload!["queued"]!);
            Assert.False((bool)renovated.Payload!["queued"]!);
            Assert.False((bool)padded.Payload!["queued"]!);

            // And the results are live immediately.
            Assert.True(ksc.LaunchComplexes.Single(c => c.Name == "LC-2").IsOperational);
            Assert.Equal(150f, lc.Stats.massMax);
            Assert.True(lc.LaunchPads[1].isOperational);
        }

        [Fact]
        public void Refuses_everything_when_RP1s_career_test_cannot_be_asked()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            KSPUtils.Throws = true;
            try
            {
                var result = New();

                Assert.False(result.Success);
                // Refused rather than assumed either way. enabledForSave is true for
                // sandbox too, so a guess of "career" queues a funded project on a
                // save with no funding and leaves it stalled forever with nothing
                // saying why.
                Assert.Contains("career", result.Detail);
                Assert.Empty(ksc.LaunchComplexes.Where(c => c.Name == "LC-2"));
                Assert.Empty(ksc.LCConstructions);
            }
            finally
            {
                KSPUtils.Throws = false;
            }
        }

        // ── Resources ────────────────────────────────────────────────────────

        [Fact]
        public void Stores_a_handled_resource_rounded_up_as_RP1_rounds_it()
        {
            var ksc = Centre();
            Database.ResourceInfo.LCResourceTypes["LqdOxygen"] = 1;

            var result = New(resources: new Dictionary<string, double> { ["LqdOxygen"] = 1200.4 });

            Assert.True(result.Success);
            // Math.Ceiling, which is what RP-1's own field does before it stores
            // them: a fractional unit of propellant is not a thing a tank holds.
            Assert.Equal(1201.0, Assert.Single(ksc.LaunchComplexes).Stats.resourcesHandled["LqdOxygen"]);
        }

        [Fact]
        public void Refuses_a_resource_the_complex_cannot_handle_BY_NAME()
        {
            var ksc = Centre();
            Database.ResourceInfo.LCResourceTypes["LqdOxygen"] = 1;
            // Flagged pad-ignore, so a pad complex does not handle it.
            Database.ResourceInfo.LCResourceTypes["Nitrogen"] = 1 | 4;

            var result = New(resources: new Dictionary<string, double>
            {
                ["LqdOxygen"] = 1000,
                ["Nitrogen"] = 500,
            });

            Assert.False(result.Success);
            // Refused by NAME rather than dropped. RP-1 stores an unhandled resource
            // silently and prices it at nothing, so a dropped one is a complex that
            // cannot fuel the vehicle it was built for and says nothing about why.
            Assert.Contains("Nitrogen", result.Detail);
            Assert.Empty(ksc.LaunchComplexes);
        }

        [Fact]
        public void A_resource_sent_as_zero_is_how_a_client_removes_it()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            Database.ResourceInfo.LCResourceTypes["LqdOxygen"] = 1;
            lc.StatsValue.resourcesHandled["LqdOxygen"] = 1000.0;

            var result = Modify(lc, mass: 100, resources: new Dictionary<string, double> { ["LqdOxygen"] = 0 });

            Assert.True(result.Success);
            // RP-1 stores absence rather than a zero, so dropping it here is what
            // makes "send the whole set" mean what it says: a resource left out or
            // sent as zero is a resource the renovated complex will not handle.
            Assert.DoesNotContain("LqdOxygen", Assert.Single(ksc.LCConstructions).lcData.resourcesHandled.Keys);
        }

        // ── The refusals every one of them shares ────────────────────────────

        [Fact]
        public void Every_command_refuses_a_save_RP1_is_not_managing()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            SpaceCenterManagement.Instance!.enabledForSave = false;

            Assert.Equal(CommandErrorCode.ModeUnavailable, New().ErrorCode);
            Assert.Equal(CommandErrorCode.ModeUnavailable, Modify(lc).ErrorCode);
            Assert.Equal(CommandErrorCode.ModeUnavailable, NewPad(lc).ErrorCode);
            Assert.Empty(ksc.LCConstructions);
        }

        [Fact]
        public void Every_command_refuses_when_RP1s_space_centre_is_not_loaded()
        {
            var ksc = Centre();
            var lc = ComplexAt(ksc, massMax: 100f);
            SpaceCenterManagement.Instance = null;

            Assert.Equal(CommandErrorCode.ModeUnavailable, New().ErrorCode);
            Assert.Equal(CommandErrorCode.ModeUnavailable, Modify(lc).ErrorCode);
            Assert.Equal(CommandErrorCode.ModeUnavailable, NewPad(lc).ErrorCode);
        }

        [Fact]
        public void Modify_and_pad_refuse_a_complex_they_cannot_find()
        {
            Centre();
            var absent = Guid.NewGuid().ToString();

            Assert.Equal(
                CommandErrorCode.NotFound,
                _commands.ModifyComplex(new Rp1ComplexModifyArgs { LcId = absent, Size = Size() }).ErrorCode);
            Assert.Equal(
                CommandErrorCode.NotFound,
                _commands.NewPad(new Rp1PadNewArgs { LcId = absent, Name = "LP-2" }).ErrorCode);
        }

        [Fact]
        public void Finds_a_complex_at_a_centre_that_is_not_the_active_one()
        {
            var cape = Centre("Cape");
            ComplexAt(cape, "LC-1");
            var woomera = Centre("Woomera");
            var elsewhere = ComplexAt(woomera, "Woomera 1", massMax: 100f);

            // RP-1's own surface can only renovate the ACTIVE complex at the ACTIVE
            // centre, because that is all its window can address. The construction
            // project goes on THAT centre's queue rather than the active one's, which
            // is the half a naive port would get wrong.
            Assert.True(Modify(elsewhere, mass: 150).Success);
            Assert.Single(woomera.LCConstructions);
            Assert.Empty(cape.LCConstructions);
        }

        [Fact]
        public void The_diagnosis_names_every_member_it_found()
        {
            Assert.True(_commands.IsAvailable);
            Assert.True(_commands.IsPadAvailable);
            Assert.Equal("every invoked member resolved", _commands.MethodDiagnosis());
        }
    }
}
