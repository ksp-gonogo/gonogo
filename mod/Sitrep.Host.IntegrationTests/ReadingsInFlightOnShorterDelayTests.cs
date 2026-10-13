using System;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Readings a delay is still holding back when the delay is shortened or
    /// switched off: they reach a client at the moment of the change, in the
    /// order they were taken, rather than at the time the old delay promised. A
    /// reading the craft could not send for want of a path is not among them.
    /// </summary>
    public class ReadingsInFlightOnShorterDelayTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        /// <summary>Frames drained until <paramref name="enough"/> holds of them, or the operation budget runs out, so a busy machine cannot end the wait before a frame is flushed.</summary>
        private static async Task<System.Collections.Generic.List<Sitrep.Contract.StreamData<object?>>> DrainUntilAsync(
            TestClient client,
            Func<System.Collections.Generic.List<Sitrep.Contract.StreamData<object?>>, bool> enough)
        {
            var all = new System.Collections.Generic.List<Sitrep.Contract.StreamData<object?>>();
            var deadline = DateTime.UtcNow + Timeout;
            while (DateTime.UtcNow < deadline)
            {
                all.AddRange(await DrainAllStreamDataAsync(client, Quiet));
                if (enough(all))
                {
                    break;
                }
            }

            return all;
        }

        [Fact]
        public async Task SwitchingDelayOffDeliversReadingsOnTheirWayAtOnceInTheOrderTaken()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.LinkTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 90.0, delayed: 10.0), Timeout);
                engine.TickAndWait(10.0, FreezeGateTestUplink.Snapshot(10.0, connected: true, delay: 90.0, delayed: 20.0), Timeout);
                engine.TickAndWait(30.0, FreezeGateTestUplink.Snapshot(30.0, connected: true, delay: 90.0, delayed: 30.0), Timeout);
                var before = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(before, f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null);

                using var off = engine.DelayModifiers.Register(0.0, "test: switched off");
                engine.TickAndWait(31.0, FreezeGateTestUplink.Snapshot(31.0, connected: true, delay: 0.0, delayed: 40.0), Timeout);
                var after = await DrainUntilAsync(client, frames =>
                    frames.Any(f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null && Convert.ToDouble(f.Payload) == 10.0)
                    && frames.Any(f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null && Convert.ToDouble(f.Payload) == 40.0));

                // A lossy topic may merge readings that land together on the wire, which ones varies from run
                // to run, so what is asserted is that the first reading in flight lands at the switch and the
                // order is kept.
                var landed = after.Where(f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null).ToList();
                Assert.Contains(landed, f => Convert.ToDouble(f.Payload) == 10.0);
                Assert.All(landed, f => Assert.Equal(31.0, f.Meta.DeliveredAt));
                var values = landed.Select(f => Convert.ToDouble(f.Payload)).ToList();
                Assert.Equal(values.OrderBy(v => v), values);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task RaisingLightSpeedBringsReadingsOnTheirWayForwardByTheSameShare()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.LinkTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 90.0, delayed: 10.0), Timeout);
                engine.TickAndWait(30.0, FreezeGateTestUplink.Snapshot(30.0, connected: true, delay: 90.0, delayed: 20.0), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                // At 31 the light speed doubles: the first reading's 59 seconds left become 29.5, so it lands at 60.5 rather than 90.
                using var faster = engine.DelayModifiers.Register(0.5, "test: light speed doubled");
                engine.TickAndWait(31.0, FreezeGateTestUplink.Snapshot(31.0, connected: true, delay: 45.0, delayed: 21.0), Timeout);
                engine.TickAndWait(60.0, FreezeGateTestUplink.Snapshot(60.0, connected: true, delay: 45.0, delayed: 22.0), Timeout);
                var early = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(early, f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null && Convert.ToDouble(f.Payload) == 10.0);

                engine.TickAndWait(61.0, FreezeGateTestUplink.Snapshot(61.0, connected: true, delay: 45.0, delayed: 23.0), Timeout);
                var landed = await DrainUntilAsync(client, frames =>
                    frames.Any(f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null && Convert.ToDouble(f.Payload) == 10.0));
                Assert.Contains(landed, f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null && Convert.ToDouble(f.Payload) == 10.0);
            }
            finally
            {
                engine.Stop();
            }
        }

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
