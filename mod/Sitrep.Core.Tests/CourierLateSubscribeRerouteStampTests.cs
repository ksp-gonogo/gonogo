using System.Collections.Generic;
using System.Linq;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// THE MIDDLEMAN CASE, SEEN BY A VANTAGE THAT WAS NOT WATCHING YET.
    ///
    /// <para><see cref="CourierRerouteStampTests"/> pins the tail for a subscriber
    /// that was already attached when the samples were recorded, so its
    /// deliveries were scheduled by <see cref="Courier.Record"/> and carry the
    /// record-time delay in their closures. Both it and
    /// <c>MiddlemanRerouteTests</c> subscribe BEFORE the first Record, which
    /// leaves the catch-up backlog in <see cref="Courier.SubscribeStream"/>
    /// permanently empty: the one path neither of them reaches.</para>
    ///
    /// <para>Every test here subscribes AFTER the reroute, with a full backlog
    /// waiting, which is the whole point of the file. What the vantage is owed is
    /// fixed by the geometry the samples were SENT under, not by whatever the
    /// route became while nobody was listening.</para>
    /// </summary>
    public class CourierLateSubscribeRerouteStampTests
    {
        private const string Node = "system";
        private const string Vantage = "KSC";
        private const string Topic = "vessel.altitude";

        /// <summary>One (arrival UT, validAt) pair per frame the vantage saw.</summary>
        private sealed class Wire
        {
            public readonly List<(double At, double ValidAt)> Frames = new List<(double, double)>();

            public IEnumerable<double> ValidAtsAt(double ut) =>
                Frames.Where(f => f.At == ut).Select(f => f.ValidAt);
        }

        /// <summary>
        /// Five samples sent under a 4 s path (UT 1..5), the middleman dies at
        /// UT 6 and the craft reroutes onto <paramref name="newDelay"/> while
        /// staying connected, and only THEN does the vantage subscribe. By that
        /// instant the UT 1 and UT 2 samples have landed (1 + 4, 2 + 4) and UT
        /// 3, 4, 5 are still crossing the old path.
        /// </summary>
        private static Wire RunLateSubscribe(double newDelay)
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(4.0);
            var courier = new Courier(clock, network);

            foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
            {
                clock.AdvanceTo(ut);
                courier.Record(Node, Topic, 10.0 + ut, ut);
            }

            clock.AdvanceTo(6.0);
            network.SetDefaultDelay(newDelay);

            var wire = new Wire();
            courier.SubscribeStream(Node, Topic, Vantage,
                d => wire.Frames.Add((d.Meta.DeliveredAt, d.Meta.ValidAt)));

            clock.AdvanceTo(24.0);
            return wire;
        }

        /// <summary>
        /// REROUTE ONTO A SHORTER PATH (4 s to 1 s), then subscribe. The backlog
        /// re-read against the CURRENT 1 s path makes every one of the five
        /// samples look long since arrived, so the tail is dropped outright and
        /// the catch-up hands over the UT 5 sample three seconds before its light
        /// could possibly have got there: a future leak.
        /// </summary>
        [Fact]
        public void ShorterRerouteBeforeSubscribeStillOwesTheTailSentUnderTheOldPath()
        {
            var wire = RunLateSubscribe(newDelay: 1.0);

            // Catch-up is the newest sample that has genuinely landed: UT 2,
            // arriving at 2 + 4. Nothing later can have arrived yet.
            Assert.Equal(new[] { 2.0 }, wire.ValidAtsAt(6.0));

            // The rest of the old-path tail keeps arriving on its own timing.
            Assert.Equal(new[] { 3.0 }, wire.ValidAtsAt(7.0));
            Assert.Equal(new[] { 4.0 }, wire.ValidAtsAt(8.0));
            Assert.Equal(new[] { 5.0 }, wire.ValidAtsAt(9.0));

            var seen = wire.Frames.Select(f => f.ValidAt).ToList();
            Assert.Equal(seen.Distinct().Count(), seen.Count);
        }

        /// <summary>
        /// REROUTE ONTO A LONGER PATH (4 s to 8 s), then subscribe. The backlog
        /// re-read against the current 8 s path pushes the whole tail four
        /// seconds into the future and leaves the catch-up with nothing at all,
        /// so a vantage that should already hold the UT 2 sample is shown an
        /// empty channel and then fed history late.
        /// </summary>
        [Fact]
        public void LongerRerouteBeforeSubscribeStillDeliversTheTailOnItsOldTiming()
        {
            var wire = RunLateSubscribe(newDelay: 8.0);

            Assert.Equal(new[] { 2.0 }, wire.ValidAtsAt(6.0));
            Assert.Equal(new[] { 3.0 }, wire.ValidAtsAt(7.0));
            Assert.Equal(new[] { 4.0 }, wire.ValidAtsAt(8.0));
            Assert.Equal(new[] { 5.0 }, wire.ValidAtsAt(9.0));

            // Nothing was sent after the reroute, so the channel is then quiet.
            Assert.DoesNotContain(wire.Frames, f => f.At > 9.0);

            var seen = wire.Frames.Select(f => f.ValidAt).ToList();
            Assert.Equal(seen.Distinct().Count(), seen.Count);
        }

        /// <summary>
        /// The stamp is PER VANTAGE, not one number per sample. Two command
        /// centres hold their own explicit (vantage, node) rows; only one of them
        /// reroutes. A single scalar stamped per sample would hand the untouched
        /// vantage the other one's light-time, which the two-vantage golden
        /// fixture already says is wrong for the live path.
        /// </summary>
        [Fact]
        public void EachVantageIsOwedItsOwnRecordTimeDelay()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDelay("near", Node, 2.0);
            network.SetDelay("far", Node, 6.0);
            var courier = new Courier(clock, network);

            clock.AdvanceTo(1.0);
            courier.Record(Node, Topic, 11.0, 1.0);

            // "near" reroutes onto a longer path; "far" is untouched.
            clock.AdvanceTo(2.0);
            network.SetDelay("near", Node, 9.0);

            var near = new Wire();
            var far = new Wire();
            courier.SubscribeStream(Node, Topic, "near", d => near.Frames.Add((d.Meta.DeliveredAt, d.Meta.ValidAt)));
            courier.SubscribeStream(Node, Topic, "far", d => far.Frames.Add((d.Meta.DeliveredAt, d.Meta.ValidAt)));

            clock.AdvanceTo(20.0);

            // Sent under 2 s, so it lands at UT 3 however far "near" has moved since.
            Assert.Equal(new[] { 1.0 }, near.ValidAtsAt(3.0));
            Assert.Single(near.Frames);

            // "far" never rerouted: still 1 + 6.
            Assert.Equal(new[] { 1.0 }, far.ValidAtsAt(7.0));
            Assert.Single(far.Frames);
        }
    }
}
