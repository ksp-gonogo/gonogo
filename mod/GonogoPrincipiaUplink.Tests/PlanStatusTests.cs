// The plan's integration status and its next-burn index, which used to be read
// off the producer's planner window and are now asked of the plugin.
//
// The window mirror that carried them answered only while the player had that
// panel open, so these are not a new capability: they are the same five facts
// with an availability a telemetry channel is allowed to have. What is genuinely
// new is that two of them are BETTER, and one test below is about exactly that:
// the window's status was the outcome of the last edit the player made in the
// panel, cleared once shown, while the plugin's is the plan's own.
using System;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class PlanStatusTests
    {
        private const string Guid = "vessel-1";

        /// <summary>
        /// A career vessel with a two-burn plan, and the status the plugin will
        /// answer with.
        /// </summary>
        private static PlanObservation Read(object? status, double nowUt = 1000.0)
        {
            var plugin = new FakePrincipiaPlugin { PlanStatus = status };
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 2);
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out var reason),
                reason);

            var observation = new PlanReader().Read(session, Guid, nowUt, new FakeCelestialNames());
            Assert.NotNull(observation);
            return observation!;
        }

        [Fact]
        public void A_healthy_plan_reports_integrated_with_no_error_and_no_deadline()
        {
            var plan = Read(FakeStatus.Ok());

            Assert.True(plan.PlanIntegrated);
            Assert.Null(plan.StatusError);
            Assert.Null(plan.StatusMessage);
            Assert.False(plan.ReachedDeadline);
        }

        [Fact]
        public void A_failed_plan_carries_the_producers_own_code_and_words()
        {
            var plan = Read(FakeStatus.Declined(11, "The Δv is out of range."));

            Assert.False(plan.PlanIntegrated);
            Assert.Equal(11, plan.StatusError);
            Assert.Equal("The Δv is out of range.", plan.StatusMessage);
        }

        /// <summary>
        /// The producer states this as <c>is_deadline_exceeded()</c>, whose body is
        /// <c>return error == 4;</c>. Read as the comparison rather than the
        /// predicate, so the number is pinned by a test rather than only by a
        /// comment.
        /// </summary>
        [Fact]
        public void A_plan_that_ran_out_of_steps_reports_the_deadline()
        {
            var plan = Read(FakeStatus.Declined(4, "Exceeded max steps."));

            Assert.True(plan.ReachedDeadline);
            Assert.False(plan.PlanIntegrated);
            Assert.Equal(4, plan.StatusError);
        }

        /// <summary>
        /// The tri-state, and the case the whole reading turns on. An unreadable
        /// status must resolve to "cannot say" and never to "fine": collapsing it
        /// would report health from a failed read, and a plan whose status we cannot
        /// see is a plan we cannot vouch for.
        /// </summary>
        [Fact]
        public void A_status_that_could_not_be_read_says_nothing_rather_than_healthy()
        {
            var plan = Read(status: null);

            Assert.Null(plan.PlanIntegrated);
            Assert.Null(plan.ReachedDeadline);
            Assert.Null(plan.StatusError);
        }

        /// <summary>The same, for an object that is not the shape a status has.</summary>
        [Fact]
        public void A_status_of_the_wrong_shape_says_nothing_rather_than_healthy()
        {
            var plan = Read(status: "not a status");

            Assert.Null(plan.PlanIntegrated);
        }

        // ── The next burn ───────────────────────────────────────────────────

        /// <summary>
        /// The producer's own rule: the first burn whose CUTOFF is still ahead, not
        /// the first whose ignition is. A burn already under way is the one being
        /// flown, and calling it past would point an operator at the burn after the
        /// one their engines are lit for.
        /// </summary>
        [Fact]
        public void The_next_burn_is_the_first_whose_cutoff_is_still_ahead()
        {
            var plan = Read(FakeStatus.Ok(), nowUt: 1000.0);

            Assert.NotEmpty(plan.Burns);
            var expected = plan.Burns.Find(b => b.CutoffUt > 1000.0);
            Assert.NotNull(expected);
            Assert.Equal(expected!.Index, plan.FirstFutureBurnIndex);
        }

        /// <summary>
        /// Absent, not zero, when every burn is behind the sample instant. Zero is a
        /// real burn index and would point an operator at the first burn of a plan
        /// that is entirely flown.
        /// </summary>
        [Fact]
        public void There_is_no_next_burn_once_every_burn_is_behind()
        {
            var plan = Read(FakeStatus.Ok(), nowUt: double.MaxValue / 2.0);

            Assert.NotEmpty(plan.Burns);
            Assert.Null(plan.FirstFutureBurnIndex);
        }
    }
}
