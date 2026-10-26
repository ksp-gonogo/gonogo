using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The one-way delay over a long relay chain, at distances the stock system
    /// actually has, and the typed-absence rule for a hop whose length is not a
    /// real distance.
    /// </summary>
    public class CommsRelayChainDelayTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        // Kerbin to Eeloo: Eeloo's apoapsis (113.5 Gm) plus Kerbin's (13.6 Gm) on opposite sides of the Sun.
        private static readonly double[] EightHops =
        {
            2.1e9, 18.4e9, 17.9e9, 15.2e9, 16.8e9, 19.3e9, 21.7e9, 15.8e9,
        };

        private static CommsPath PathOf(params double?[] distances) => new CommsPath
        {
            Hops = distances
                .Select((d, i) => new CommsHop { From = "n" + i, To = "n" + (i + 1), Kind = CommsHopKind.Relay, DistanceMeters = d })
                .ToList(),
        };

        private static List<CommsRouteHop> RouteOf(params double[] distances) =>
            distances.Select(d => new CommsRouteHop(d, touchesHome: false)).ToList();

        [Fact]
        public void EightHopChain_OneWayIsTheSumOfHopDistancesOverC()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };
            var expected = EightHops.Sum() / C;

            var delay = SignalDelay.Compute(cfg, PathOf(EightHops.Select(d => (double?)d).ToArray()), "vessel:probe");

            Assert.Equal(expected, delay.OneWaySeconds!.Value, 6);
            Assert.InRange(delay.OneWaySeconds.Value, 300, 450);
        }

        [Fact]
        public void EightHopChain_JourneyKeepsHopOrderAndEndsOnTheTotal()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            var journey = SignalDelay.ComputeJourney(cfg, RouteOf(EightHops))!;
            var total = SignalDelay.Compute(cfg, PathOf(EightHops.Select(d => (double?)d).ToArray()), "s").OneWaySeconds!.Value;

            Assert.Equal(8, journey.Hops.Count);
            Assert.Equal(total, journey.TotalSeconds);
            for (var i = 0; i < 8; i++)
            {
                Assert.Equal(EightHops[i] / C, journey.Hops[i].Seconds, 6);
            }
        }

        [Fact]
        public void ReducedLightSpeed_GivesHoursOfDelayWithoutLosingPrecision()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 0.01 };

            var delay = SignalDelay.Compute(cfg, PathOf(EightHops.Select(d => (double?)d).ToArray()), "s");

            Assert.Equal(EightHops.Sum() / (C * 0.01), delay.OneWaySeconds!.Value, 3);
            Assert.True(delay.OneWaySeconds.Value > 3 * 3600);
        }

        [Fact]
        public void TheSmallestLightSpeedGivesDelaysOfYearsWithoutOverflowOrLosingPrecision()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1e-8 };

            var mun = SignalDelay.Compute(cfg, PathOf(12.0e6), "s");
            var eeloo = SignalDelay.Compute(cfg, PathOf(EightHops.Select(d => (double?)d).ToArray()), "s");

            Assert.Equal(12.0e6 / (C * 1e-8), mun.OneWaySeconds!.Value, 3);
            Assert.InRange(mun.OneWaySeconds.Value, 3.9e6, 4.1e6);
            Assert.Equal(EightHops.Sum() / (C * 1e-8), eeloo.OneWaySeconds!.Value, 0);
            Assert.True(eeloo.OneWaySeconds.Value > int.MaxValue);
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(double.NegativeInfinity)]
        [InlineData(-1.0e9)]
        public void AHopWhoseLengthIsNotARealDistance_IsAbsenceNotADelay(double bad)
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            var delay = SignalDelay.Compute(cfg, PathOf(1.0e9, bad, 1.0e9), "s");

            Assert.Null(delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.None, delay.Source);
        }

        [Fact]
        public void AnInfiniteLightSpeedScale_IsAbsenceNotAZeroDelay()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = double.PositiveInfinity };

            Assert.Null(SignalDelay.EffectiveC(cfg));
            Assert.Null(SignalDelay.Compute(cfg, PathOf(1.0e9), "s").OneWaySeconds);
            Assert.Null(SignalDelay.ComputeJourney(cfg, RouteOf(1.0e9)));
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(-1.0e9)]
        public void AJourneyOverAHopWhoseLengthIsNotARealDistance_IsAbsence(double bad)
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            Assert.Null(SignalDelay.ComputeJourney(cfg, RouteOf(1.0e9, bad, 1.0e9)));
        }
    }
}
