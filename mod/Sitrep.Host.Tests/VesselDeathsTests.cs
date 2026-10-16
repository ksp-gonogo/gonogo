using Sitrep.Host.Crash;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Stock raises <c>onCrash</c> once per part that breaks, so an impact alone is never a
    /// death; only <c>onVesselWillDestroy</c> is, and an impact beside it names its cause.
    /// </summary>
    public class VesselDeathsTests
    {
        private const string Craft = "craft-1";

        private static VesselDeaths<string, string> Deaths() => new VesselDeaths<string, string>(2.0);

        [Fact]
        public void a_part_breaking_on_a_craft_that_flies_on_is_no_death()
        {
            var deaths = Deaths();

            deaths.Impact(Craft, "Crash", 100);

            Assert.Empty(deaths.Drain(100.1));
            Assert.Empty(deaths.Drain(200));
        }

        [Fact]
        public void a_death_with_no_impact_is_published_without_a_cause()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "burn-up", 100);

            var death = Assert.Single(deaths.Drain(100.1));
            Assert.Equal(Craft, death.VesselId);
            Assert.Equal("burn-up", death.Record);
            Assert.Null(death.Impact);
            Assert.Equal(100, death.Ut);
        }

        [Fact]
        public void a_second_death_of_the_same_vessel_reports_that_it_was_dropped()
        {
            var deaths = Deaths();

            Assert.True(deaths.Death(Craft, "burn-up", 100));
            Assert.False(deaths.Death(Craft, "burn-up again", 100));
        }

        [Fact]
        public void an_impact_reported_after_the_death_on_the_same_stack_names_it()
        {
            var deaths = Deaths();

            // Part.explode runs Vessel.Die before onCrash is raised.
            deaths.Death(Craft, "root struck", 100);
            deaths.Impact(Craft, "Crash", 100);

            Assert.Equal("Crash", Assert.Single(deaths.Drain(100.1)).Impact);
        }

        [Fact]
        public void a_hard_splashdown_reported_before_the_death_names_it()
        {
            var deaths = Deaths();

            deaths.Impact(Craft, "CrashSplashdown", 100);
            deaths.Drain(100.02);
            deaths.Death(Craft, "root sank", 100.5);

            Assert.Equal("CrashSplashdown", Assert.Single(deaths.Drain(100.6)).Impact);
        }

        [Fact]
        public void a_leg_lost_long_before_a_burn_up_is_not_its_cause()
        {
            var deaths = Deaths();

            deaths.Impact(Craft, "Crash", 100);
            deaths.Drain(100.1);
            deaths.Death(Craft, "burn-up", 5000);

            Assert.Null(Assert.Single(deaths.Drain(5000.1)).Impact);
        }

        [Fact]
        public void the_first_impact_beside_a_held_death_is_its_cause()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "root struck", 100);
            deaths.Impact(Craft, "Crash", 100);
            deaths.Impact(Craft, "CrashSplashdown", 100);

            Assert.Equal("Crash", Assert.Single(deaths.Drain(100.1)).Impact);
        }

        [Fact]
        public void a_crash_through_terrain_alone_is_one_death()
        {
            var deaths = Deaths();

            // Vessel.Die never runs, so onVesselExplodeGroundCollision is the only report.
            deaths.Death(Craft, "whole craft", 100);

            var death = Assert.Single(deaths.Drain(100.1));
            Assert.Equal("whole craft", death.Record);
            Assert.Null(death.Impact);
            Assert.Empty(deaths.Drain(100.2));
        }

        [Fact]
        public void a_crash_through_terrain_then_the_impact_then_the_destruction_is_one_death()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "whole craft", 100);
            deaths.Impact(Craft, "Crash", 100);
            deaths.Death(Craft, "torn craft", 100);

            var death = Assert.Single(deaths.Drain(100.1));
            Assert.Equal("whole craft", death.Record);
            Assert.Equal("Crash", death.Impact);
            Assert.Empty(deaths.Drain(100.2));
        }

        [Fact]
        public void a_destruction_reported_after_the_crash_was_published_is_not_a_second_death()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "whole craft", 100);
            Assert.Single(deaths.Drain(100.1));

            deaths.Death(Craft, "torn craft", 100.5);

            Assert.Empty(deaths.Drain(100.6));
        }

        [Fact]
        public void a_destruction_alone_is_one_death_as_before()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "burn-up", 100);

            Assert.Equal("burn-up", Assert.Single(deaths.Drain(100.1)).Record);
        }

        [Fact]
        public void one_death_is_published_once()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "first", 100);
            deaths.Death(Craft, "again", 100);
            Assert.Single(deaths.Drain(100.1));

            deaths.Death(Craft, "late", 101);
            Assert.Empty(deaths.Drain(101.1));
        }

        [Fact]
        public void a_reused_id_dies_again_once_the_window_has_passed()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "first flight", 100);
            deaths.Drain(100.1);
            deaths.Death(Craft, "second flight", 900);

            Assert.Equal("second flight", Assert.Single(deaths.Drain(900.1)).Record);
        }

        [Fact]
        public void a_recovered_craft_is_not_also_destroyed()
        {
            var deaths = Deaths();

            Assert.True(deaths.TryEnd(Craft, 100));
            deaths.Death(Craft, "recovered then torn down", 100);

            Assert.Empty(deaths.Drain(100.1));
        }

        [Fact]
        public void a_craft_whose_death_is_held_is_not_also_recovered()
        {
            var deaths = Deaths();

            deaths.Death(Craft, "died", 100);

            Assert.False(deaths.TryEnd(Craft, 100));
        }

        [Fact]
        public void deaths_drain_in_the_order_they_happened()
        {
            var deaths = Deaths();

            deaths.Death("b", "b", 100);
            deaths.Death("a", "a", 100);

            var drained = deaths.Drain(100.1);
            Assert.Equal(new[] { "b", "a" }, new[] { drained[0].VesselId, drained[1].VesselId });
        }

        [Fact]
        public void a_death_replayed_after_a_quickload_is_published_again()
        {
            var deaths = Deaths();
            deaths.Death(Craft, "first time", 100);
            deaths.Drain(100.1);
            deaths.Drain(101);

            // F9 to a second before the crash, which then happens again.
            deaths.Drain(99.5);
            deaths.Death(Craft, "again", 100.2);

            Assert.Equal("again", Assert.Single(deaths.Drain(100.3)).Record);
        }
    }
}
