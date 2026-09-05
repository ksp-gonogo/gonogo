using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// THE MIDDLEMAN CASE, over the raw wire. A relay satellite carrying the
    /// craft's signal goes offline while an alternative route home still
    /// exists: the craft never disconnects, and only the light-time changes.
    /// Whatever had already left the craft is in flight and must keep arriving
    /// on ITS OWN timing, at the delay it was sent under, one sample at a time.
    ///
    /// <para>This is the half of the operator's model the reveal gate cannot
    /// reach. <see cref="RevealGateTests.InFlightTailKeepsArrivingSampleBySampleAfterTheLinkCuts"/>
    /// covers the ENDPOINT case, where the loss takes the whole link and the
    /// gate withholds everything recorded after the cut. That gate is keyed on
    /// disconnection (<c>RefreshLedgerDelays</c> writes only
    /// <c>if (!SubjectConnected(...))</c>, and <c>RevealDelayFor</c> returns 0
    /// for a CONNECTED Delayed topic, leaving the whole light-time to the
    /// Courier), so a reroute never engages it.
    ///
    /// <para>WHAT THIS DOES NOT COVER, stated so nothing reads it as more than
    /// it is: the samples that had NOT yet crossed the dead relay when it died
    /// are still delivered here, at their full original delay. Deciding that
    /// they can never arrive needs to know WHERE along the path each sample had
    /// got to, which is per-hop POSITION, and nothing in the stack carries it.
    /// A per-sample delay fixes WHEN a sample arrives; a per-sample position is
    /// what would decide WHETHER it arrives at all.</para>
    /// </summary>
    public class MiddlemanRerouteTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private const string Topic = ConnectivityHorizonTestUplink.DelayedTopic;

        /// <summary>
        /// Five samples over a 4 s path, then at UT 6 the relay dies and the
        /// craft reroutes onto a path of <paramref name="newDelay"/> seconds
        /// while staying CONNECTED throughout. Returns, per tick from UT 6 to
        /// <paramref name="throughUt"/>, the ValidAts that landed on that tick.
        /// </summary>
        private static async Task<Dictionary<double, List<double>>> RunRerouteAsync(
            double newDelay,
            double throughUt)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                // CONNECTED, one-way delay 4. UT 0 establishes the delay
                // authority; UT 1..5 each emit one sample.
                engine.TickAndWait(0.0, ConnectivityHorizonTestUplink.Snapshot(0.0, connected: true, delay: 4.0), Timeout);
                foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
                {
                    engine.TickAndWait(ut, ConnectivityHorizonTestUplink.Snapshot(ut, connected: true, delay: 4.0, delayed: 10.0 + ut), Timeout);
                }

                // Only the UT 1 sample has arrived (at its horizon of 1 + 4 = 5).
                // Four are still crossing the old path when the relay dies.
                var throughUt5 = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Equal(
                    new[] { 1.0 },
                    throughUt5.Where(f => f.Topic == Topic).Select(f => f.Meta.ValidAt).ToArray());

                // THE REROUTE, at UT 6. connected stays TRUE: the craft still
                // has a way home, so nothing is withheld from the archive and
                // the reveal gate never engages. Only the light-time moves.
                var byTick = new Dictionary<double, List<double>>();
                for (var ut = 6.0; ut <= throughUt; ut += 1.0)
                {
                    engine.TickAndWait(ut, ConnectivityHorizonTestUplink.Snapshot(ut, connected: true, delay: newDelay, delayed: 10.0 + ut), Timeout);
                    var frames = await DrainAllStreamDataAsync(client, Quiet);
                    byTick[ut] = frames.Where(f => f.Topic == Topic).Select(f => f.Meta.ValidAt).ToList();
                }
                return byTick;
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// REROUTE ONTO A LONGER PATH (4 s → 8 s), the worse direction and the
        /// one that put duplicate frames on the wire. The four samples still
        /// crossing the old path land at UT 6, 7, 8, 9, once each, in order.
        /// Then the stream is genuinely quiet for the four seconds the first
        /// post-reroute sample spends crossing the longer path, and picks up
        /// again at UT 14 with the sample stamped UT 6.
        ///
        /// <para>Re-reading the ledger at fire time instead froze the vantage
        /// cursor at the last pre-reroute scene and re-resolved all four
        /// scheduled deliveries to the SAME sample: four identical frames on
        /// the wire, with UT 3, 4 and 5 lost for good.</para>
        /// </summary>
        [Fact]
        public async Task ALongerRerouteDeliversTheInFlightTailOnceEachWithNoDuplicateFrames()
        {
            var byTick = await RunRerouteAsync(newDelay: 8.0, throughUt: 15.0);

            // The tail sent under the old 4 s path, on its own timing.
            Assert.Equal(new[] { 2.0 }, byTick[6.0]);
            Assert.Equal(new[] { 3.0 }, byTick[7.0]);
            Assert.Equal(new[] { 4.0 }, byTick[8.0]);
            Assert.Equal(new[] { 5.0 }, byTick[9.0]);

            // Real silence, not a dropped tail: the first post-reroute sample
            // is still crossing 8 s of path.
            foreach (var ut in new[] { 10.0, 11.0, 12.0, 13.0 })
            {
                Assert.Empty(byTick[ut]);
            }

            // And then the new path starts delivering, at its own delay.
            Assert.Equal(new[] { 6.0 }, byTick[14.0]);
            Assert.Equal(new[] { 7.0 }, byTick[15.0]);

            AssertNothingRepeatsOrArrivesEarly(byTick, oldDelay: 4.0, newDelay: 8.0);
        }

        /// <summary>
        /// REROUTE ONTO A SHORTER PATH (4 s → 1 s). The tail sent under the old
        /// path keeps arriving from where it had got to: the first thing to land
        /// after the reroute is the sample stamped UT 2, the oldest still in
        /// flight. Re-reading the ledger at fire time instead dragged the
        /// vantage cursor three seconds forward at the reroute, so the first
        /// post-reroute frame was the UT 5 sample and UT 2, 3 and 4 were never
        /// delivered at all.
        ///
        /// <para>Only the UT 6 arrival is pinned frame-for-frame, deliberately.
        /// A shorter route means post-reroute samples OVERTAKE the tail, so two
        /// frames on this topic can fall in one tick, and
        /// <c>Outbox.PublishTelemetry</c> coalesces a LossyLatest topic per
        /// flush: which of an overtaking pair reaches the socket is a race with
        /// the flush loop, not a property of the delay model. Measured across
        /// runs of this fixture, the UT 7 and UT 9 ticks each went both ways.
        /// What is pinned instead holds regardless: nothing arrives before its
        /// own light-time could carry it, and no sample is delivered twice.</para>
        /// </summary>
        [Fact]
        public async Task AShorterRerouteResumesTheTailFromWhereItHadGotTo()
        {
            var byTick = await RunRerouteAsync(newDelay: 1.0, throughUt: 12.0);

            // Exactly one delivery is due at UT 6 (the UT 2 sample, sent under
            // the old 4 s path), so this one is outside the coalescing race and
            // pins the skip directly.
            Assert.Equal(new[] { 2.0 }, byTick[6.0]);

            // The new short path is carrying: by UT 12 the vantage is being
            // given post-reroute samples at one second's delay.
            Assert.Contains(11.0, byTick[12.0]);

            AssertNothingRepeatsOrArrivesEarly(byTick, oldDelay: 4.0, newDelay: 1.0);
        }

        /// <summary>
        /// THE LATE SUBSCRIBER, which is the case neither reroute suite could
        /// reach. Every other test here and in
        /// <c>Sitrep.Core.Tests.CourierRerouteStampTests</c> subscribes BEFORE
        /// the first sample is recorded, so all their deliveries are scheduled
        /// by <c>Courier.Record</c> and the catch-up backlog in
        /// <c>SubscribeStream</c> is empty every time they run. Here a SECOND
        /// client joins after the reroute, with the whole old-path tail still
        /// crossing, which is what a station opening mid-flight does.
        ///
        /// <para>A first client stays subscribed throughout, because the engine
        /// only samples a channel somebody is listening to: with nobody
        /// attached there is no archive for a late joiner to be owed, and the
        /// test would pass on an empty stream rather than on the tail.</para>
        ///
        /// <para>The late client is owed what the established one is owed: the
        /// sample stamped UT 2 as its catch-up (2 + 4 is the newest arrival
        /// that has happened), then UT 3, 4 and 5 on the OLD path's timing.
        /// Timing that backlog against the ledger's current 8 s instead pushes
        /// the whole tail four seconds late and leaves the catch-up empty, so a
        /// station joining a rerouted craft sees a dead channel and then
        /// history.</para>
        /// </summary>
        [Fact]
        public async Task AClientSubscribingAfterTheRerouteIsOwedTheOldPathTail()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                await using var established = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(established, Topic, Timeout);

                engine.TickAndWait(0.0, ConnectivityHorizonTestUplink.Snapshot(0.0, connected: true, delay: 4.0), Timeout);
                foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
                {
                    engine.TickAndWait(ut, ConnectivityHorizonTestUplink.Snapshot(ut, connected: true, delay: 4.0, delayed: 10.0 + ut), Timeout);
                }

                // The reroute onto the longer path, still connected throughout.
                engine.TickAndWait(6.0, ConnectivityHorizonTestUplink.Snapshot(6.0, connected: true, delay: 8.0, delayed: 16.0), Timeout);
                await DrainAllStreamDataAsync(established, Quiet);

                // Only now does the station open.
                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(late, Topic, Timeout);

                var byTick = new Dictionary<double, List<double>>
                {
                    [6.0] = (await DrainAllStreamDataAsync(late, Quiet))
                        .Where(f => f.Topic == Topic).Select(f => f.Meta.ValidAt).ToList(),
                };
                for (var ut = 7.0; ut <= 14.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, ConnectivityHorizonTestUplink.Snapshot(ut, connected: true, delay: 8.0, delayed: 10.0 + ut), Timeout);
                    byTick[ut] = (await DrainAllStreamDataAsync(late, Quiet))
                        .Where(f => f.Topic == Topic).Select(f => f.Meta.ValidAt).ToList();
                }

                // The tail sent under the OLD 4 s path, one per tick, on its own
                // timing. Timed against the current 8 s ledger instead, the same
                // three samples land at UT 11, 12 and 13, behind two others that
                // this vantage was owed seconds earlier.
                Assert.Equal(new[] { 3.0 }, byTick[7.0]);
                Assert.Equal(new[] { 4.0 }, byTick[8.0]);
                Assert.Equal(new[] { 5.0 }, byTick[9.0]);

                // The catch-up frame is the UT 2 sample, and it lands on the UT 6
                // tick or the UT 7 one: a subscription is applied on the Courier
                // thread, so whether it is seen before or after that tick's clock
                // move is a race with the socket, not a property of the delay
                // model. Either way it is the newest sample that has ARRIVED, and
                // it is never one that has not.
                Assert.Subset(new HashSet<double> { 2.0 }, byTick[6.0].ToHashSet());

                // Then genuine silence while the first post-reroute sample crosses
                // the longer path, and it lands at 6 + 8.
                foreach (var ut in new[] { 10.0, 11.0, 12.0, 13.0 })
                {
                    Assert.Empty(byTick[ut]);
                }
                Assert.Equal(new[] { 6.0 }, byTick[14.0]);

                AssertNothingRepeatsOrArrivesEarly(byTick, oldDelay: 4.0, newDelay: 8.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The two properties that hold in both directions: a sample is
        /// delivered at most once (the duplicate storm), and never reaches the
        /// vantage sooner than the shorter of the two paths could carry it (the
        /// skip lands the tail early by definition).
        /// </summary>
        private static void AssertNothingRepeatsOrArrivesEarly(
            Dictionary<double, List<double>> byTick,
            double oldDelay,
            double newDelay)
        {
            var soonest = Math.Min(oldDelay, newDelay);
            foreach (var tick in byTick)
            {
                foreach (var validAt in tick.Value)
                {
                    Assert.True(
                        validAt + soonest <= tick.Key,
                        $"sample stamped UT {validAt} arrived at UT {tick.Key}, sooner than {soonest} s of light-time allows");
                }
            }

            var seen = byTick.Values.SelectMany(v => v).ToList();
            Assert.Equal(seen.Distinct().Count(), seen.Count);
        }
    }
}
