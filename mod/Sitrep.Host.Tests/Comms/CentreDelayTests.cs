using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CentreDelayTests
    {
        private static CommsPath Path(params double?[] metres)
        {
            var hops = new System.Collections.Generic.List<CommsHop>();
            foreach (var hop in metres)
            {
                hops.Add(new CommsHop { DistanceMeters = hop });
            }
            return new CommsPath { Hops = hops };
        }

        [Fact]
        public void TheDelayIsThePathsLengthAtTheSpeedTheGameIsSetToModel()
        {
            var delay = CentreDelay.Over(Path(SignalDelay.SpeedOfLightMetersPerSecond, 2.0 * SignalDelay.SpeedOfLightMetersPerSecond), 10.0, "vessel:a");

            Assert.Equal(30.0, delay.OneWaySeconds!.Value, 9);
            Assert.Equal(CommsDelaySource.SignalDelay, delay.Source);
            Assert.Equal("vessel:a", delay.Meta!.Source);
        }

        [Fact]
        public void ACentreThatBelievesInNoPathIsToldNoDelayAndNotAZero()
        {
            var delay = CentreDelay.Over(Path(), 1.0, "vessel:a");

            Assert.Null(delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.None, delay.Source);
        }

        [Fact]
        public void AHopOfUnknownLengthLeavesTheDelayUnknown()
        {
            Assert.Null(CentreDelay.Over(Path(1000.0, null), 1.0, "vessel:a").OneWaySeconds);
        }

        [Fact]
        public void ADelayThatIsSwitchedOffIsAZeroThatSaysSo()
        {
            var delay = CentreDelay.NotMeasured(networkModelled: true, Path(1000.0), "vessel:a");

            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.None, delay.Source);
        }

        /// <summary>
        /// With delay off, a craft between one plan and the next is told the delay
        /// of the path its centre last believed, not no path.
        /// </summary>
        [Fact]
        public void ADelaySwitchedOffBetweenPlansKeepsTheBelievedPath()
        {
            var believed = new BelievedPaths();
            believed.Keep("ground:ksc", "vessel:a", new CentrePathView(Path(1000.0), new CommsNetwork(), new CommsCommandCentre()));

            var path = ContactPlanSource.DelayOffPath(
                modelled: true,
                betweenPlans: true,
                believed.Of("ground:ksc", "vessel:a")?.Path,
                () => Path());

            var delay = CentreDelay.NotMeasured(networkModelled: true, path, "vessel:a");
            Assert.Equal(0.0, delay.OneWaySeconds);
        }

        /// <summary>
        /// A craft the centre believes has no path reads as no path with delay
        /// off, as it does with delay on, whether the path is empty, absent or
        /// has a hop of unknown length.
        /// </summary>
        [Fact]
        public void ADelaySwitchedOffStillReadsNoPathForACraftWithNone()
        {
            foreach (var path in new[] { null, new CommsPath(), Path(1000.0, null) })
            {
                var off = CentreDelay.NotMeasured(networkModelled: true, path, "vessel:a");

                Assert.Null(off.OneWaySeconds);
                Assert.Equal(CommsDelaySource.None, off.Source);
            }

            Assert.Null(CentreDelay.Over(new CommsPath(), 1.0, "vessel:a").OneWaySeconds);
        }

        [Fact]
        public void ASaveWithNoCommsNetworkIsAZeroThatNamesItsReason()
        {
            var delay = CentreDelay.NotMeasured(networkModelled: false, null, "game");

            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.NoCommsModel, delay.Source);
        }
    }
}
