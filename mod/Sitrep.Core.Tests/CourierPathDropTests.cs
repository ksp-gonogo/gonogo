using System.Collections.Generic;
using System.Linq;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// THE MIDDLEMAN DESTRUCTION. <c>CourierRerouteStampTests</c> covers a relay
    /// dying while another route home still exists, so the craft stays connected
    /// and only the light-time changes. Destruction may leave no onward route at
    /// all, and every reroute test has a new path for the tail to resume onto.
    ///
    /// <para>A destroyed vessel is the edge case of a reroute where the new path
    /// does not exist, and the delay-value channel cannot express it: it can say
    /// "further away" and "nearer" and has no honest value for GONE. Hence the
    /// drop event (<see cref="INetwork.DropPath"/>), which is what these tests
    /// pin. It is internal to the delay machinery and reaches no wire.</para>
    ///
    /// <para>Before the drop event, this was the behaviour, measured rather than
    /// assumed: a sample sent under an 8 s path, with the relay dying at UT 2 and
    /// both <c>SetReachable(false)</c> and a collapse of the delay to zero
    /// applied at that instant, was still delivered at UT 8. Neither of the two
    /// things the ledger could say about a dead node touched the light already in
    /// flight, because the record-time <see cref="DelayStamp"/> fixes both when
    /// it arrives and that it arrives.</para>
    /// </summary>
    public class CourierPathDropTests
    {
        private const string Node = "system";
        private const string Vantage = "KSC";
        private const string Topic = "vessel.altitude";

        private sealed class Wire
        {
            public readonly List<(double At, double ValidAt)> Frames = new List<(double, double)>();

            public IEnumerable<double> ValidAts => Frames.Select(f => f.ValidAt);

            public double ArrivalOf(double validAt) =>
                Frames.Where(f => f.ValidAt == validAt).Select(f => f.At).Single();
        }

        private static Wire Subscribe(Courier courier)
        {
            var wire = new Wire();
            courier.SubscribeStream(Node, Topic, Vantage,
                d => wire.Frames.Add((d.Meta.DeliveredAt, d.Meta.ValidAt)));
            return wire;
        }

        /// <summary>
        /// THE OPERATOR'S SCENARIO, exactly. A sample is sent on an 8 second
        /// delay through a relay that is 4 seconds out. At UT 2 the relay dies.
        /// The sample is 2 seconds along the leg toward it and has not reached
        /// it; nothing will retransmit it, and it is lost.
        ///
        /// <para>Lost KNOWABLY at UT 2, which is the half worth having. The
        /// wavefront's fate is decided by the death, not by the deadline: the
        /// ledger answers before the clock has moved at all, six seconds before
        /// the sample was ever due.</para>
        /// </summary>
        [Fact]
        public void ASampleShortOfTheDeadRelayIsLostAtTheDeathRatherThanAtItsDeadline()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            var courier = new Courier(clock, network);
            var wire = Subscribe(courier);

            clock.AdvanceTo(0.0);
            courier.Record(Node, Topic, 100.0, 0.0);

            clock.AdvanceTo(2.0);
            network.DropPath(Node, atUt: 2.0, lightSecondsOut: 4.0);

            // Answered here, at UT 2, with the clock untouched since.
            Assert.True(network.Lost(Node, 0.0));

            clock.AdvanceTo(30.0);
            Assert.Empty(wire.Frames);
        }

        /// <summary>
        /// The partition the drop event exists to make, over a tail that is
        /// entirely in flight. A 4 s relay on an 8 s path dies at UT 6, with five
        /// samples out. The two that were already past it arrive on their own
        /// timing, unaffected; the three still short of it never arrive at all.
        ///
        /// <para>This is the distinction a per-sample delay could not draw. A
        /// stamp fixes WHEN a sample arrives, and every one of these five carries
        /// the same 8 s stamp; where the break sat along the route is what
        /// decides WHETHER it arrives.</para>
        /// </summary>
        [Fact]
        public void ATailIsSplitByWhereItHadGotToWhenTheRelayDied()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            var courier = new Courier(clock, network);
            var wire = Subscribe(courier);

            foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
            {
                clock.AdvanceTo(ut);
                courier.Record(Node, Topic, 100.0 + ut, ut);
            }

            clock.AdvanceTo(6.0);
            network.DropPath(Node, atUt: 6.0, lightSecondsOut: 4.0);
            clock.AdvanceTo(30.0);

            // Past the relay by UT 6 (1 + 4 = 5, and 2 + 4 = 6 exactly, which
            // counts as crossed), so still arriving at the delay they were sent
            // under.
            Assert.Equal(new[] { 1.0, 2.0 }, wire.ValidAts.OrderBy(v => v).ToArray());
            Assert.Equal(9.0, wire.ArrivalOf(1.0));
            Assert.Equal(10.0, wire.ArrivalOf(2.0));
        }

        /// <summary>
        /// A break that CLOSES catches only what would have reached it while it
        /// was open. An occultation is the ordinary case and it is not a death:
        /// a wavefront that gets to the blocked point after the rock has moved on
        /// crosses it and lands.
        ///
        /// <para>Without a close instant the drop event would have to treat every
        /// break as permanent, which is the same overloaded-sentinel mistake in
        /// the other direction: "gone" would swallow "gone for four hundred
        /// seconds".</para>
        /// </summary>
        [Fact]
        public void ABreakThatClosesBeforeTheWavefrontReachesItCatchesNothing()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            var courier = new Courier(clock, network);
            var wire = Subscribe(courier);

            clock.AdvanceTo(0.0);
            courier.Record(Node, Topic, 100.0, 0.0);

            // Blocked 4 s out, from UT 2 until UT 3. The sample reaches that
            // point at UT 4, by which time the path is whole again.
            clock.AdvanceTo(2.0);
            network.DropPath(Node, atUt: 2.0, lightSecondsOut: 4.0, restoredAtUt: 3.0);

            Assert.False(network.Lost(Node, 0.0));
            clock.AdvanceTo(30.0);
            Assert.Equal(new[] { 0.0 }, wire.ValidAts.ToArray());
        }

        /// <summary>
        /// A drop says nothing about light sent AFTER it. That light rides
        /// whatever route the ledger now holds, and if there is no route at all
        /// the reveal gate withholds it a layer up; either way it never goes near
        /// the break the drop describes.
        ///
        /// <para>Without this the reroute case would break: a relay that dies at
        /// UT 6 would go on dooming everything the craft sent down its new path
        /// for as long as the break stayed on the books.</para>
        /// </summary>
        [Fact]
        public void ADropDoesNotReachLightSentAfterIt()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            network.DropPath(Node, atUt: 6.0, lightSecondsOut: 4.0);

            Assert.True(network.Lost(Node, 5.0));
            Assert.False(network.Lost(Node, 6.5));
            Assert.False(network.Lost(Node, 20.0));
        }

        /// <summary>
        /// A quickload forgets every break. A drop is a statement about one
        /// timeline, unlike a delay tier, which the live capture overwrites every
        /// tick and which therefore corrects itself across a rewind. Left on the
        /// books, a break recorded in the abandoned future would go on dooming
        /// light sent before it on a timeline where the relay is still flying.
        /// </summary>
        [Fact]
        public void ARewindForgetsEveryBreak()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            var courier = new Courier(clock, network);

            clock.AdvanceTo(20.0);
            network.DropPath(Node, atUt: 20.0, lightSecondsOut: 4.0);
            Assert.True(network.Lost(Node, 18.0));

            courier.ResetTimeline(10.0);
            Assert.False(network.Lost(Node, 18.0));
        }
    }
}
