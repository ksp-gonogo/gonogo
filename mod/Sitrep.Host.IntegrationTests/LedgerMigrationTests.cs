using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Ledger-migration (Plan 1) behaviour-preservation tests: the delay moves
    /// off the reveal-gate scalar into the Courier/Archive ledger, but every
    /// observable (reveal delay, freeze-on-disconnect hold + backlog drop,
    /// comms.delay / comms.link exemptions, command ETA) stays identical. The
    /// unchanged <see cref="RevealGateTests"/> suite is the primary gate; this
    /// class adds the migration-specific cross-checks.
    /// </summary>
    public class LedgerMigrationTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        [Fact]
        public async Task InstantTopicsDeliverImmediatelyRegardlessOfSignalDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.TrueNowTopic, Timeout);

                // Connected, non-zero delay: instant-class topics (comms.delay,
                // TrueNow) are exempt and must still arrive this tick. They ride
                // the meta-vantage (DelayTo -> 0) so the ledger never delays them.
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 240.0, trueNow: 42.0), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == ChannelEngine.CommsDelayTopic);
                Assert.Contains(frames, f => f.Topic == FreezeGateTestUplink.TrueNowTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task OrdinaryDelayedTopicIsRevealedByTheLedgerAtExactlyTheSignalDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                // Connected, delay 4. Emit the delayed value at UT 0.
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 4.0, delayed: 100.0), Timeout);

                // Before the horizon: withheld.
                engine.TickAndWait(3.0, FreezeGateTestUplink.Snapshot(3.0, connected: true, delay: 4.0), Timeout);
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == FreezeGateTestUplink.DelayedTopic);

                // At the horizon (UT 4 = validAt 0 + delay 4, NOT 8): revealed once, ValidAt 0.
                engine.TickAndWait(4.0, FreezeGateTestUplink.Snapshot(4.0, connected: true, delay: 4.0), Timeout);
                var atHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var delayed = atHorizon.Where(f => f.Topic == FreezeGateTestUplink.DelayedTopic).ToList();
                Assert.Single(delayed);
                Assert.Equal(0.0, delayed[0].Meta.ValidAt);
                Assert.Equal(100.0, Convert.ToDouble(delayed[0].Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task FreezeHoldsLastKnownAndDropsBacklogThroughTheLedger()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                // Outage UT 0..3: delayed values emitted while down are frozen (never delivered).
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: false, delay: 0.0), Timeout);
                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    engine.TickAndWait(ut, FreezeGateTestUplink.Snapshot(ut, connected: false, delay: 0.0, delayed: 10.0), Timeout);
                }
                var duringOutage = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(duringOutage, f => f.Topic == FreezeGateTestUplink.DelayedTopic);

                // Reconnect at UT 4: backlog dropped, resume from the reconnect moment.
                engine.TickAndWait(4.0, FreezeGateTestUplink.Snapshot(4.0, connected: true, delay: 0.0, delayed: 99.0), Timeout);
                var afterReconnect = await DrainAllStreamDataAsync(client, Quiet);
                var delivered = afterReconnect.Where(f => f.Topic == FreezeGateTestUplink.DelayedTopic).ToList();
                Assert.DoesNotContain(delivered, f => Convert.ToDouble(f.Payload) == 10.0); // backlog dropped
                Assert.Contains(delivered, f => Convert.ToDouble(f.Payload) == 99.0);       // resumed
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task CommsDelayAndCommsLinkExemptionsSurviveTheMigration()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, ChannelEngine.ConnectivityMetaTopic, Timeout);

                // Connected with a real delay, then a disconnect. comms.delay stays live
                // (instant, meta-vantage); comms.link reveals the disconnect edge through
                // the freeze (exempt) at its last-connected horizon.
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 5.0), Timeout);
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: false, delay: 0.0), Timeout);
                engine.TickAndWait(10.0, FreezeGateTestUplink.Snapshot(10.0, connected: false, delay: 0.0), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                // comms.delay delivered (never frozen, never ledger-delayed).
                Assert.Contains(frames, f => f.Topic == ChannelEngine.CommsDelayTopic);
                // comms.link's disconnect edge reached the client despite the blackout.
                Assert.Contains(frames, f => f.Topic == ChannelEngine.ConnectivityMetaTopic);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
