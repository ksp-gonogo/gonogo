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
        /// THE BLIND WINDOW. A relay four light-seconds out dies at UT 6. The
        /// craft cannot know: word of the death has to travel back down the same
        /// four seconds of route, so it goes on transmitting into a path that
        /// stops carrying part-way along until UT 10, and every sample it sends
        /// in that window is lost exactly as the tail was.
        ///
        /// <para>At UT 10 it finds out and re-targets, and from there the light
        /// rides whatever route the ledger now holds and never goes near this
        /// break. Without that half the reroute case would break: the relay
        /// would go on dooming everything the craft sent down its new path for
        /// as long as the break stayed on the books.</para>
        ///
        /// <para>The instant of discovery is the whole point. A drop that
        /// released the craft at UT 6 would model a craft that learned of a
        /// death at the moment it happened, four light-seconds away.</para>
        /// </summary>
        [Fact]
        public void TheNodeFeedsTheDeadRouteUntilWordOfTheBreakReachesIt()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            network.DropPath(Node, atUt: 6.0, lightSecondsOut: 4.0);

            // The tail: short of the relay when it died.
            Assert.True(network.Lost(Node, 5.0));

            // Sent into a route the craft has no way of knowing is dead.
            Assert.True(network.Lost(Node, 6.0));
            Assert.True(network.Lost(Node, 6.5));
            Assert.True(network.Lost(Node, 9.999));

            // Word has arrived; the craft is on a new route.
            Assert.False(network.Lost(Node, 10.0));
            Assert.False(network.Lost(Node, 20.0));
        }

        /// <summary>
        /// A break the craft cannot yet be routing through is not recorded. At
        /// UT 6 a relay four seconds out dies; at UT 8 another relay, further
        /// out, stops carrying on the route the GRAPH now holds. The craft is
        /// still blind to the first break until UT 10 and has not moved onto
        /// that route at all.
        ///
        /// <para>Recorded, the second break's own blind window would run to
        /// UT 14 and retire four seconds of light that left after the craft had
        /// re-targeted, on a route it never sat on. A wrongly-declared break
        /// deletes telemetry that physically arrived, so the uncertainty
        /// resolves to delivering.</para>
        /// </summary>
        [Fact]
        public void ABreakOpeningWhileTheNodeIsStillBlindIsNotRecorded()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            network.DropPath(Node, atUt: 6.0, lightSecondsOut: 4.0);
            network.DropPath(Node, atUt: 8.0, lightSecondsOut: 6.0);

            // The first break still governs its own window, unextended.
            Assert.True(network.Lost(Node, 9.0));
            Assert.False(network.Lost(Node, 10.0));
            Assert.False(network.Lost(Node, 13.0));
        }

        /// <summary>
        /// A break opening after the craft has re-targeted is an ordinary second
        /// break and IS recorded: the craft is feeding the route it describes.
        /// The pair with the test above is the whole rule, since a blind window
        /// is a statement about one route rather than a quiet period during
        /// which nothing can be recorded.
        /// </summary>
        [Fact]
        public void ABreakOpeningAfterTheNodeHasReTargetedIsRecorded()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(8.0);
            network.DropPath(Node, atUt: 6.0, lightSecondsOut: 4.0);
            network.DropPath(Node, atUt: 12.0, lightSecondsOut: 3.0);

            // Clear of the first break, caught by the second.
            Assert.True(network.Lost(Node, 12.0));
            Assert.True(network.Lost(Node, 14.0));
            Assert.False(network.Lost(Node, 15.0));
        }

        /// <summary>
        /// The whole shape over one stream: five samples out under an 8 s path
        /// when a relay 4 s out dies at UT 6, the craft blind until UT 10, and
        /// the stream re-established on the route the ledger holds afterwards.
        ///
        /// <para>Three outcomes from one break, which is what the position buys:
        /// the head of the tail is past the relay and lands, the rest of the
        /// tail and everything sent through the blind window is retired, and the
        /// samples sent after the re-target arrive at the delay they were sent
        /// under.</para>
        /// </summary>
        [Fact]
        public void TheStreamResumesAtTheReTargetRatherThanAtTheBreak()
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

            foreach (var ut in new[] { 6.0, 7.0, 8.0, 9.0, 10.0, 11.0 })
            {
                clock.AdvanceTo(ut);
                courier.Record(Node, Topic, 100.0 + ut, ut);
            }

            clock.AdvanceTo(40.0);

            // UT 1 and 2 were past the relay (1 + 4 and 2 + 4, the latter
            // exactly, which counts as crossed). UT 3 to 9 were either short of
            // it or sent into it unknowing. UT 10 is the re-target.
            Assert.Equal(new[] { 1.0, 2.0, 10.0, 11.0 }, wire.ValidAts.OrderBy(v => v).ToArray());
            Assert.Equal(18.0, wire.ArrivalOf(10.0));
            Assert.Equal(19.0, wire.ArrivalOf(11.0));
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
