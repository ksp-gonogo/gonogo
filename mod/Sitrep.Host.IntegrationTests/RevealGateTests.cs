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
        /// The live SCANsat coverage shape: a DELAYED, DYNAMIC per-(body,type)
        /// topic whose keyframe is published exactly ONCE (keyframe-on-change),
        /// with a real comms delay active. A continuously-subscribed client must
        /// still receive that one keyframe once its reveal horizon passes — even
        /// though it is never re-published. Live, coverage (Delayed) never reached
        /// the subscriber while scansat.available (TrueNow) did; this pins whether
        /// the reveal gate drops a once-published Delayed dynamic keyframe.
        /// </summary>
        [Fact]
        public async Task ADelayedDynamicKeyframePublishedOnceIsRevealedToASubscriberAfterTheHorizon()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new DelayedDynamicKeyframeOnceTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                // comms.delay carried so the reveal gate has a nonzero horizon,
                // like the live SignalDelay capability.
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, DelayedDynamicKeyframeOnceTestUplink.FullTopic, Timeout);

                // UT 1: gate open → capture → the keyframe publishes ONCE at UT 1,
                // reveal delay 4 → horizon at UT 5. Never re-published afterwards.
                engine.TickAndWait(1.0, DelayedDynamicKeyframeOnceTestUplink.Snapshot(1.0, delay: 4.0), Timeout);
                for (double ut = 2.0; ut <= 4.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, DelayedDynamicKeyframeOnceTestUplink.Snapshot(ut, delay: 4.0), Timeout);
                }
                // Cross the horizon.
                engine.TickAndWait(5.0, DelayedDynamicKeyframeOnceTestUplink.Snapshot(5.0, delay: 4.0), Timeout);
                engine.TickAndWait(6.0, DelayedDynamicKeyframeOnceTestUplink.Snapshot(6.0, delay: 4.0), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == DelayedDynamicKeyframeOnceTestUplink.FullTopic);
            }
            finally
            {
                engine.Stop();
            }
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
        /// REGRESSION (the live "all Delayed channels frozen while comms reads
        /// connected" bug): a connectivity source that THROWS on a transient
        /// tick, while the link is otherwise CONNECTED with a POSITIVE delay,
        /// must NOT be treated as a disconnect. If a throwing tick flipped the
        /// gate to DISCONNECTED (the production defect —
        /// <c>Gonogo.KSP.CommsCoreUplink.ComputeConnectedOnMain</c> used to
        /// swallow the throw and return a hard <c>false</c>), then:
        /// <list type="number">
        /// <item>the buffered Delayed sample would freeze during the throwing
        /// tick, and</item>
        /// <item>the very next CONNECTED tick would be a disconnect→reconnect
        /// EDGE, DROPPING the backlog (<see cref="ChannelEngine"/>.SetCommsConnected)
        /// — so the pre-throw sample would be lost forever and never reveal.</item>
        /// </list>
        /// The correct fail-soft (a thrown source ⇒ CONNECTED, retried) keeps the
        /// gate connected across the blip, so the sample buffered before the throw
        /// still matures at its horizon. Asserting the sample IS revealed at its
        /// true SCET distinguishes the two precisely: it can only appear if the
        /// gate never froze/dropped it. This is the engine-side contract the
        /// production connectivity-source fix now satisfies (it propagates the
        /// throw to THIS fail-soft instead of asserting a hard disconnect).
        /// </summary>
        [Fact]
        public async Task ThrowingConnectivityTickDoesNotFreezeOrDropConnectedDelayedSample()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RecoverableSourceTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RecoverableSourceTestUplink.DelayedTopic, Timeout);

                // Connected, delay 4. Buffer delayed=10 at UT 1 (horizon 1−4=−3).
                engine.TickAndWait(0.0, RecoverableSourceTestUplink.Snapshot(0.0, connected: true, delay: 4.0), Timeout);
                engine.TickAndWait(1.0, RecoverableSourceTestUplink.Snapshot(1.0, connected: true, delay: 4.0, delayed: 10.0), Timeout);

                // UT 2 — the connectivity source THROWS. It must fail-soft to
                // CONNECTED, NOT flip the gate to disconnected. delay stays 4.
                engine.TickAndWait(2.0, RecoverableSourceTestUplink.Snapshot(2.0, delay: 4.0, delayed: 10.0, throwConn: true), Timeout);
                Assert.True(
                    engine.AvailabilityOf(RecoverableSourceTestUplink.Id).IsAvailable,
                    "comms uplink must stay Available after a transient connectivity-source throw");

                // UT 3..4 — connected again, still short of the horizon.
                foreach (var ut in new[] { 3.0, 4.0 })
                {
                    engine.TickAndWait(ut, RecoverableSourceTestUplink.Snapshot(ut, connected: true, delay: 4.0, delayed: 10.0), Timeout);
                }
                var beforeHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeHorizon, f => f.Topic == RecoverableSourceTestUplink.DelayedTopic);

                // UT 5 — horizon 5−4=1 reaches the sample's UT 1. It is revealed,
                // carrying its true SCET. Had the throwing tick frozen the gate,
                // the following connected tick's reconnect edge would have dropped
                // this sample and it would never appear.
                engine.TickAndWait(5.0, RecoverableSourceTestUplink.Snapshot(5.0, connected: true, delay: 4.0, delayed: 10.0), Timeout);
                var atHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var revealed = atHorizon.LastOrDefault(f => f.Topic == RecoverableSourceTestUplink.DelayedTopic);
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

        /// <summary>
        /// HEADLINE INVARIANT (flight-lifecycle spec, 2026-07-11, §"Delay
        /// invariants" #2 — <c>docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md</c>):
        /// "the reveal horizon is a COMMITMENT boundary" for the RELIABLE
        /// OUTBOX lane too, not just change-gated lossy values. This is the
        /// REQUIRED TEST the spec calls out as also auditing the CURRENT
        /// crash/recovery feature: <c>crash.lastCrash</c> and
        /// <c>recovery.lastSummary</c> are exactly this shape
        /// (<see cref="DelayRole.Delayed"/> + <see cref="Delivery.ReliableOrdered"/>,
        /// a discrete "last event" channel — see <see cref="ReliableRevertTestUplink"/>'s
        /// doc comment for how closely it mirrors <c>Gonogo.KSP.CrashUplink</c>).
        ///
        /// A reliable event publishes at UT 5 with a 4s reveal delay (horizon
        /// UT 9) — un-revealed. A revert to UT 2 fires BEFORE that horizon is
        /// reached. The doomed event must never surface: not to the ALREADY-
        /// subscribed bare-WS client even ticking the new timeline well past
        /// the original UT-9 horizon (proving the un-revealed entry was
        /// actually erased from <c>ChannelEngine._revealBuffer</c>, not merely
        /// re-scheduled — a stale <see cref="Sitrep.Core.ManualClock"/> callback
        /// or an unflushed buffer entry would leak it right here), and not to
        /// a LATE subscriber's reliable-lane catch-up keyframe after the
        /// revert. The reliable pipeline itself must still work for a
        /// legitimate, non-reverted event on the SAME subscription (no
        /// re-subscribe) — proving this is a targeted erasure of the
        /// abandoned branch, not a broken reliable lane.
        /// </summary>
        [Fact]
        public async Task RevertBeforeRevealErasesAReliableOrderedDelayedEventForever()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new ReliableRevertTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ReliableRevertTestUplink.ReliableTopic, Timeout);

                // Establish the delay authority: 4s one-way.
                engine.TickAndWait(0.0, ReliableRevertTestUplink.Snapshot(0.0, delay: 4.0), Timeout);

                // Advance to UT 5, then publish the DOOMED event AT UT 5.
                // Reveal horizon = 5 + 4 = 9, well ahead of "now" — genuinely
                // un-revealed, still sitting in the reveal buffer.
                engine.TickAndWait(5.0, ReliableRevertTestUplink.Snapshot(5.0, delay: 4.0), Timeout);
                uplink.PublishEvent("doomed-crash", 5.0);

                // Confirm it is un-revealed BEFORE the revert (short of the
                // UT-9 horizon).
                foreach (var ut in new[] { 6.0, 7.0, 8.0 })
                {
                    engine.TickAndWait(ut, ReliableRevertTestUplink.Snapshot(ut, delay: 4.0), Timeout);
                }
                var beforeRevert = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(beforeRevert, f => f.Topic == ReliableRevertTestUplink.ReliableTopic);

                // THE REVERT: backward tick to UT 2 — well before the UT-5
                // publish and its UT-9 horizon.
                engine.TickAndWait(2.0, ReliableRevertTestUplink.Snapshot(2.0, delay: 4.0), Timeout);

                // The timeline-reset event fires on the SAME reliable lane —
                // the subscription survived the reset.
                var reset = await ReceiveTypedAsync<EventMsg>(client, Timeout);
                Assert.Equal("timeline-reset", reset.Name);
                Assert.Equal(ReliableRevertTestUplink.ReliableTopic, reset.Topic);

                // Resume forward on the NEW timeline and push WELL past the
                // ABANDONED event's original UT-9 horizon, without ever
                // re-publishing it. Pre-fix (reveal buffer not cleared on
                // rewind), crossing "now - delay >= 5" here would flush and
                // reveal "doomed-crash" — exactly the counterfactual leak the
                // spec's invariant forbids.
                foreach (var ut in new[] { 3.0, 6.0, 9.0, 12.0 })
                {
                    engine.TickAndWait(ut, ReliableRevertTestUplink.Snapshot(ut, delay: 4.0), Timeout);
                }
                var afterRevert = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(afterRevert, f => f.Topic == ReliableRevertTestUplink.ReliableTopic);

                // The reliable lane still works: a LEGITIMATE post-revert
                // event published at UT 3 (horizon UT 7, already crossed by
                // the UT-12 tick above) reaches the SAME client on the SAME
                // subscription the moment the next tick flushes it.
                uplink.PublishEvent("legit-crash", 3.0);
                engine.TickAndWait(13.0, ReliableRevertTestUplink.Snapshot(13.0, delay: 4.0), Timeout);
                var revealed = await DrainAllStreamDataAsync(client, Quiet);
                var legit = revealed.LastOrDefault(f => f.Topic == ReliableRevertTestUplink.ReliableTopic);
                Assert.NotNull(legit);
                Assert.Equal("legit-crash", legit!.Payload);
                Assert.Equal(3.0, legit.Meta.ValidAt);

                // A LATE subscriber joining after the revert must catch up to
                // the legit keyframe ONLY — never the doomed one.
                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await late.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = ReliableRevertTestUplink.ReliableTopic }));
                var lateCatchUp = await DrainAllStreamDataAsync(late, Quiet);
                Assert.DoesNotContain(lateCatchUp, f => Equals(f.Payload, "doomed-crash"));
                var lateKeyframe = lateCatchUp.LastOrDefault(f => f.Topic == ReliableRevertTestUplink.ReliableTopic);
                Assert.NotNull(lateKeyframe);
                Assert.Equal("legit-crash", lateKeyframe!.Payload);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Connectivity MetaTopic (comms-delay-model-consistency spec): a signal
        /// loss must (1) still deliver the pre-outage in-flight TAIL of an
        /// ordinary Delayed channel as the horizon overtakes it, then FREEZE
        /// (no in-blackout samples), while (2) the freeze-EXEMPT connectivity
        /// MetaTopic (<c>comms.link</c>) reveals its <c>connected:false</c>
        /// disconnect edge THROUGH the blackout at the last-known light-time
        /// horizon — the whole point: "NO SIGNAL" reaches the client even though
        /// every other Delayed channel is frozen. This is the behaviour the OLD
        /// global <c>if (!_commsConnected) return;</c> in FlushReveal made
        /// impossible (it withheld the MetaTopic's own disconnect edge along with
        /// everything else, so the client could never learn the link dropped).
        ///
        /// <para>NOTE: this is a NEW test, distinct from
        /// <see cref="DisconnectFreezesDelayedChannelWhileTrueNowKeepsFlowing"/>
        /// (which uses a generic delayed channel and guards the delay-0-disconnect
        /// freeze — it must stay green and does).</para>
        /// </summary>
        [Fact]
        public async Task ConnectivityMetaTopicRevealsDisconnectEdgeThroughFreeze()
        {
            // NOTE: uses ConnectivityHorizonTestUplink, NOT FreezeGateTestUplink
            // (the fixture the three tests above use) — see that class's own
            // doc comment for why: FreezeGateTestUplink double-registers
            // comms.delay (Path 1 + Path 2), which clobbers
            // _lastConnectedDelaySeconds back to 0 on the very tick this test
            // needs it to hold at 4, defeating the timing assertion below.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ConnectivityHorizonTestUplink.DelayedTopic, Timeout);
                await SubscribeAsync(client, ConnectivityHorizonTestUplink.LinkTopic, Timeout);

                // CONNECTED, delay 4. Establish the delay authority + a link
                // sample (connected:true) at UT 0..1, and buffer delayed=10 at
                // UT 1 (horizon 1+4=5). The link channel emits connected:true.
                engine.TickAndWait(0.0, ConnectivityHorizonTestUplink.Snapshot(0.0, connected: true, delay: 4.0), Timeout);
                engine.TickAndWait(1.0, ConnectivityHorizonTestUplink.Snapshot(1.0, connected: true, delay: 4.0, delayed: 10.0), Timeout);

                // DISCONNECT at UT 2: connected:false, delay collapses to 0 (no
                // path). The link channel's disconnect edge must reveal at the
                // LAST-CONNECTED delay horizon (UT 2 + 4 = 6) — NOT the live,
                // collapsed-to-0 delay, which would reveal it instantly at UT 2.
                // Tick UT 3..5 first (still short of UT 6) and drain separately:
                // a regression that reveals off the live delay instead of
                // `_lastConnectedDelaySeconds` would show connected:false here
                // already, and the assertion below would catch it — the
                // original version of this test only checked the edge was
                // EVENTUALLY delivered, which such a regression would still pass.
                foreach (var ut in new[] { 2.0, 3.0, 4.0, 5.0 })
                {
                    engine.TickAndWait(ut, ConnectivityHorizonTestUplink.Snapshot(ut, connected: false, delay: 0.0, delayed: 999.0), Timeout);
                }
                var beforeLinkHorizon = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(
                    beforeLinkHorizon,
                    f => f.Topic == ConnectivityHorizonTestUplink.LinkTopic
                        && Equals(Assert.IsType<Dictionary<string, object?>>(f.Payload)["connected"], false));

                // UT 6..9: the last-connected-delay horizon (UT − 4) now reaches
                // the disconnect sample's UT of 2 — the reveal must land in this
                // batch, not the one before it.
                foreach (var ut in new[] { 6.0, 7.0, 8.0, 9.0 })
                {
                    engine.TickAndWait(ut, ConnectivityHorizonTestUplink.Snapshot(ut, connected: false, delay: 0.0, delayed: 999.0), Timeout);
                }
                var atAndAfterLinkHorizon = await DrainAllStreamDataAsync(client, Quiet);
                var frames = beforeLinkHorizon.Concat(atAndAfterLinkHorizon).ToList();

                // (1) The pre-outage tail: delayed=10 (buffered at UT 1, horizon
                // UT 5) IS revealed as the clock advances through the blackout.
                var delayedFrames = frames.Where(f => f.Topic == ConnectivityHorizonTestUplink.DelayedTopic).ToList();
                Assert.Contains(delayedFrames, f => Convert.ToDouble(f.Payload) == 10.0);
                // ...then FROZEN: no in-blackout delayed sample (999) ever arrives.
                Assert.DoesNotContain(delayedFrames, f => Convert.ToDouble(f.Payload) == 999.0);

                // (2) The connectivity MetaTopic's disconnect edge escapes the
                // freeze: a comms.link frame carrying connected:false is revealed
                // in the UT 6..9 batch, at its correct last-known horizon (UT 2 +
                // delay 4 = 6) — NOT the UT 2..5 batch above (asserted against
                // just above), which is where it would show up if a regression
                // read the live (collapsed) delay instead of
                // _lastConnectedDelaySeconds. The plain global-freeze gate could
                // never deliver this at all — the disconnect edge would be
                // withheld with everything else.
                var linkFrames = atAndAfterLinkHorizon.Where(f => f.Topic == ConnectivityHorizonTestUplink.LinkTopic).ToList();
                Assert.NotEmpty(linkFrames);
                Assert.Contains(linkFrames, f => Equals(Assert.IsType<Dictionary<string, object?>>(f.Payload)["connected"], false));
                var lastLink = linkFrames.Last();
                var linkPayload = Assert.IsType<Dictionary<string, object?>>(lastLink.Payload);
                Assert.Equal(false, linkPayload["connected"]);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
