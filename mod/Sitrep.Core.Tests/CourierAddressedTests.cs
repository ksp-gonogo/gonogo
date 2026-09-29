using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <see cref="Courier.RecordAddressed"/>: a sample said from one node to a named
    /// audience, timed by the speaker's own ledger row to each listener.
    /// </summary>
    public class CourierAddressedTests
    {
        private const string Node = "addressed";
        private const string Topic = "talk";
        private const string Speaker = "centre.a";

        private static (ManualClock Clock, StubNetwork Network, Courier Courier) Rig()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDelay("b", Speaker, 5);
            network.SetDelay("c", Speaker, 20);
            // What the subscription node's own row says must never time an addressed sample.
            network.SetDelay("b", Node, 1000);
            var courier = new Courier(clock, network);
            clock.AdvanceTo(0.0);
            return (clock, network, courier);
        }

        private static List<(double At, object? Value)> Listen(Courier courier, string vantage)
        {
            var heard = new List<(double, object?)>();
            courier.SubscribeStream(Node, Topic, vantage, d => heard.Add((d.Meta.DeliveredAt, d.Payload)));
            return heard;
        }

        [Fact]
        public void EachListenerHearsAtItsOwnRowFromTheSpeaker()
        {
            var (clock, _, courier) = Rig();
            var b = Listen(courier, "b");
            var c = Listen(courier, "c");

            courier.RecordAddressed(Node, Topic, "hello", 0.0, Speaker, new[] { "b", "c" });

            clock.AdvanceTo(4.9);
            Assert.Empty(b);
            clock.AdvanceTo(5.0);
            Assert.Equal(new[] { (5.0, (object?)"hello") }, b);
            clock.AdvanceTo(19.9);
            Assert.Empty(c);
            clock.AdvanceTo(20.0);
            Assert.Equal(new[] { (20.0, (object?)"hello") }, c);
        }

        [Fact]
        public void AVantageOutsideTheAudienceHearsNothing()
        {
            var (clock, _, courier) = Rig();
            var c = Listen(courier, "c");

            courier.RecordAddressed(Node, Topic, "for b", 0.0, Speaker, new[] { "b" });
            clock.AdvanceTo(1000.0);

            Assert.Empty(c);
        }

        [Fact]
        public void EverySampleIsForwardedInOrderEvenWhenTheyShareAnInstant()
        {
            var (clock, _, courier) = Rig();
            var b = Listen(courier, "b");

            courier.RecordAddressed(Node, Topic, 1, 0.0, Speaker, new[] { "b" });
            courier.RecordAddressed(Node, Topic, 2, 0.0, Speaker, new[] { "b" });
            clock.AdvanceTo(5.0);

            Assert.Equal(new object?[] { 1, 2 }, b.ConvertAll(h => h.Value));
        }

        [Fact]
        public void ASubscriberJoiningMidCrossingGetsItOnArrivalAndOneJoiningAfterGetsNothing()
        {
            var (clock, _, courier) = Rig();
            courier.RecordAddressed(Node, Topic, "crossing", 0.0, Speaker, new[] { "b", "c" });

            clock.AdvanceTo(10.0);
            var b = Listen(courier, "b");
            var c = Listen(courier, "c");
            clock.AdvanceTo(30.0);

            Assert.Empty(b);
            Assert.Equal(new[] { (20.0, (object?)"crossing") }, c);
        }

        [Fact]
        public void ARewindDropsEverythingStillCrossing()
        {
            var (clock, _, courier) = Rig();
            courier.RecordAddressed(Node, Topic, "abandoned", 10.0, Speaker, new[] { "b" });

            courier.ResetTimeline(0.0);
            var b = Listen(courier, "b");
            clock.AdvanceTo(100.0);

            Assert.Empty(b);
        }
    }
}
