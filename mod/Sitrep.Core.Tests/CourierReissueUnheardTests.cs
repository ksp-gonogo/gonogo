using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A fact that changed while a command centre had no route to it never reached that
    /// centre, and the newest of it is sent when the route returns.
    /// </summary>
    public class CourierReissueUnheardTests
    {
        private const string Node = "home";
        private const string Centre = "KSC";
        private const string Topic = "career.funds";

        private static (Courier Courier, StubNetwork Network, ManualClock Clock, List<double> Seen) Silent()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDelay(Centre, Node, double.PositiveInfinity);
            var courier = new Courier(clock, network);
            var seen = new List<double>();
            courier.SubscribeStream(Node, Topic, Centre, d => seen.Add(System.Convert.ToDouble(d.Payload)));
            clock.AdvanceTo(1.0);
            courier.Record(Node, Topic, 100.0, 1.0);
            clock.AdvanceTo(2.0);
            courier.Record(Node, Topic, 250.0, 2.0);
            clock.AdvanceTo(10.0);
            return (courier, network, clock, seen);
        }

        [Fact]
        public void TheNewestFactRecordedDuringTheSilenceArrivesWhenTheRouteReturns()
        {
            var (courier, network, clock, seen) = Silent();
            Assert.Empty(seen);

            network.SetDelay(Centre, Node, 3.0);
            courier.ReissueUnheard(Node, Centre);
            clock.AdvanceTo(20.0);

            Assert.Equal(new[] { 250.0 }, seen);
        }

        [Fact]
        public void NothingIsSentWhileTheRouteIsStillDown()
        {
            var (courier, _, clock, seen) = Silent();

            courier.ReissueUnheard(Node, Centre);
            clock.AdvanceTo(20.0);

            Assert.Empty(seen);
        }

        [Fact]
        public void AFactTheCentreAlreadyHasIsNotSentAgain()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 2.0);
            var courier = new Courier(clock, network);
            var seen = new List<double>();
            courier.SubscribeStream(Node, Topic, Centre, d => seen.Add(System.Convert.ToDouble(d.Payload)));
            clock.AdvanceTo(1.0);
            courier.Record(Node, Topic, 100.0, 1.0);
            clock.AdvanceTo(10.0);

            courier.ReissueUnheard(Node, Centre);
            clock.AdvanceTo(20.0);

            Assert.Equal(new[] { 100.0 }, seen);
        }
    }
}
