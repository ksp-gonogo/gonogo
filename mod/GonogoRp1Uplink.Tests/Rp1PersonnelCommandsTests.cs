using System;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Staffing a launch complex, against the stand-in RP-1 object graph.
    ///
    /// <para>Four cases here decide whether the write is safe, and every one of
    /// them is a way to corrupt a career rather than a way to be untidy:</para>
    /// <list type="bullet">
    /// <item><see cref="Never_touches_a_space_centre_pool"/>. RP-1 declares
    /// <c>ChangeEngineers</c> twice with the same arity, one taking a complex and
    /// one a whole space centre. A resolver matching on arity alone gets a coin
    /// flip, and the wrong side of it silently edits the centre's hired
    /// headcount, which is the number salaries are drawn against.</item>
    /// <item><see cref="Refuses_more_than_the_centre_has_unassigned"/>.
    /// <c>ChangeEngineers</c> clamps nothing at all, so an unchecked target drives
    /// the centre's unassigned pool NEGATIVE and every complex's build rate with
    /// it.</item>
    /// <item><see cref="Refuses_more_than_the_complex_can_hold"/>. The same
    /// hazard from the other end: a complex above its own maximum is a state
    /// RP-1's own window cannot produce.</item>
    /// <item><see cref="Refuses_a_complex_that_is_being_built_or_modified"/>. RP-1
    /// holds the crew itself for the duration and puts them back by ADDING, so a
    /// crew assigned mid-construction is still there when the re-add lands and
    /// the complex finishes over its maximum.</item>
    /// </list>
    ///
    /// <para>What these cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: they prove the handler invokes the member it claims to
    /// and refuses where it claims to, and nothing whatever about the values a
    /// running RP-1 would hold.</para>
    /// </summary>
    public class Rp1PersonnelCommandsTests : IDisposable
    {
        private readonly Rp1PersonnelCommands _commands = new Rp1PersonnelCommands();

        public Rp1PersonnelCommandsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            KCTUtilities.Reset();
        }

        /// <summary>
        /// One centre with the engineers it has hired, and one operational
        /// complex holding some of them.
        /// </summary>
        private static LaunchComplex Staffed(
            int hired = 30,
            int assigned = 10,
            int max = 60,
            bool operational = true)
        {
            var lc = new LaunchComplex
            {
                Name = "LC-1",
                IsOperational = operational,
                Engineers = assigned,
                MaxEngineersValue = max,
            };
            var ksc = new LCSpaceCenter { KSCName = "Cape", Engineers = hired };
            ksc.LaunchComplexes.Add(lc);
            lc.Ksc = ksc;
            SpaceCenterManagement.Instance = new SpaceCenterManagement { ActiveSC = ksc };
            SpaceCenterManagement.Instance.KSCs.Add(ksc);
            return lc;
        }

        private CommandResult Assign(LaunchComplex lc, int? engineers) =>
            _commands.Assign(new Rp1PersonnelAssignArgs
            {
                LcId = lc.ID.ToString(),
                Engineers = engineers,
            });

        [Fact]
        public void Assigns_the_difference_and_leaves_the_complex_on_the_target()
        {
            var lc = Staffed(hired: 30, assigned: 10);

            var result = _commands.Assign(new Rp1PersonnelAssignArgs
            {
                LcId = lc.ID.ToString(),
                Engineers = 25,
            });

            Assert.True(result.Success);
            Assert.Equal(25, lc.Engineers);
            // The DELTA is what RP-1 is told, because that is the shape of its own
            // call; the operator asked for a total.
            Assert.Equal(15, Assert.Single(KCTUtilities.EngineerChanges).Value);
        }

        [Fact]
        public void Takes_a_crew_back_off_when_the_target_is_lower()
        {
            var lc = Staffed(hired: 30, assigned: 20);

            Assert.True(Assign(lc, 4).Success);

            Assert.Equal(4, lc.Engineers);
            Assert.Equal(-16, Assert.Single(KCTUtilities.EngineerChanges).Value);
        }

        [Fact]
        public void Never_touches_a_space_centre_pool()
        {
            var lc = Staffed(hired: 30, assigned: 10);
            var hiredBefore = lc.Ksc!.Engineers;

            Assert.True(Assign(lc, 20).Success);

            // The SUBJECT of every call, not the count: a handler that resolved
            // ChangeEngineers by arity alone would move the centre while a
            // call-counting assertion stayed green.
            Assert.All(
                KCTUtilities.EngineerChanges,
                change => Assert.Same(lc, change.Key));
            Assert.Equal(hiredBefore, lc.Ksc!.Engineers);
            // The pool moves anyway, because RP-1 DERIVES it: hired minus what the
            // complexes hold. That is the whole reason assignment costs nothing at
            // the moment it lands.
            Assert.Equal(10, lc.Ksc!.UnassignedEngineers);
        }

        [Fact]
        public void Refuses_more_than_the_centre_has_unassigned()
        {
            var lc = Staffed(hired: 30, assigned: 10);

            var result = Assign(lc, 25 + 1);

            Assert.True(result.Success);
            Assert.Equal(26, lc.Engineers);

            var overdraw = Assign(lc, 40);

            Assert.False(overdraw.Success);
            Assert.Equal(CommandErrorCode.Range, overdraw.ErrorCode);
            Assert.Contains("unassigned", overdraw.Detail ?? "");
            // Nothing moved, and the refusal says why rather than clamping to
            // whatever would have fitted.
            Assert.Equal(26, lc.Engineers);
        }

        [Fact]
        public void Refuses_more_than_the_complex_can_hold()
        {
            var lc = Staffed(hired: 500, assigned: 10, max: 60);

            var result = Assign(lc, 61);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Contains("60", result.Detail ?? "");
            Assert.Equal(10, lc.Engineers);
            Assert.Empty(KCTUtilities.EngineerChanges);
        }

        [Fact]
        public void Refuses_a_complex_that_is_being_built_or_modified()
        {
            var lc = Staffed(hired: 30, assigned: 0, operational: false);

            var result = Assign(lc, 10);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Equal(0, lc.Engineers);
            Assert.Empty(KCTUtilities.EngineerChanges);
        }

        [Fact]
        public void A_target_already_met_succeeds_and_changes_nothing()
        {
            var lc = Staffed(hired: 30, assigned: 12);

            Assert.True(Assign(lc, 12).Success);

            Assert.Equal(12, lc.Engineers);
            // The point of a SET rather than a delta: re-sending it is harmless,
            // which is what makes it safe to press from a stale view.
            Assert.Empty(KCTUtilities.EngineerChanges);
        }

        [Fact]
        public void Refuses_a_command_that_names_no_crew_size()
        {
            var lc = Staffed();

            var result = Assign(lc, null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Empty(KCTUtilities.EngineerChanges);
        }

        [Fact]
        public void Refuses_a_negative_crew()
        {
            var lc = Staffed(assigned: 5);

            var result = Assign(lc, -1);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Equal(5, lc.Engineers);
        }

        [Fact]
        public void Refuses_a_complex_no_centre_has()
        {
            Staffed();

            var result = _commands.Assign(new Rp1PersonnelAssignArgs
            {
                LcId = Guid.NewGuid().ToString(),
                Engineers = 5,
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        }

        [Fact]
        public void Staffs_a_complex_at_a_centre_the_game_is_not_looking_at()
        {
            var cape = Staffed(hired: 30, assigned: 10);
            var vandenberg = new LaunchComplex
            {
                Name = "SLC-3",
                IsOperational = true,
                Engineers = 0,
                MaxEngineersValue = 40,
            };
            var second = new LCSpaceCenter { KSCName = "Vandenberg", Engineers = 12 };
            second.LaunchComplexes.Add(vandenberg);
            vandenberg.Ksc = second;
            SpaceCenterManagement.Instance!.KSCs.Add(second);

            // ActiveSC is still Cape. A walk that only looked there would refuse a
            // complex the operator can see listed, which is the whole reason the
            // lookup is over every centre.
            Assert.Same(cape.Ksc, SpaceCenterManagement.Instance!.ActiveSC);
            Assert.True(Assign(vandenberg, 12).Success);
            Assert.Equal(12, vandenberg.Engineers);
            Assert.Equal(0, second.UnassignedEngineers);
        }

        [Fact]
        public void Refuses_when_RP1_is_not_managing_the_save()
        {
            var lc = Staffed();
            SpaceCenterManagement.Instance!.enabledForSave = false;

            var result = Assign(lc, 20);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(KCTUtilities.EngineerChanges);
        }

        [Fact]
        public void The_health_fact_names_the_member_a_refusal_would_be_about()
        {
            Assert.Equal("every invoked member resolved", _commands.MethodDiagnosis());
        }
    }
}
