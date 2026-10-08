using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Xunit;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A span that reached one command centre reaches that centre's screens and
    /// nobody else's, and the archive, which every centre reads, serves it to
    /// another centre only once that centre has it too.
    /// </summary>
    public class CourierReplayRecordedToTests
    {
        private static (Courier Courier, ManualClock Clock, List<StreamData> Home, List<StreamData> Far) Rig()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("home", "craft", 5);
            network.SetDelay("far", "craft", 5);
            var courier = new Courier(clock, network);
            var home = new List<StreamData>();
            var far = new List<StreamData>();
            courier.SubscribeStream("craft", "t", "home", home.Add);
            courier.SubscribeStream("craft", "t", "far", far.Add);
            return (courier, clock, home, far);
        }

        [Fact]
        public void OnlyTheCentreItReachedIsToldAndItIsToldWhenItArrived()
        {
            var (courier, clock, home, far) = Rig();
            clock.AdvanceTo(100);

            courier.ReplayRecordedTo("craft", "t", "home", new[] { new ArchiveSample("a", 10), new ArchiveSample("b", 20) }, 100, gapSinceUt: 5);
            clock.AdvanceTo(100);

            Assert.Equal(new[] { "a", "b" }, home.Select(f => f.Payload));
            Assert.All(home, f => Assert.Equal(Staleness.Recorded, f.Meta.Staleness));
            Assert.All(home, f => Assert.Equal(100.0, f.Meta.DeliveredAt));
            Assert.Equal(new double?[] { 5, null }, home.Select(f => f.Meta.GapSinceUt));
            Assert.Empty(far);
        }

        [Fact]
        public void AnotherCentreIsNotServedTheSampleFromTheArchiveUntilItHasReceivedIt()
        {
            var (courier, clock, _, _) = Rig();
            clock.AdvanceTo(100);
            courier.ReplayRecordedTo("craft", "t", "home", new[] { new ArchiveSample("a", 10) }, 100);
            clock.AdvanceTo(100);

            Assert.Equal("a", courier.ReadRawAtVantage("craft", "t", "home", 101));
            Assert.Null(courier.ReadRawAtVantage("craft", "t", "far", 101));

            courier.ReplayRecordedTo("craft", "t", "far", new[] { new ArchiveSample("a", 10) }, 500);
            clock.AdvanceTo(500);
            Assert.Equal("a", courier.ReadRawAtVantage("craft", "t", "far", 501));
        }

        [Fact]
        public void ALiveSampleIsStillReadByTheCentreAnotherCentresSpanSkips()
        {
            var (courier, clock, _, _) = Rig();
            courier.Record("craft", "t", "live-old", 0);
            clock.AdvanceTo(100);
            courier.ReplayRecordedTo("craft", "t", "home", new[] { new ArchiveSample("span", 50) }, 100);
            clock.AdvanceTo(100);

            Assert.Equal("live-old", courier.ReadRawAtVantage("craft", "t", "far", 101));
            Assert.Equal("span", courier.ReadRawAtVantage("craft", "t", "home", 101));
        }
    }
}
