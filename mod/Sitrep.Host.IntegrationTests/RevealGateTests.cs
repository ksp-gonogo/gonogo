using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Sitrep.Host.Comms;
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
        /// The subscription-coupling regression: a raw client subscribes a
        /// Delayed channel but NEVER subscribes <c>comms.delay</c>. With signal
        /// delay enabled and a non-zero hop, the Delayed channel must STILL be
        /// withheld until its UT crosses the reveal horizon (now − delay).
        ///
        /// <para>This is the hole the wire-snoop had: the delay used to be
        /// captured off the <c>comms.delay</c> channel inside <c>Emit</c>, which
        /// only fired while <c>comms.delay</c> was SUBSCRIBED (the channel loop
        /// is subscription-gated). A client that subscribed a Delayed channel
        /// but not <c>comms.delay</c> therefore got it revealed live/ungated,
        /// defeating "any API client experiences the delay". The delay is now
        /// sourced from the server-side SignalDelay capability every tick
        /// regardless of subscription, so the gate holds here.</para>
        /// </summary>
        [Fact]
        public async Task DelayedChannelStillWithheldWhenClientNeverSubscribesCommsDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RevealGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // Subscribe ONLY the Delayed channel — deliberately NOT
                // comms.delay. delay = 4s one-way is present in every snapshot,
                // so the server-side capability computes it each tick even
                // though no client ever asked for comms.delay.
                await SubscribeAsync(client, RevealGateTestUplink.DelayedTopic, Timeout);

                engine.TickAndWait(0.0, RevealGateTestUplink.Snapshot(0.0, delay: 4.0), Timeout);
                engine.TickAndWait(1.0, RevealGateTestUplink.Snapshot(1.0, delay: 4.0, delayed: 10.0), Timeout);

                // Horizon at UT 1 is 1 − 4 = −3, far short of the sample's UT 1:
                // the Delayed channel must be withheld even though comms.delay
                // was never subscribed (the pre-fix wire-snoop would leave the
                // delay at 0 here and reveal it live).
                var atUt1 = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(atUt1, f => f.Topic == RevealGateTestUplink.DelayedTopic);

                // Hold short of the horizon at UT 2..4 — still withheld.
                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    engine.TickAndWait(ut, RevealGateTestUplink.Snapshot(ut, delay: 4.0, delayed: 10.0), Timeout);
                }
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == RevealGateTestUplink.DelayedTopic);

                // UT 5: horizon = 5 − 4 = 1 reaches the buffered sample's UT 1 —
                // now, and only now, it is revealed, carrying its true SCET.
                engine.TickAndWait(5.0, RevealGateTestUplink.Snapshot(5.0, delay: 4.0, delayed: 10.0), Timeout);
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
        /// REGRESSION (the production-shape reveal-gate bug): comms.delay is
        /// registered the way the bundled <c>CommsCoreUplink</c> registers it —
        /// via <see cref="IUplinkHost.Publisher"/> + a capture-on-main /
        /// handle-on-Courier <see cref="IUplinkHost.AddSampledSource"/>, declared
        /// TrueNow — NOT via <see cref="IUplinkHost.AddChannelSource"/> (the shape
        /// every other reveal-gate test used, and the only shape the old
        /// <c>RefreshSignalDelayFromCapability</c> could read). A raw client
        /// subscribes ONLY the Delayed channel (never comms.delay). With a
        /// non-zero computed one-way delay, the Delayed channel MUST still be
        /// withheld until its UT crosses the reveal horizon.
        ///
        /// <para>Pre-fix this FAILED: the gate's delay authority was only ever
        /// set from the <c>_channelSources</c> refresh (which production never
        /// populates for comms.delay) or the subscription-gated <c>Emit</c>
        /// snoop, so the delay stayed 0 and the Delayed channel was revealed
        /// live — the exact live-KSP symptom (deliveredAt − validAt == 0 despite
        /// comms.delay computing a real hop delay). The fix sources the delay
        /// from the server-side, subscription-independent
        /// <see cref="IUplinkHost.SetSignalDelaySource"/> seam every tick.</para>
        /// </summary>
        [Fact]
        public async Task ProductionShapeCommsDelayStillGatesDelayedChannel()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ProdShapeCommsRevealUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // Subscribe ONLY the Delayed channel — deliberately NOT
                // comms.delay. delay = 4s one-way is in every snapshot; the
                // server-side delay source computes it each tick regardless.
                await SubscribeAsync(client, ProdShapeCommsRevealUplink.DelayedTopic, Timeout);

                engine.TickAndWait(0.0, ProdShapeCommsRevealUplink.Snapshot(0.0, delay: 4.0), Timeout);
                engine.TickAndWait(1.0, ProdShapeCommsRevealUplink.Snapshot(1.0, delay: 4.0, delayed: 10.0), Timeout);

                // Horizon at UT 1 is 1 − 4 = −3 ≪ the sample's UT 1: withheld.
                var atUt1 = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(atUt1, f => f.Topic == ProdShapeCommsRevealUplink.DelayedTopic);

                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    engine.TickAndWait(ut, ProdShapeCommsRevealUplink.Snapshot(ut, delay: 4.0, delayed: 10.0), Timeout);
                }
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == ProdShapeCommsRevealUplink.DelayedTopic);

                // UT 5: horizon 5 − 4 = 1 reaches the buffered sample's UT 1 —
                // revealed now, carrying its true SCET.
                engine.TickAndWait(5.0, ProdShapeCommsRevealUplink.Snapshot(5.0, delay: 4.0, delayed: 10.0), Timeout);
                var atHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var revealed = atHorizon.LastOrDefault(f => f.Topic == ProdShapeCommsRevealUplink.DelayedTopic);
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

        /// <summary>
        /// U5 "Layer A" full-chain delay proof — the headless proxy for
        /// spec-streaming-delay-model §7.3 Step 6's host→client delay check,
        /// but with the delay authority sourced END-TO-END from the REAL comms
        /// stack instead of a raw snapshot number. A realistic multi-channel
        /// session over one real ClientWebSocket:
        /// <list type="bullet">
        /// <item><c>comms.delay</c> is computed by the CORE
        /// <see cref="SignalDelay"/> light-time math over the elected
        /// <see cref="ICommsBackend"/>'s hop geometry
        /// (<see cref="TestCommsCoreUplink"/>, election via
        /// <see cref="CommsElection"/>) — a genuine 4s one-way delay from a
        /// 4-light-second hop, not a hand-fed constant;</item>
        /// <item><c>vessel.flight</c> is DELAYED — withheld until its UT crosses
        /// the reveal horizon (now − 4);</item>
        /// <item><c>time.warp</c> is TRUE-NOW — revealed live;</item>
        /// <item><c>comms.delay</c> is TRUE-NOW — revealed live every tick,
        /// never gated by the delay it defines.</item>
        /// </list>
        /// This closes the loop the single-channel RevealGate tests above leave
        /// open: there the delay was a raw number in the snapshot; here the
        /// whole comms election → SignalDelay geometry → reveal-gate chain
        /// drives it, exactly as the in-game host will.
        /// </summary>
        [Fact]
        public async Task FullChainDelayOverRealBackendComputedDelay()
        {
            // 4 light-seconds ⇒ SignalDelay computes exactly 4.0s one-way.
            const double fourLightSeconds = 4.0 * SignalDelay.SpeedOfLightMetersPerSecond;
            var commsUplink = new TestCommsCoreUplink(fourLightSeconds, signalDelayEnabled: true);

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterDiscoveredUplinks(new System.Collections.Generic.List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(commsUplink, ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(new DelayRolesTestUplink(), ContractVersion.Major, ContractVersion.Minor),
            });
            engine.ResolveCapabilities();
            Assert.Equal(4.0, commsUplink.ExpectedOneWaySeconds, precision: 6);

            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, TestCommsCoreUplink.DelayTopic, Timeout);
                await SubscribeAsync(client, DelayRolesTestUplink.DelayedTopic, Timeout);
                await SubscribeAsync(client, DelayRolesTestUplink.TrueNowTopic, Timeout);

                // UT 0: establish the delay authority. comms.delay (TrueNow)
                // must reach the wire on this very tick, carrying the
                // geometry-derived 4s — never gated by the 4s it defines.
                engine.TickAndWait(0.0, DelayRolesTestUplink.Snapshot(0.0), Timeout);
                var atUt0 = await DrainAllStreamDataAsync(client, Quiet);
                var delay0 = atUt0.LastOrDefault(f => f.Topic == TestCommsCoreUplink.DelayTopic);
                Assert.NotNull(delay0);
                var delayPayload = Assert.IsType<System.Collections.Generic.Dictionary<string, object?>>(delay0!.Payload);
                Assert.Equal(4.0, Convert.ToDouble(delayPayload["oneWaySeconds"]), precision: 6);
                Assert.Equal(0.0, delay0.Meta.ValidAt);
                Assert.Equal(0.0, delay0.Meta.DeliveredAt); // live, ungated

                // UT 1: emit both role channels. time.warp (TrueNow) arrives;
                // vessel.flight (Delayed) does NOT (horizon 1 − 4 = −3 ≪ its UT 1).
                engine.TickAndWait(1.0, DelayRolesTestUplink.Snapshot(1.0, delayed: 10.0, trueNow: 20.0), Timeout);
                var atUt1 = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Equal(20.0, Latest(atUt1, DelayRolesTestUplink.TrueNowTopic));
                Assert.DoesNotContain(atUt1, f => f.Topic == DelayRolesTestUplink.DelayedTopic);
                // comms.delay still live on this tick.
                Assert.Contains(atUt1, f => f.Topic == TestCommsCoreUplink.DelayTopic && f.Meta.DeliveredAt == f.Meta.ValidAt);

                // UT 2..4: still short of the horizon — vessel.flight withheld.
                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    engine.TickAndWait(ut, DelayRolesTestUplink.Snapshot(ut, delayed: 10.0, trueNow: 20.0), Timeout);
                }
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == DelayRolesTestUplink.DelayedTopic);

                // UT 5: horizon 5 − 4 = 1 reaches the buffered sample's UT 1 —
                // vessel.flight is revealed, carrying its true SCET (1), a full
                // 4 UT-seconds after it was recorded.
                engine.TickAndWait(5.0, DelayRolesTestUplink.Snapshot(5.0, delayed: 10.0, trueNow: 20.0), Timeout);
                var atHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var revealed = atHorizon.LastOrDefault(f => f.Topic == DelayRolesTestUplink.DelayedTopic);
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
        /// REPRO (freeze-on-disconnect): with the control link DOWN and delay 0
        /// (<see cref="CommsDelaySource.None"/> — exactly what a lost path yields),
        /// a Delayed channel must be FROZEN — withheld, never delivered. A TrueNow
        /// channel (here <c>comms.delay</c>) must keep flowing so the operator
        /// sees the outage live.
        ///
        /// <para>Pre-change this FAILED: a down link produces delay 0, and the
        /// old gate keyed solely on delay magnitude — 0 ⇒ reveal live — so losing
        /// the link kept telemetry streaming (you'd "receive" what never arrived).
        /// The connectivity authority now distinguishes a real disconnect (freeze)
        /// from a genuine connected zero-distance link (still live).</para>
        /// </summary>
        [Fact]
        public async Task DisconnectFreezesDelayedChannelWhileTrueNowKeepsFlowing()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.TrueNowTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                // Link DOWN from the outset; delay 0 (no path ⇒ None). Emit the
                // Delayed channel AND a TrueNow channel every tick.
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: false, delay: 0.0), Timeout);
                foreach (var ut in new[] { 1.0, 2.0, 3.0, 4.0, 5.0 })
                {
                    engine.TickAndWait(ut, FreezeGateTestUplink.Snapshot(ut, connected: false, delay: 0.0, delayed: 10.0 + ut, trueNow: 20.0 + ut), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                // FROZEN: the Delayed channel never reached the wire.
                Assert.DoesNotContain(frames, f => f.Topic == FreezeGateTestUplink.DelayedTopic);
                // LIVE: the TrueNow channel and comms.delay kept flowing.
                Assert.Contains(frames, f => f.Topic == FreezeGateTestUplink.TrueNowTopic);
                Assert.Contains(frames, f => f.Topic == ChannelEngine.CommsDelayTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Freeze-on-disconnect, connected leg: a genuinely CONNECTED link with a
        /// positive delay still gates by the horizon (buffer then reveal) — the
        /// connectivity signal does not change the connected-with-delay behaviour.
        /// This is the existing gate contract, re-proven through the production
        /// connectivity+delay seams.
        /// </summary>
        [Fact]
        public async Task ConnectedWithDelayStillWithholdsThenReveals()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 4.0), Timeout);
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: 4.0, delayed: 10.0), Timeout);

                var atUt1 = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(atUt1, f => f.Topic == FreezeGateTestUplink.DelayedTopic);

                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    engine.TickAndWait(ut, FreezeGateTestUplink.Snapshot(ut, connected: true, delay: 4.0, delayed: 10.0), Timeout);
                }
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == FreezeGateTestUplink.DelayedTopic);

                engine.TickAndWait(5.0, FreezeGateTestUplink.Snapshot(5.0, connected: true, delay: 4.0, delayed: 10.0), Timeout);
                var atHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var revealed = atHorizon.LastOrDefault(f => f.Topic == FreezeGateTestUplink.DelayedTopic);
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
        /// Reconnect: the backlog withheld during the outage is DROPPED (not
        /// replayed), and delivery resumes from the reconnect moment. A value
        /// buffered while disconnected must never reach the wire; a value emitted
        /// after reconnect (delay 0 ⇒ live) must.
        /// </summary>
        [Fact]
        public async Task ReconnectDropsBacklogAndResumesFromReconnectMoment()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                // Outage UT 0..3: delayed=10 emitted while the link is down — it
                // is buffered/frozen, never delivered.
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: false, delay: 0.0), Timeout);
                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    engine.TickAndWait(ut, FreezeGateTestUplink.Snapshot(ut, connected: false, delay: 0.0, delayed: 10.0), Timeout);
                }
                var duringOutage = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(duringOutage, f => f.Topic == FreezeGateTestUplink.DelayedTopic);

                // Reconnect at UT 4 (delay 0 ⇒ live) and emit a fresh value.
                engine.TickAndWait(4.0, FreezeGateTestUplink.Snapshot(4.0, connected: true, delay: 0.0, delayed: 99.0), Timeout);
                var afterReconnect = await DrainAllStreamDataAsync(client, Quiet);

                var delivered = afterReconnect.Where(f => f.Topic == FreezeGateTestUplink.DelayedTopic).ToList();
                // Backlog dropped: the frozen 10 never surfaces.
                Assert.DoesNotContain(delivered, f => Convert.ToDouble(f.Payload) == 10.0);
                // Resumed: the post-reconnect 99 is delivered from the reconnect moment.
                Assert.Contains(delivered, f => Convert.ToDouble(f.Payload) == 99.0);
                Assert.Equal(4.0, delivered.Last(f => Convert.ToDouble(f.Payload) == 99.0).Meta.ValidAt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// REGRESSION (live-KSP session-killer): the server-side signal-delay
        /// source threw ONCE on a transient scene-settle tick, and the old
        /// fail-soft PERMANENTLY disabled it + marked the comms uplink
        /// Unavailable — so comms.delay stopped flowing and delay enforcement
        /// stayed dead for the rest of the session. The fix makes the delay-source
        /// fail-soft RECOVERABLE: a throwing tick yields no update, but the source
        /// is retried the next tick and the uplink stays Available. This FAILS on
        /// the old permanent-disable behaviour (uplink Unavailable, comms.delay
        /// inert after the throw) and passes after.
        /// </summary>
        [Fact]
        public async Task DelaySourceThrowIsRecoverableAndDelayResumes()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RecoverableSourceTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);

                // Tick 0 — establish the delay authority (comms.delay = 4s).
                engine.TickAndWait(0.0, RecoverableSourceTestUplink.Snapshot(0.0, delay: 4.0), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                // Tick 1 — the delay source THROWS (transient scene-settle NRE).
                engine.TickAndWait(1.0, RecoverableSourceTestUplink.Snapshot(1.0, delay: 4.0, throwDelay: true), Timeout);

                // The throw must NOT permanently disable comms: the uplink stays
                // Available (old behaviour marked it Unavailable here).
                Assert.True(
                    engine.AvailabilityOf(RecoverableSourceTestUplink.Id).IsAvailable,
                    "comms uplink must stay Available after a transient delay-source throw");

                // Tick 2 — the source RECOVERS and reports a CHANGED delay (5s).
                // comms.delay must reach the wire again — proving the channel/
                // source resumed (old behaviour left it inert forever).
                engine.TickAndWait(2.0, RecoverableSourceTestUplink.Snapshot(2.0, delay: 5.0), Timeout);
                var afterRecovery = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(afterRecovery, f => f.Topic == ChannelEngine.CommsDelayTopic);
                Assert.True(engine.AvailabilityOf(RecoverableSourceTestUplink.Id).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Twin of the delay-source recovery: the CONNECTIVITY source throwing on
        /// a transient tick must fail-soft to CONNECTED and be RETRIED, never
        /// permanently disable the comms uplink (which would leave every comms.*
        /// channel inert for the session). FAILS on the old permanent-disable
        /// behaviour.
        /// </summary>
        [Fact]
        public async Task ConnectivitySourceThrowIsRecoverableAndChannelsStayLive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RecoverableSourceTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RecoverableSourceTestUplink.DelayedTopic, Timeout);

                // Tick 0 — connected, delay 0 (reveal live).
                engine.TickAndWait(0.0, RecoverableSourceTestUplink.Snapshot(0.0, connected: true, delay: 0.0), Timeout);
                // Tick 1 — connectivity source THROWS; must fail-soft to CONNECTED.
                engine.TickAndWait(1.0, RecoverableSourceTestUplink.Snapshot(1.0, delay: 0.0, delayed: 10.0, throwConn: true), Timeout);
                Assert.True(
                    engine.AvailabilityOf(RecoverableSourceTestUplink.Id).IsAvailable,
                    "comms uplink must stay Available after a transient connectivity-source throw");

                // Tick 2 — recovers; a delayed sample at delay 0 must be delivered
                // live (channel is not inert, gate is not frozen).
                engine.TickAndWait(2.0, RecoverableSourceTestUplink.Snapshot(2.0, connected: true, delay: 0.0, delayed: 11.0), Timeout);
                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == RecoverableSourceTestUplink.DelayedTopic);
                Assert.True(engine.AvailabilityOf(RecoverableSourceTestUplink.Id).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A delay/connectivity source that returns NULL (graceful "no authority /
        /// no path" — the real-world meaning of an unloaded/no-control-path
        /// vessel) must leave the last-known state untouched and reveal live,
        /// never disable the uplink. No throw, no permanent disable.
        /// </summary>
        [Fact]
        public async Task NullDelayAndConnectivityRevealLiveWithoutDisable()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RecoverableSourceTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RecoverableSourceTestUplink.DelayedTopic, Timeout);

                // No "delay" / "connected" keys ⇒ both sources return null every
                // tick (graceful no-authority). delayed=10 at UT 1 must reveal
                // live (no delay authority ⇒ delay 0; connectivity default
                // CONNECTED), and the uplink must never go Unavailable.
                engine.TickAndWait(0.0, RecoverableSourceTestUplink.Snapshot(0.0), Timeout);
                engine.TickAndWait(1.0, RecoverableSourceTestUplink.Snapshot(1.0, delayed: 10.0), Timeout);
                var frames = await DrainAllStreamDataAsync(client, Quiet);

                Assert.Contains(frames, f => f.Topic == RecoverableSourceTestUplink.DelayedTopic);
                Assert.True(engine.AvailabilityOf(RecoverableSourceTestUplink.Id).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
