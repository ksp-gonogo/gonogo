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
    }
}
