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
            Assert.NotNull(result.OneWaySeconds);
            Assert.Equal(1.0, result.OneWaySeconds!.Value, 9);
            Assert.Equal(Quality.Loaded, result.Meta.Quality);
        }

        [Fact]
        public void SumsMultiHopDistances()
        {
            var c = SignalDelay.SpeedOfLightMetersPerSecond;
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            // 0.5 + 0.25 + 0.25 light-seconds of distance => 1.0s one-way.
            var result = SignalDelay.Compute(cfg, PathWith(0.5 * c, 0.25 * c, 0.25 * c), "s", Quality.OnRails);

            Assert.NotNull(result.OneWaySeconds);
            Assert.Equal(1.0, result.OneWaySeconds!.Value, 9);
        }

        [Fact]
        public void LightSpeedScale_ShortensDelayProportionally()
        {
            var c = SignalDelay.SpeedOfLightMetersPerSecond;
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 2.0 };

            // Scale 2.0 => effective c doubled => half the delay.
            var result = SignalDelay.Compute(cfg, PathWith(c), "s", Quality.OnRails);

            Assert.NotNull(result.OneWaySeconds);
            Assert.Equal(0.5, result.OneWaySeconds!.Value, 9);
        }

        [Fact]
        public void EmptyPath_YieldsSourceNoneAndNullOneWaySeconds()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            var result = SignalDelay.Compute(cfg, new CommsPath { Hops = new List<CommsHop>() }, "s", Quality.OnRails);

            // No measurable path ⇒ null, NOT 0 — 0 is reserved for the
            // delay-feature-disabled-but-connected case (see FlagOff test
            // above), so the two "None" cases stay distinguishable by value.
            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Null(result.OneWaySeconds);
        }

        [Fact]
        public void NullPath_YieldsSourceNoneAndNullOneWaySeconds()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            var result = SignalDelay.Compute(cfg, null, "s", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Null(result.OneWaySeconds);
        }

        [Fact]
        public void MissingHopGeometry_IsTypedAbsence_NotTreatedAsZero()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

            // One real hop + one hop with null distance ⇒ incomplete geometry
            // ⇒ cannot honestly total a light-time ⇒ null (NOT "just the one
            // known hop", NOT treating the missing hop as 0m, NOT the 0
            // reserved for delay-disabled).
            var result = SignalDelay.Compute(cfg, PathWith(1.0e9, null), "s", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Null(result.OneWaySeconds);
        }

        [Fact]
        public void NonPositiveScale_YieldsSourceNoneAndNullOneWaySeconds_NoDivideByZero()
        {
            var cfg = new SignalDelayConfig { Enabled = true, LightSpeedScale = 0.0 };

            var result = SignalDelay.Compute(cfg, PathWith(1.0e9), "s", Quality.OnRails);

            Assert.Equal(CommsDelaySource.None, result.Source);
            Assert.Null(result.OneWaySeconds);
        }
    }
}
