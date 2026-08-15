using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The light-time half of a routed comms read: given hops somebody already
    /// walked, what does the delay come out as, and which absences stay absent.
    /// No KSP types here at all (see RoutedPathDelay's own doc comment), so this
    /// runs on every checkout.
    /// </summary>
    public class RoutedPathDelayTests
    {
        private static SignalDelayConfig Enabled(double scale = 1.0) =>
            new SignalDelayConfig { Enabled = true, LightSpeedScale = scale };

        private static IReadOnlyList<RoutedHop> Hops(params double[] distances)
        {
            var hops = new List<RoutedHop>();
            foreach (var d in distances)
            {
                hops.Add(new RoutedHop(d, isHome: false));
            }
            return hops;
        }

        [Fact]
        public void NoPathAtAll_IsNull_NeverZero()
        {
            Assert.Null(RoutedPathDelay.OneWaySeconds(null, Enabled(), Quality.Loaded));
        }

        [Fact]
        public void NoPathAtAll_StaysNull_EvenWhenDelayIsDisabled()
        {
            // Delay-disabled is a genuine zero for a link that EXISTS. An absent
            // route has nothing to zero, so the flag must not manufacture one.
            Assert.Null(RoutedPathDelay.OneWaySeconds(
                null, SignalDelayConfig.Off(), Quality.Loaded));
        }

        [Fact]
        public void PathWithNoHops_IsNull_NotZero()
        {
            Assert.Null(RoutedPathDelay.OneWaySeconds(Hops(), Enabled(), Quality.Loaded));
        }

        [Fact]
        public void SingleHop_IsDistanceOverLightSpeed()
        {
            var seconds = RoutedPathDelay.OneWaySeconds(
                Hops(SignalDelay.SpeedOfLightMetersPerSecond), Enabled(), Quality.Loaded);

            Assert.NotNull(seconds);
            Assert.Equal(1.0, seconds!.Value, 9);
        }

        [Fact]
        public void MultipleHops_SumTheWholeRoute_NotTheEndToEndChord()
        {
            var c = SignalDelay.SpeedOfLightMetersPerSecond;

            // Three relay legs: the light-time is the sum of the legs walked,
            // which is exactly what a straight line between the endpoints would
            // have understated.
            var seconds = RoutedPathDelay.OneWaySeconds(
                Hops(c, 2 * c, 0.5 * c), Enabled(), Quality.Loaded);

            Assert.NotNull(seconds);
            Assert.Equal(3.5, seconds!.Value, 9);
        }

        [Fact]
        public void LightSpeedScale_DividesTheDelay()
        {
            var seconds = RoutedPathDelay.OneWaySeconds(
                Hops(SignalDelay.SpeedOfLightMetersPerSecond), Enabled(scale: 4.0), Quality.Loaded);

            Assert.NotNull(seconds);
            Assert.Equal(0.25, seconds!.Value, 9);
        }

        [Fact]
        public void DelayDisabled_OverARealPath_IsAppliedZero()
        {
            var seconds = RoutedPathDelay.OneWaySeconds(
                Hops(SignalDelay.SpeedOfLightMetersPerSecond), SignalDelayConfig.Off(), Quality.Loaded);

            Assert.Equal(0.0, seconds);
        }

        [Fact]
        public void HomeHop_IsCarriedAsAHomeHop_AndStillCounted()
        {
            var hops = new List<RoutedHop>
            {
                new RoutedHop(SignalDelay.SpeedOfLightMetersPerSecond, isHome: false),
                new RoutedHop(SignalDelay.SpeedOfLightMetersPerSecond, isHome: true),
            };

            var seconds = RoutedPathDelay.OneWaySeconds(hops, Enabled(), Quality.Loaded);

            Assert.NotNull(seconds);
            Assert.Equal(2.0, seconds!.Value, 9);
        }
    }
}
