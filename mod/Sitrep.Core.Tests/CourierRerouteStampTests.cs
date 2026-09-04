using System.Collections.Generic;
using System.Linq;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// THE MIDDLEMAN CASE. A relay satellite carrying the craft's signal goes
    /// offline while an alternative route home still exists, so the craft stays
    /// CONNECTED and only the light-time changes. Whatever had already left the
    /// craft is in flight and must keep arriving on ITS OWN timing, one sample
    /// at a time, at the delay it was sent under; the new route governs only
    /// what is sent after the switch.
    ///
    /// <para>This is the case the reveal gate cannot cover, because the reveal
    /// gate refuses samples recorded while DISCONNECTED and a reroute never
    /// disconnects. It is also the case the delivery-time ledger re-read gets
    /// wrong in both directions: a shorter new path drags the vantage cursor
    /// forward and SKIPS the tail, and a longer one freezes the cursor and
    /// replays one sample as DUPLICATE FRAMES while the tail is lost for
    /// good.</para>
    /// </summary>
    public class CourierRerouteStampTests
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
        /// Five samples sent under a 4 s path, then at UT 6 the middleman dies
        /// and the craft reroutes onto a 1 s path while staying connected.
        /// </summary>
        private static Wire RunReroute(double newDelay)
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(4.0);
            var courier = new Courier(clock, network);

            var wire = new Wire();
            courier.SubscribeStream(Node, Topic, Vantage,
                d => wire.Frames.Add((d.Meta.DeliveredAt, d.Meta.ValidAt)));

            // UT 1..5: five samples sent over the 4 s path. Only the UT 1 one
            // has arrived (at UT 5) by the time the middleman dies.
            foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
            {
                clock.AdvanceTo(ut);
                courier.Record(Node, Topic, 10.0 + ut, ut);
            }

            // UT 6: the tail sample for this instant lands first (it was already
            // on its way), THEN the relay drops and the route changes. The craft
            // never disconnects, so nothing is withheld from the archive.
            for (var ut = 6.0; ut <= 16.0; ut += 1.0)
            {
                clock.AdvanceTo(ut);
                if (ut == 6.0)
                {
                    network.SetDefaultDelay(newDelay);
                }
                courier.Record(Node, Topic, 10.0 + ut, ut);
            }
            clock.AdvanceTo(24.0);
            return wire;
        }

        /// <summary>
        /// REROUTE ONTO A SHORTER PATH (4 s → 1 s). The four samples still in
        /// flight (UT 2, 3, 4, 5) must land at UT 6, 7, 8, 9, each once, at the
        /// delay they were sent under, while post-switch samples ride the new 1 s
        /// path and overtake them. Re-reading the ledger at fire time instead
        /// jumps the cursor three seconds forward and loses UT 2, 3 and 4.
        /// </summary>
        [Fact]
        public void ShorterRerouteStillDeliversTheTailSentUnderTheOldPath()
        {
            var wire = RunReroute(newDelay: 1.0);

            // The pre-switch tail arrives on its own timing, one per second.
            Assert.Contains(2.0, wire.ValidAtsAt(6.0));
            Assert.Contains(3.0, wire.ValidAtsAt(7.0));
            Assert.Contains(4.0, wire.ValidAtsAt(8.0));
            Assert.Contains(5.0, wire.ValidAtsAt(9.0));

            // Post-switch samples ride the 1 s path.
            Assert.Contains(6.0, wire.ValidAtsAt(7.0));
            Assert.Contains(10.0, wire.ValidAtsAt(11.0));

            // Nothing sent is dropped, and nothing is delivered twice.
            var seen = wire.Frames.Select(f => f.ValidAt).ToList();
            Assert.Equal(seen.Distinct().Count(), seen.Count);
            for (var ut = 1.0; ut <= 16.0; ut += 1.0)
            {
                Assert.Contains(ut, seen);
            }
        }

        /// <summary>
        /// REROUTE ONTO A LONGER PATH (4 s → 8 s), the worse direction. The four
        /// in-flight samples must still land at UT 6, 7, 8, 9, then the stream
        /// goes genuinely quiet for the four seconds it takes the first
        /// post-switch sample to cross the longer path. Re-reading the ledger
        /// instead freezes the cursor and puts FOUR DUPLICATE FRAMES of the UT 1
        /// sample on the wire while UT 2..5 are lost permanently.
        /// </summary>
        [Fact]
        public void LongerRerouteDeliversTheTailOnceEachWithNoDuplicateFrames()
        {
            var wire = RunReroute(newDelay: 8.0);

            Assert.Equal(new[] { 2.0 }, wire.ValidAtsAt(6.0));
            Assert.Equal(new[] { 3.0 }, wire.ValidAtsAt(7.0));
            Assert.Equal(new[] { 4.0 }, wire.ValidAtsAt(8.0));
            Assert.Equal(new[] { 5.0 }, wire.ValidAtsAt(9.0));

            // Genuine silence: the first post-switch sample (UT 6) is still
            // crossing the 8 s path and lands at UT 14.
            foreach (var ut in new[] { 10.0, 11.0, 12.0, 13.0 })
            {
                Assert.Empty(wire.ValidAtsAt(ut));
            }
            Assert.Equal(new[] { 6.0 }, wire.ValidAtsAt(14.0));

            // No frame is ever repeated: the duplicate storm is the defect.
            var seen = wire.Frames.Select(f => f.ValidAt).ToList();
            Assert.Equal(seen.Distinct().Count(), seen.Count);
            for (var ut = 1.0; ut <= 16.0; ut += 1.0)
            {
                Assert.Contains(ut, seen);
            }
        }
    }
}
