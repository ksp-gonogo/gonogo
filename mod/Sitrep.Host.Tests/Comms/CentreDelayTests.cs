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
            var delay = CentreDelay.NotMeasured(networkModelled: true, "vessel:a");

            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.None, delay.Source);
        }

        [Fact]
        public void ASaveWithNoCommsNetworkIsAZeroThatNamesItsReason()
        {
            var delay = CentreDelay.NotMeasured(networkModelled: false, "game");

            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.NoCommsModel, delay.Source);
        }
    }
}
