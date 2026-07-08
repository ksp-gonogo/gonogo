using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The SERVER-SIDE reveal gate proven end-to-end over a real WebSocket —
    /// "a raw, non-SDK client experiences the delay" (spec-streaming-delay-model
    /// §4 / §7.3 Step 6). Everything here talks to <see cref="ChannelEngine"/>
    /// through the exact wire a curl script / third-party dashboard / station
    /// relay would use; there is no SDK, no ViewClock, no client-side legibility
    /// layer. What the client receives on the raw stream is therefore, by
    /// construction, ALREADY delayed — the un-bypassable choke point.
    /// </summary>
    public class RevealGateTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private static double? Latest(IEnumerable<StreamData> frames, string topic)
        {
            var match = frames.LastOrDefault(f => f.Topic == topic && f.Payload != null);
            return match == null ? (double?)null : Convert.ToDouble(match.Payload);
        }

        /// <summary>
        /// A Delayed channel's sample is WITHHELD from the wire until its UT
        /// crosses the reveal horizon (now − delay), then revealed; a TrueNow
        /// channel is revealed immediately; and <c>comms.delay</c> itself —
        /// the value that DEFINES the delay — is never gated by it.
        /// </summary>
        [Fact]
        public async Task DelayedChannelIsWithheldUntilHorizonWhileTrueNowIsLive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RevealGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // Establish the delay authority first: comms.delay = 4s one-way.
                // It is TrueNow, so it reaches the wire on the very tick it is
                // emitted — never gated by the 4s it defines (would be circular).
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                engine.TickAndWait(0.0, RevealGateTestUplink.Snapshot(0.0, delay: 4.0), Timeout);
                var afterDelay = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(afterDelay, f => f.Topic == ChannelEngine.CommsDelayTopic);

                // Now subscribe the two role-carrying channels and emit both at
                // UT 1. rev.truenow must arrive; rev.delayed must NOT (horizon
                // = 1 − 4 = −3, well short of its UT of 1).
                await SubscribeAsync(client, RevealGateTestUplink.TrueNowTopic, Timeout);
                await SubscribeAsync(client, RevealGateTestUplink.DelayedTopic, Timeout);
                engine.TickAndWait(1.0, RevealGateTestUplink.Snapshot(1.0, delay: 4.0, delayed: 10.0, trueNow: 20.0), Timeout);

                var atUt1 = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Equal(20.0, Latest(atUt1, RevealGateTestUplink.TrueNowTopic));
                Assert.DoesNotContain(atUt1, f => f.Topic == RevealGateTestUplink.DelayedTopic);

                // Advance the clock but stay short of the horizon: at UT 2..4 the
                // horizon (UT − 4) is still below the buffered sample's UT of 1,
                // so rev.delayed stays withheld tick after tick.
                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    engine.TickAndWait(ut, RevealGateTestUplink.Snapshot(ut, delay: 4.0, delayed: 10.0, trueNow: 20.0), Timeout);
                }
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == RevealGateTestUplink.DelayedTopic);

                // UT 5: horizon = 5 − 4 = 1 finally reaches the buffered sample's
                // UT of 1 — rev.delayed is revealed, carrying its true SCET (1),
                // arriving a full 4 UT-seconds after it was recorded.
                engine.TickAndWait(5.0, RevealGateTestUplink.Snapshot(5.0, delay: 4.0, delayed: 10.0, trueNow: 20.0), Timeout);
                var atHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var revealed = atHorizon.LastOrDefault(f => f.Topic == RevealGateTestUplink.DelayedTopic);
                Assert.NotNull(revealed);
                Assert.Equal(10.0, Convert.ToDouble(revealed!.Payload));
                Assert.Equal(1.0, revealed.Meta.ValidAt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A late subscriber's catch-up keyframe respects the horizon: it gets
        /// the latest sample AT-OR-BEFORE the reveal horizon, never a
        /// still-buffered future one. A newer value recorded past the horizon is
        /// invisible until it too matures — proving the gate composes with the
        /// keyframe-on-subscribe machinery (§7.3 Step 3).
        /// </summary>
        [Fact]
        public async Task LateSubscriberGetsLatestKeyframeAtOrBeforeHorizonNotAFutureOne()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RevealGateTestUplink());
            engine.Start();
            try
            {
                await using var driver = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(driver, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(driver, RevealGateTestUplink.DelayedTopic, Timeout);

                // delay = 4. rev.delayed = 10 at UT 1 (matures at horizon UT 5),
                // then changes to 11 at UT 6 (would mature only at UT 10).
                engine.TickAndWait(0.0, RevealGateTestUplink.Snapshot(0.0, delay: 4.0), Timeout);
                engine.TickAndWait(1.0, RevealGateTestUplink.Snapshot(1.0, delay: 4.0, delayed: 10.0), Timeout);
                foreach (var ut in new[] { 2.0, 3.0, 4.0, 5.0 })
                {
                    engine.TickAndWait(ut, RevealGateTestUplink.Snapshot(ut, delay: 4.0, delayed: 10.0), Timeout);
                }
                engine.TickAndWait(6.0, RevealGateTestUplink.Snapshot(6.0, delay: 4.0, delayed: 11.0), Timeout);
                engine.TickAndWait(7.0, RevealGateTestUplink.Snapshot(7.0, delay: 4.0, delayed: 11.0), Timeout);
                await DrainAllStreamDataAsync(driver, Quiet);

                // A brand-new client subscribes at UT 7. The horizon is 7 − 4 = 3.
                // The only revealed sample at-or-before UT 3 is 10@UT1; 11@UT6 is
                // still buffered (unrevealed). The catch-up keyframe must be 10,
                // NOT the future 11.
                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                // Subscribe WITHOUT SubscribeAsync: the catch-up keyframe is
                // delivered synchronously at subscribe time and would be
                // discarded by SubscribeAsync's ack-only receive loop. Drain
                // everything instead and pick the catch-up StreamData out.
                await late.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = RevealGateTestUplink.DelayedTopic }));
                var catchUp = await DrainAllStreamDataAsync(late, Quiet);
                var keyframe = catchUp.LastOrDefault(f => f.Topic == RevealGateTestUplink.DelayedTopic);
                Assert.NotNull(keyframe);
                Assert.Equal(10.0, Convert.ToDouble(keyframe!.Payload));
                Assert.Equal(1.0, keyframe.Meta.ValidAt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Signal delay disabled (delay value 0 — <see cref="CommsDelaySource.None"/>
        /// semantics) ⇒ a Delayed channel is revealed LIVE, on the tick it is
        /// emitted, exactly as a TrueNow channel. This is today's LAN behaviour,
        /// unchanged — the gate collapses to a pass-through when there is no
        /// delay authority.
        /// </summary>
        [Fact]
        public async Task ZeroDelayRevealsDelayedChannelLive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RevealGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, RevealGateTestUplink.DelayedTopic, Timeout);

                // delay = 0 (no delay authority): the Delayed channel must reach
                // the wire on the same tick it is emitted, no horizon wait.
                engine.TickAndWait(0.0, RevealGateTestUplink.Snapshot(0.0, delay: 0.0), Timeout);
                engine.TickAndWait(1.0, RevealGateTestUplink.Snapshot(1.0, delay: 0.0, delayed: 42.0), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Equal(42.0, Latest(frames, RevealGateTestUplink.DelayedTopic));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
