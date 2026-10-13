using System;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A reading the craft could not send for want of a path stays withheld when
    /// the delay is switched off. The behaviour of readings that were sent is
    /// shown without the wire, where every delivery is visible and nothing is
    /// merged or waited for: <c>CourierBringForwardDeliveriesTests</c> for the
    /// lanes and the scaling, and <c>ReckoningScopeTests</c> for the engine
    /// bringing them forward and a centre acting on what it then hears.
    /// </summary>
    public class ReadingsInFlightOnShorterDelayTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        [Fact]
        public async Task ReadingsTakenWithNoPathStayHeldWhenTheDelayIsSwitchedOff()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.LinkTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 5.0, delayed: 10.0), Timeout);
                engine.TickAndWait(10.0, FreezeGateTestUplink.Snapshot(10.0, connected: false, delay: 5.0, delayed: 99.0), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                using var off = engine.DelayModifiers.Register(0.0, "test: switched off");
                engine.TickAndWait(12.0, FreezeGateTestUplink.Snapshot(12.0, connected: false, delay: 0.0, delayed: 98.0), Timeout);
                var frames = await DrainAllStreamDataAsync(client, Quiet);

                Assert.DoesNotContain(frames, f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null && Convert.ToDouble(f.Payload) >= 98.0);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
