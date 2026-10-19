using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ChargeRateEstimatorTests
    {
        private const double Max = 1000.0;
        private const double Drain = 0.0687;

        private static double? Feed(ChargeRateEstimator estimator, string vessel, double fromUt, int seconds, double startAmount, double rate)
        {
            double? last = null;
            for (var i = 0; i <= seconds; i++)
            {
                last = estimator.Observe(vessel, fromUt + i, startAmount + rate * i, Max);
            }
            return last;
        }

        [Fact]
        public void a_first_sample_has_no_rate_yet()
        {
            Assert.Null(new ChargeRateEstimator().Observe("v", 100, 500, Max));
        }

        [Fact]
        public void a_steady_drain_reads_back_as_its_rate()
        {
            var rate = Feed(new ChargeRateEstimator(), "v", 100, 12, 500, -Drain);

            Assert.NotNull(rate);
            Assert.Equal(-Drain, rate!.Value, 6);
        }

        [Fact]
        public void a_steady_charge_reads_back_as_a_positive_rate()
        {
            var rate = Feed(new ChargeRateEstimator(), "v", 100, 12, 500, 1.5);

            Assert.Equal(1.5, rate!.Value, 6);
        }

        [Fact]
        public void a_full_battery_is_unknown_not_zero()
        {
            Assert.Null(Feed(new ChargeRateEstimator(), "v", 100, 12, Max, 0));
        }

        [Fact]
        public void an_empty_battery_is_unknown_not_zero()
        {
            Assert.Null(Feed(new ChargeRateEstimator(), "v", 100, 12, 0, 0));
        }

        [Fact]
        public void a_rate_stays_unknown_until_the_full_sample_leaves_the_window()
        {
            var estimator = new ChargeRateEstimator();
            Feed(estimator, "v", 100, 5, Max, 0);

            var soon = Feed(estimator, "v", 106, 5, Max - Drain, -Drain);
            var later = Feed(estimator, "v", 112, 12, Max - Drain * 7, -Drain);

            Assert.Null(soon);
            Assert.Equal(-Drain, later!.Value, 6);
        }

        [Fact]
        public void another_vessel_starts_a_fresh_window()
        {
            var estimator = new ChargeRateEstimator();
            Feed(estimator, "a", 100, 12, 500, -Drain);

            Assert.Null(estimator.Observe("b", 113, 200, Max));
        }

        [Fact]
        public void a_capacity_change_starts_a_fresh_window()
        {
            var estimator = new ChargeRateEstimator();
            Feed(estimator, "v", 100, 12, 500, -Drain);

            Assert.Null(estimator.Observe("v", 113, 700, Max + 400));
        }

        [Fact]
        public void time_running_backwards_starts_a_fresh_window()
        {
            var estimator = new ChargeRateEstimator();
            Feed(estimator, "v", 100, 12, 500, -Drain);

            Assert.Null(estimator.Observe("v", 50, 500, Max));
        }

        [Fact]
        public void samples_a_warp_step_apart_still_give_a_rate()
        {
            var estimator = new ChargeRateEstimator();
            estimator.Observe("v", 1000, 500, Max);

            var rate = estimator.Observe("v", 1100, 500 - Drain * 100, Max);

            Assert.Equal(-Drain, rate!.Value, 6);
        }

        [Fact]
        public void a_pulsing_load_is_averaged_over_the_window()
        {
            var estimator = new ChargeRateEstimator();
            double? rate = null;
            var amount = 500.0;
            for (var i = 0; i <= 20; i++)
            {
                rate = estimator.Observe("v", 100 + i, amount, Max);
                amount -= i % 2 == 0 ? 3.0 : 0.0;
            }

            Assert.Equal(-1.5, rate!.Value, 1);
        }
    }
}
