using System;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Warping to the next project or to the fund target, against the stand-in RP-1
    /// object graph.
    ///
    /// <para>The case that decides whether this surface is safe is
    /// <see cref="Refuses_a_warp_to_complete_when_nothing_is_in_progress"/>, and it
    /// is not a validation nicety. RP-1's own <c>Create</c> takes the next thing to
    /// finish, then logs its name with NO null check, and
    /// <c>GetNextThingToFinish</c> returns null both when there is no active space
    /// centre and when nothing anywhere is in progress. RP-1 never reaches it
    /// because its button is drawn inside a branch that already has a project (the
    /// other arm renders "No Active Projects"), so the NullReferenceException is
    /// latent and belongs to whoever calls without checking. Worse, <c>Create</c>
    /// has already attached its controller by then, so the throw leaves a warp
    /// controller with a null target in the scene.</para>
    ///
    /// <para>The fixture reproduces that defect rather than papering over it, which
    /// is what makes the test mean anything: a command that dropped the guard fails
    /// here with the same exception a career would give it.</para>
    /// </summary>
    public class Rp1WarpCommandsTests : IDisposable
    {
        private readonly Rp1WarpCommands _commands = new Rp1WarpCommands();

        public Rp1WarpCommandsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            KCTUtilities.Reset();
            KCTWarpController.Reset();
            HighLogic.LoadedSceneIsFlight = false;
            HighLogic.LoadedScene = GameScenes.SPACECENTER;
        }

        /// <summary>A career RP-1 is managing, at the space centre.</summary>
        private static SpaceCenterManagement Career()
        {
            var ksc = new LCSpaceCenter { KSCName = "Cape" };
            var scm = new SpaceCenterManagement { ActiveSC = ksc };
            scm.KSCs.Add(ksc);
            SpaceCenterManagement.Instance = scm;
            return scm;
        }

        private CommandResult ToComplete() => _commands.ToComplete(new Rp1WarpArgs());

        private CommandResult ToFundTarget() => _commands.ToFundTarget(new Rp1WarpArgs());

        // ── Warping to the next project ───────────────────────────────────────

        [Fact]
        public void Hands_RP1_the_project_that_finishes_next()
        {
            Career();
            var next = new FakeProject { Name = "Atlas-LV3" };
            KCTUtilities.NextThing = next;

            Assert.True(ToComplete().Success);

            // The project itself, not null: RP-1's Create treats null as "work it
            // out yourself", and passing null would be asking RP-1 the question this
            // command has already answered in order to guard it.
            Assert.Same(next, Assert.Single(KCTWarpController.Created));
        }

        [Fact]
        public void Refuses_a_warp_to_complete_when_nothing_is_in_progress()
        {
            Career();
            KCTUtilities.NextThing = null;

            var result = ToComplete();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Contains("nothing to warp to", result.Detail);
            // THE ASSERTION THIS FILE EXISTS FOR. Nothing reached RP-1 at all, so no
            // controller was attached and nothing threw. A command that dropped the
            // guard would have created one with a null target and left it there.
            Assert.Empty(KCTWarpController.Created);
        }

        [Fact]
        public void Treats_an_unreadable_project_queue_as_nothing_to_warp_to()
        {
            Career();
            KCTUtilities.ThrowOnNextThing = true;

            var result = ToComplete();

            Assert.False(result.Success);
            // The only thing this answer gates is whether Create would be handed a
            // null, so an unanswerable question and an empty queue want the same
            // refusal rather than a different one.
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(KCTWarpController.Created);
        }

        [Fact]
        public void Warps_to_a_project_that_will_not_name_itself()
        {
            Career();
            KCTUtilities.NextThing = new FakeProject { Nameless = true };

            // A project that will not name itself is still a project worth warping
            // to: the name is only for a sentence, and losing it must not cost the
            // act.
            Assert.True(ToComplete().Success);
            Assert.Single(KCTWarpController.Created);
        }

        [Fact]
        public void Reports_a_warp_that_may_have_started_when_RP1_throws_part_way()
        {
            Career();
            KCTUtilities.NextThing = new FakeProject();
            KCTWarpController.Throws = true;

            var result = ToComplete();

            Assert.False(result.Success);
            // Said as a warp that may be running rather than a plain refusal: Create
            // attaches its controller before it does anything else, so an operator
            // who read "refused" would not think to check the warp rate.
            Assert.Contains("check the warp rate", result.Detail);
        }

        // ── Warping to the fund target ────────────────────────────────────────

        [Fact]
        public void Hands_RP1_the_fund_target_itself()
        {
            var scm = Career();
            scm.fundTarget = new FundTargetProject(50_000.0, origFunds: 10_000.0);

            Assert.True(ToFundTarget().Success);

            // The fund target IS a project as far as RP-1 is concerned, which is why
            // warping to it is the same call rather than a separate mechanism: RP-1
            // puts it in its own project list alongside the rockets.
            Assert.Same(scm.fundTarget, Assert.Single(KCTWarpController.Created));
        }

        [Fact]
        public void Refuses_a_warp_to_a_fund_target_nobody_has_set()
        {
            var scm = Career();
            scm.fundTarget = new FundTargetProject();

            var result = ToFundTarget();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            // And it says which command sets one, because "no fund target" is a
            // state the operator can fix rather than a fault.
            Assert.Contains("rp1.fundTarget.set", result.Detail);
            Assert.Empty(KCTWarpController.Created);
        }

        [Fact]
        public void Refuses_a_fund_target_equal_to_the_balance_it_was_set_at()
        {
            var scm = Career();
            // RP-1's own validity rule, and it is not merely "non-zero": a target
            // equal to the balance it was set at is no instruction at all, and
            // warping toward it would never stop.
            scm.fundTarget = new FundTargetProject(10_000.0, origFunds: 10_000.0);

            Assert.False(ToFundTarget().Success);
            Assert.Empty(KCTWarpController.Created);
        }

        // ── The scene ─────────────────────────────────────────────────────────

        [Fact]
        public void Warps_in_flight_at_the_space_centre_and_at_the_tracking_station()
        {
            Career();
            KCTUtilities.NextThing = new FakeProject();

            foreach (var scene in new[] { GameScenes.SPACECENTER, GameScenes.TRACKSTATION })
            {
                KCTWarpController.Reset();
                HighLogic.LoadedSceneIsFlight = false;
                HighLogic.LoadedScene = scene;
                Assert.True(ToComplete().Success);
                Assert.Single(KCTWarpController.Created);
            }

            KCTWarpController.Reset();
            HighLogic.LoadedSceneIsFlight = true;
            HighLogic.LoadedScene = GameScenes.FLIGHT;
            Assert.True(ToComplete().Success);
            Assert.Single(KCTWarpController.Created);
        }

        [Fact]
        public void Refuses_a_warp_in_the_editor_because_RP1_would_never_step_it_down()
        {
            Career();
            KCTUtilities.NextThing = new FakeProject();
            HighLogic.LoadedSceneIsFlight = false;
            HighLogic.LoadedScene = GameScenes.EDITOR;

            var result = ToComplete();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongScene, result.ErrorCode);
            // The reason matters more than the refusal: RP-1's controller only ticks
            // in three scenes, so a warp started here would set a rate and never
            // step it down, overshooting the thing it was aimed at. That is worse
            // than not warping.
            Assert.Contains("overshoot", result.Detail);
            Assert.Empty(KCTWarpController.Created);
        }

        [Fact]
        public void The_scene_gate_answers_before_the_press()
        {
            HighLogic.LoadedScene = GameScenes.SPACECENTER;
            Assert.Equal(
                GateOutcome.Pass,
                _commands.Evaluate(Rp1WarpCommands.SceneRequirement(), null!).Outcome);

            HighLogic.LoadedScene = GameScenes.EDITOR;
            var verdict = _commands.Evaluate(Rp1WarpCommands.SceneRequirement(), null!);
            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            // A DECLARED gate, so the control is drawn dark with this sentence rather
            // than looking live and answering a press with a wasted warp.
            Assert.Equal(CommandErrorCode.WrongScene, verdict.ErrorCode);
            Assert.Contains("space centre", verdict.Detail);
        }

        [Fact]
        public void The_scene_gate_declines_a_quantity_RP1_has_no_opinion_about()
        {
            var verdict = _commands.Evaluate(
                new CommandRequirement { Kind = Rp1WarpCommands.GateKind, Quantity = "somethingElse" },
                null!);

            // Unknown rather than a pass or a fail: a gate asked a question it does
            // not answer must not pretend either way.
            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }

        // ── The refusals both share ───────────────────────────────────────────

        [Fact]
        public void Both_refuse_a_save_RP1_is_not_managing()
        {
            var scm = Career();
            scm.enabledForSave = false;
            KCTUtilities.NextThing = new FakeProject();
            scm.fundTarget = new FundTargetProject(50_000.0, origFunds: 10_000.0);

            Assert.Equal(CommandErrorCode.ModeUnavailable, ToComplete().ErrorCode);
            Assert.Equal(CommandErrorCode.ModeUnavailable, ToFundTarget().ErrorCode);
            Assert.Empty(KCTWarpController.Created);
        }

        [Fact]
        public void Both_refuse_when_RP1s_space_centre_is_not_loaded()
        {
            KCTUtilities.NextThing = new FakeProject();

            Assert.Equal(CommandErrorCode.ModeUnavailable, ToComplete().ErrorCode);
            Assert.Equal(CommandErrorCode.ModeUnavailable, ToFundTarget().ErrorCode);
            Assert.Empty(KCTWarpController.Created);
        }

        [Fact]
        public void The_diagnosis_names_every_member_it_found()
        {
            Assert.True(_commands.IsAvailable);
            Assert.Equal("every invoked member resolved", _commands.MethodDiagnosis());
        }
    }
}
