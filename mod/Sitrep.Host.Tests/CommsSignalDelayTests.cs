using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The CORE SignalDelay light-time math (comms-uplink-design.md §3).
    /// Pure — exercises gonogo's own computation over backend-supplied hop
    /// geometry with no KSP in the loop.
    /// </summary>
    public class CommsSignalDelayTests
    {
        private static CommsPath PathWith(params double?[] hopDistances)
        {
            var hops = new List<CommsHop>();
            foreach (var d in hopDistances)
            {
                hops.Add(new CommsHop { From = "a", To = "b", Kind = CommsHopKind.Relay, DistanceMeters = d });
            }
            return new CommsPath { Hops = hops };
        }

        [Fact]
        public void FlagOff_YieldsZeroDelayWithSourceNone()
        {
            var result = SignalDelay.Compute(SignalDelayConfig.Off(), PathWith(1.0e9), "vessel:x", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Equal(0.0, result.OneWaySeconds);
            // R7: meta rides every datum.
            Assert.Equal("vessel:x", result.Meta.Source);
            Assert.Equal(Quality.OnRails, result.Meta.Quality);
        }

        [Fact]
        public void FlagOn_ComputesOneWayLightTimeAtRealSpeed()
        {
            // One light-second is exactly SpeedOfLight metres.
            var oneLightSecond = SignalDelay.SpeedOfLightMetersPerSecond;
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            var result = SignalDelay.Compute(cfg, PathWith(oneLightSecond), "vessel:x", Quality.Loaded);

            Assert.Equal(CommsDelaySource.SignalDelay, result.Source);
            Assert.Equal(1.0, result.OneWaySeconds, 9);
            Assert.Equal(Quality.Loaded, result.Meta.Quality);
        }

        [Fact]
        public void SumsMultiHopDistances()
        {
            var c = SignalDelay.SpeedOfLightMetersPerSecond;
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            // 0.5 + 0.25 + 0.25 light-seconds of distance => 1.0s one-way.
            var result = SignalDelay.Compute(cfg, PathWith(0.5 * c, 0.25 * c, 0.25 * c), "s", Quality.OnRails);

            Assert.Equal(1.0, result.OneWaySeconds, 9);
        }

        [Fact]
        public void LightSpeedScale_ShortensDelayProportionally()
        {
            var c = SignalDelay.SpeedOfLightMetersPerSecond;
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 2.0 };

            // Scale 2.0 => effective c doubled => half the delay.
            var result = SignalDelay.Compute(cfg, PathWith(c), "s", Quality.OnRails);

            Assert.Equal(0.5, result.OneWaySeconds, 9);
        }

        [Fact]
        public void EmptyPath_YieldsSourceNone()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            var result = SignalDelay.Compute(cfg, new CommsPath { Hops = new List<CommsHop>() }, "s", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Equal(0.0, result.OneWaySeconds);
        }

        [Fact]
        public void NullPath_YieldsSourceNone()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            var result = SignalDelay.Compute(cfg, null, "s", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
        }

        [Fact]
        public void MissingHopGeometry_IsTypedAbsence_NotTreatedAsZero()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            // One real hop + one hop with null distance ⇒ incomplete geometry
            // ⇒ cannot honestly total a light-time ⇒ None (NOT "just the one
            // known hop", NOT treating the missing hop as 0m).
            var result = SignalDelay.Compute(cfg, PathWith(1.0e9, null), "s", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Equal(0.0, result.OneWaySeconds);
        }

        [Fact]
        public void NonPositiveScale_YieldsSourceNone_NoDivideByZero()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 0.0 };

            var result = SignalDelay.Compute(cfg, PathWith(1.0e9), "s", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Equal(0.0, result.OneWaySeconds);
        }
    }
}
