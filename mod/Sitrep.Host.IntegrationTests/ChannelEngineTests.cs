using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Engine-level tests for <see cref="ChannelEngine"/> that go BEYOND the
    /// single <c>system.bodies</c> topic <see cref="ReplayToWebSocketEndToEndTests"/>
    /// exercises — proving the multi-topic/multi-command generalization
    /// itself (not just that the retrofitted <c>system.bodies</c> channel
    /// still behaves like <c>GonogoBodiesServer</c> did). See
    /// <c>local_docs/telemetry-mod/extension-sdk-contract-design.md</c> §1.1
    /// (delivery classes) and §4.3 (the <c>delayed</c> command flag).
    /// </summary>
    public class ChannelEngineTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public async Task MultipleRegisteredChannelsEmitAndSubscriptionGateIndependently()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new MultiChannelTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // Subscribe to "chan.a" only.
                await SubscribeAsync(client, "chan.a", Timeout);

                // A tick carrying data for BOTH channels: only "chan.a" has a
                // subscriber, so only it should ever reach the emitter --
                // the exact outer/inner gate SubscriptionRegistry/ChannelEmitter
                // already prove individually, now proven per-topic through
                // the multi-channel engine.
                engine.TickAndWait(0.0, MultiChannelTestExtension.Snapshot(a: 1, b: 100), Timeout);

                Assert.Equal(1, engine.ChannelCounters("chan.a").Considered);
                Assert.Equal(1, engine.ChannelCounters("chan.a").Emitted);
                Assert.Equal(0, engine.ChannelCounters("chan.b").Considered);
                Assert.Equal(0, engine.ChannelCounters("chan.b").Emitted);

                var deliveredA = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal("chan.a", deliveredA.Topic);
                Assert.Equal(1.0, Convert.ToDouble(deliveredA.Payload));

                // Nothing for chan.b - it was never subscribed.
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // Now subscribe to "chan.b" too and tick again with DIFFERENT
                // values for both - both channels must emit independently
                // (distinct channelId state inside the shared ChannelEmitter/
                // SubscriptionRegistry), and the newly-subscribed "chan.b"
                // gets its own subscribe-triggered keyframe rather than
                // waiting on "chan.a"'s cadence.
                await SubscribeAsync(client, "chan.b", Timeout);
                engine.TickAndWait(1.0, MultiChannelTestExtension.Snapshot(a: 2, b: 200), Timeout);

                Assert.Equal(2, engine.ChannelCounters("chan.a").Emitted);
                Assert.Equal(1, engine.ChannelCounters("chan.b").Emitted);

                var seenTopics = new HashSet<string>();
                for (var i = 0; i < 2; i++)
                {
                    var delivered = await ReceiveStreamDataAsync(client, Timeout);
                    seenTopics.Add(delivered.Topic);
                }
                Assert.Contains("chan.a", seenTopics);
                Assert.Contains("chan.b", seenTopics);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Proves the <see cref="Delivery"/> split: a <c>reliable-ordered</c>
        /// channel's outbox lane is an unbounded FIFO queue that is NEVER
        /// overwritten, so every emitted sample WILL eventually reach the
        /// wire regardless of how the independent outbox pump thread happens
        /// to interleave with the rapid-fire producer below (a genuine
        /// two-thread race — see <see cref="DrainToLatestStreamDataAsync"/>'s
        /// doc comment for the same race acknowledged elsewhere in this
        /// project) — that guarantee is what this test asserts on, not
        /// "coalescing didn't happen this run" (which would be flaky). The
        /// SAME rapid-fire ticks drive a <c>lossy-latest</c> channel too:
        /// its outbox lane CAN coalesce multiple pending writes down to
        /// fewer frames, so this test only asserts the two structurally
        /// guaranteed facts about it: it never receives MORE frames than the
        /// reliable channel (both are Decide-gated identically, so at most
        /// one emission per tick either way), and the LAST value observed
        /// is always the final tick's value.
        /// </summary>
        [Fact]
        public async Task ReliableOrderedNeverDropsAFrameWhileLossyLatestMayCoalesceUnderRapidEmission()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new DeliveryClassTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, DeliveryClassTestExtension.ReliableTopic, Timeout);
                await SubscribeAsync(client, DeliveryClassTestExtension.LossyTopic, Timeout);

                const int sampleCount = 5;
                for (var i = 0; i < sampleCount; i++)
                {
                    // Both channels read the SAME "value" key, so every tick
                    // emits an identical value sequence on both - only the
                    // DELIVERY LANE differs.
                    engine.TickAndWait(i, DeliveryClassTestExtension.Snapshot(i), Timeout);
                }

                // Structural guarantee, independent of scheduling: the emitter
                // considered/emitted exactly `sampleCount` samples on BOTH
                // channels (Decide-gating doesn't know about delivery class).
                Assert.Equal(sampleCount, engine.ChannelCounters(DeliveryClassTestExtension.ReliableTopic).Emitted);
                Assert.Equal(sampleCount, engine.ChannelCounters(DeliveryClassTestExtension.LossyTopic).Emitted);

                // ONE drain covering both subscribed topics - a second,
                // separate drain call would find the channel already
                // exhausted by the first (see DrainAllStreamDataAsync's doc
                // comment).
                var allFrames = await DrainAllStreamDataAsync(client, TimeSpan.FromMilliseconds(500));
                var reliableFrames = allFrames.FindAll(f => f.Topic == DeliveryClassTestExtension.ReliableTopic);
                var lossyFrames = allFrames.FindAll(f => f.Topic == DeliveryClassTestExtension.LossyTopic);

                // Reliable-ordered: EVERY emitted sample reaches the wire, in
                // order, never coalesced - the FIFO queue guarantees this
                // regardless of the outbox pump's timing.
                Assert.Equal(sampleCount, reliableFrames.Count);
                for (var i = 0; i < sampleCount; i++)
                {
                    Assert.Equal((double)i, Convert.ToDouble(reliableFrames[i].Payload));
                }

                // Lossy-latest: at most as many frames as reliable (never
                // MORE - same Decide gate), and the final value always wins -
                // whether or not any intermediate frame happened to survive
                // the race is deliberately NOT asserted on (would be flaky).
                Assert.True(lossyFrames.Count >= 1 && lossyFrames.Count <= sampleCount);
                Assert.Equal((double)(sampleCount - 1), Convert.ToDouble(lossyFrames[^1].Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void DelayedFalseCommandBypassesTheCourierDelayWhileDelayedTrueWaitsForIt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            engine.RegisterExtension(new DelayFlagTestExtension());
            engine.Start();
            try
            {
                var infraResolved = false;
                object? infraResult = null;
                engine.DispatchCommandAndWait(
                    DelayFlagTestExtension.InfraCommand, "x", "vantage-1",
                    result => { infraResolved = true; infraResult = result; },
                    TimeSpan.FromMilliseconds(500));

                // Ground-infrastructure command: resolves on the SAME
                // job-processing step, no Tick/clock-advance needed at all -
                // the Courier's 5s-each-way delay never comes into it.
                Assert.True(infraResolved, "delayed:false command should resolve without any clock advance");
                Assert.Equal("pong:x", infraResult);

                var vesselResolved = false;
                object? vesselResult = null;
                engine.DispatchCommandAndWait(
                    DelayFlagTestExtension.VesselCommand, "y", "vantage-1",
                    result => { vesselResolved = true; vesselResult = result; },
                    TimeSpan.FromMilliseconds(300));

                // Still pending: a normal (delayed:true) command rides the
                // Courier's uplink+downlink delay (2 * 5s = 10s of UT), and
                // no Tick has advanced the clock at all yet.
                Assert.False(vesselResolved, "delayed:true command must not resolve before the Courier's scheduled UT");

                // Advance the clock past the full round trip (dispatch UT 0
                // + 5s uplink + 5s downlink = 10) - the response fires from
                // the ORIGINAL dispatch's still-pending callback, proving it
                // was genuinely delayed rather than lost.
                engine.TickAndWait(10.0, null, Timeout);

                Assert.True(vesselResolved);
                Assert.Equal("pong:y", vesselResult);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// M1 Task 3 — proves the REAL <see cref="VesselCommandProvider"/>
        /// handlers + the REAL per-command <see cref="CommandDeclaration.Delayed"/>
        /// flags (not a synthetic stand-in) actually dispatch through
        /// <see cref="ChannelEngine"/> with the taxonomy's ruling: actuation
        /// (<c>vessel.control.setSas</c>) rides the Courier's light-time
        /// delay; planning/designation (<c>vessel.target.clear</c>) resolves
        /// immediately. Same shape as
        /// <see cref="DelayedFalseCommandBypassesTheCourierDelayWhileDelayedTrueWaitsForIt"/>
        /// above (the M0.5 command-delay test), now exercised against the
        /// actual vessel command manifest via <see cref="VesselCommandTestExtension"/>
        /// (a KSP-free stand-in for <c>Gonogo.KSP.VesselExtension</c> — this
        /// project deliberately never references <c>Gonogo.KSP</c>, see this
        /// file's own top-of-class doc comment).
        /// </summary>
        [Fact]
        public void VesselCommandsDispatchWithTheirDeclaredDelayDispositionActuationDelayedPlanningImmediate()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            var actuator = new RecordingVesselActuator();
            engine.RegisterExtension(new VesselCommandTestExtension(actuator));
            engine.Start();
            try
            {
                // ---- delayed:true actuation: vessel.control.setSas ----
                var sasResolved = false;
                Ack? sasResult = null;
                engine.DispatchCommandAndWait(
                    VesselCommandProvider.SetSasCommand, new SetEnabledArgs { Enabled = true }, "vantage-1",
                    result => { sasResolved = true; sasResult = (Ack)result!; },
                    TimeSpan.FromMilliseconds(300));

                Assert.False(sasResolved, "delayed:true vessel.control.setSas must not resolve before the Courier's scheduled UT");
                Assert.Null(actuator.LastSetSasEnabled);

                // Advance past the full round trip (5s uplink + 5s downlink = 10 UT-s).
                engine.TickAndWait(10.0, null, Timeout);

                Assert.True(sasResolved);
                Assert.True(sasResult!.Success);
                Assert.True(actuator.LastSetSasEnabled, "the REAL VesselCommandProvider.HandleSetSas handler should have called the actuator once the delay elapsed");

                // ---- delayed:false planning/designation: vessel.target.clear ----
                var clearResolved = false;
                Ack? clearResult = null;
                engine.DispatchCommandAndWait(
                    VesselCommandProvider.TargetClearCommand, null, "vantage-1",
                    result => { clearResolved = true; clearResult = (Ack)result!; },
                    TimeSpan.FromMilliseconds(300));

                Assert.True(clearResolved, "delayed:false vessel.target.clear should resolve without any further clock advance");
                Assert.True(clearResult!.Success);
                Assert.Equal(1, actuator.ClearTargetCallCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// M1 Task 3 review fix #2: the design table's <c>ActionGroup</c>
        /// union (§3) lists <c>abort</c> alongside gear/brakes/lights, but no
        /// command existed for it and it wasn't listed as deferred either —
        /// a straight-up gap. Built as its own dedicated command
        /// (<c>vessel.control.setAbort</c>) following the exact same
        /// pattern/disposition as <c>setGear</c>/<c>setBrakes</c>/
        /// <c>setLights</c> (delayed:true actuation, absolute
        /// <see cref="SetEnabledArgs"/>), so this test mirrors the SAS block
        /// above rather than inventing a new assertion shape.
        /// </summary>
        [Fact]
        public void SetAbortCommandDispatchesAsDelayedTrueActuationAndReachesTheActuator()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            var actuator = new RecordingVesselActuator();
            engine.RegisterExtension(new VesselCommandTestExtension(actuator));
            engine.Start();
            try
            {
                var resolved = false;
                Ack? result = null;
                engine.DispatchCommandAndWait(
                    VesselCommandProvider.SetAbortCommand, new SetEnabledArgs { Enabled = true }, "vantage-1",
                    r => { resolved = true; result = (Ack)r!; },
                    TimeSpan.FromMilliseconds(300));

                Assert.False(resolved, "delayed:true vessel.control.setAbort must not resolve before the Courier's scheduled UT");
                Assert.Null(actuator.LastSetAbortEnabled);

                engine.TickAndWait(10.0, null, Timeout);

                Assert.True(resolved);
                Assert.True(result!.Success);
                Assert.True(actuator.LastSetAbortEnabled, "the REAL VesselCommandProvider.HandleSetAbort handler should have called the actuator once the delay elapsed");
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// CRITICAL-2 (concurrency red-team, probe-verified): a wire command
        /// whose args mismatch its handler's declared TArgs used to throw
        /// <c>InvalidCastException</c> straight out of
        /// <see cref="ChannelEngine.AddCommandHandler{TArgs,TResult}"/>'s
        /// <c>(TArgs)args!</c> cast, on the Courier thread, with nothing
        /// catching it — killing the thread and wedging the ENTIRE engine
        /// (every subscriber, every channel, every command) permanently.
        /// Dispatched here via the REAL socket path (a raw wire
        /// <c>CommandRequest</c>, the same shape <c>OnMessageReceived</c>
        /// parses in production) rather than the internal
        /// <see cref="ChannelEngine.DispatchCommand"/> entry point, so this
        /// proves the fix end to end from where a hostile/buggy client
        /// input actually enters the engine.
        /// </summary>
        [Fact]
        public async Task UnguardedCommandHandlerExceptionFailSoftsOnlyThatCommandAndKeepsTheCourierThreadAlive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new CrashyCommandTestExtension());
            engine.RegisterExtension(new MultiChannelTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "chan.a", Timeout);

                // Sanity: the unrelated, healthy channel works before we do
                // anything to the crashy one.
                engine.TickAndWait(0.0, MultiChannelTestExtension.Snapshot(a: 1, b: 100), Timeout);
                var before = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(1.0, Convert.ToDouble(before.Payload));

                // The wire sends a raw double (5) against a handler declared
                // for a string TArgs — exactly the InvalidCastException
                // shape a malformed/hostile client argument produces.
                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "r1",
                    Command = CrashyCommandTestExtension.Command,
                    Args = 5.0,
                    SentAt = 0.0,
                }));

                // Pre-fix: this throws on the Courier thread and kills it —
                // no response ever arrives, and the engine is permanently
                // wedged (proven below). Post-fix: InvokeCommandHandler
                // catches it, fail-softs just this command's owning
                // extension, and the caller still gets a (graceful, null)
                // response instead of hanging forever.
                var response = await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
                Assert.Equal("r1", response.RequestId);
                Assert.Null(response.Result);
                Assert.False(engine.AvailabilityOf(CrashyCommandTestExtension.ExtensionId).IsAvailable);

                // The engine STAYS ALIVE: a subsequent tick on the
                // completely unrelated, healthy channel still delivers
                // normally — proof the Courier thread never died.
                engine.TickAndWait(1.0, MultiChannelTestExtension.Snapshot(a: 2, b: 200), Timeout);
                var after = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(2.0, Convert.ToDouble(after.Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// IMPORTANT-B: the SAME fail-soft mechanism as the test above, but
        /// with a genuinely STRUCTURED (JSON-object) wire arg — the shape
        /// <c>EnvelopeCodec</c> parses a command's args into by default
        /// (double/string/bool/<c>Dictionary&lt;string, object?&gt;</c> — see
        /// its own doc comment) — mismatched against a handler declared for
        /// a scalar <c>double</c>. Covers the "structured-args command"
        /// shape distinctly from the scalar-vs-scalar mismatch above.
        /// </summary>
        [Fact]
        public async Task StructuredWireArgsMismatchedAgainstADeclaredScalarHandlerFailSoftsInsteadOfCrashing()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new ScalarArgCommandTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "r-structured",
                    Command = ScalarArgCommandTestExtension.Command,
                    Args = new Dictionary<string, object?> { ["x"] = 1.0, ["y"] = 2.0 },
                    SentAt = 0.0,
                }));

                var response = await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
                Assert.Equal("r-structured", response.RequestId);
                Assert.Null(response.Result);
                Assert.False(engine.AvailabilityOf(ScalarArgCommandTestExtension.ExtensionId).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// IMPORTANT-A (task-review): availability was TRACKED but never
        /// CONSULTED — a throwing <see cref="ISitrepExtension.Register"/>
        /// flipped <see cref="ChannelEngine.AvailabilityOf"/> but every
        /// channel that extension had already registered (before the throw)
        /// stayed live forever. Here the extension registers TWO channels
        /// successfully, then throws — proving NEITHER channel ever emits
        /// afterward (checked via <see cref="ChannelEngine.ChannelCounters"/>'s
        /// <c>Considered</c>, since "nothing arrived on the wire" alone
        /// doesn't distinguish this from nobody subscribing either way —
        /// same rationale <c>ZeroSubscribersNeverReachTheEmitter...</c> in
        /// <c>ReplayToWebSocketEndToEndTests</c> uses it for), while a
        /// totally unrelated, healthy extension's channel is unaffected.
        /// </summary>
        [Fact]
        public async Task ExtensionThatThrowsAfterRegisteringChannelsTakesBothItsChannelsInertButLeavesOthersUnaffected()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new ThrowsAfterRegisteringTwoChannelsExtension());
            engine.RegisterExtension(new MultiChannelTestExtension());
            engine.Start();
            try
            {
                Assert.False(engine.AvailabilityOf(ThrowsAfterRegisteringTwoChannelsExtension.ExtensionId).IsAvailable);

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ThrowsAfterRegisteringTwoChannelsExtension.Chan1, Timeout);
                await SubscribeAsync(client, ThrowsAfterRegisteringTwoChannelsExtension.Chan2, Timeout);
                await SubscribeAsync(client, "chan.a", Timeout);

                var snapshot = new KspSnapshot
                {
                    Values = new Dictionary<string, object?>
                    {
                        ["chan1"] = 1.0,
                        ["chan2"] = 2.0,
                        ["a"] = 3.0,
                        ["b"] = 4.0,
                    },
                };
                engine.TickAndWait(0.0, snapshot, Timeout);

                // NEITHER of the broken extension's channels was even
                // considered — registration having thrown after both
                // AddChannelSource calls succeeded takes the WHOLE
                // extension's channels inert together.
                Assert.Equal(0, engine.ChannelCounters(ThrowsAfterRegisteringTwoChannelsExtension.Chan1).Considered);
                Assert.Equal(0, engine.ChannelCounters(ThrowsAfterRegisteringTwoChannelsExtension.Chan2).Considered);

                // A totally unrelated, healthy extension's channel is
                // unaffected.
                Assert.Equal(1, engine.ChannelCounters("chan.a").Considered);
                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal("chan.a", delivered.Topic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// MEDIUM-3 (task-review): <see cref="ChannelEngine"/>'s subscribe
        /// handler used to bail unless the topic had a pull-style
        /// <c>AddChannelSource</c> mapper registered — a
        /// <see cref="IExtensionHost.Publisher"/>-only (event-driven) channel
        /// was DECLARED (in the manifest) but could never actually be
        /// subscribed, so <see cref="IChannelPublisher.Publish"/> for it was
        /// permanently a no-op (nobody could ever be "subscribed" to receive
        /// it).
        /// </summary>
        [Fact]
        public async Task PublisherOnlyChannelCanBeSubscribedAndPublishReachesTheSubscriber()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var extension = new PublisherOnlyTestExtension();
            engine.RegisterExtension(extension);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SubscribeAsync(client, PublisherOnlyTestExtension.Topic, Timeout);

                // Publish an event-driven payload at UT 1, then advance the
                // clock (an ordinary empty tick) to fire its scheduled
                // delivery — in production the main loop is always ticking,
                // so a publish is picked up on the next clock advance. The
                // point this test proves is that a Publisher-only channel is
                // now SUBSCRIBABLE at all (pre-fix ProcessSubscribe bailed on
                // it, so Publish could never reach anyone); the delivery
                // mechanism itself is the same Courier path every channel
                // uses.
                extension.Publisher!.Publish(42.0, 1.0);
                engine.TickAndWait(1.0, null, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(PublisherOnlyTestExtension.Topic, delivered.Topic);
                Assert.Equal(42.0, Convert.ToDouble(delivered.Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// C2-1 (second-round fail-soft re-attack): <c>_emitter.Decide</c> is
        /// called OUTSIDE the try/catch that already guards <c>map()</c> in
        /// <see cref="ChannelEngine.ProcessTick"/> -- but <c>Decide</c> itself
        /// runs extension-authored code for a structured payload (the
        /// deadband falls back to <c>Equals</c> -- see
        /// <c>ChannelEmitter.HasChangedBeyondQuantum</c>). A throwing
        /// <c>Equals</c> used to escape the channel loop entirely, skipping
        /// <c>_clock.AdvanceTo</c> for the WHOLE tick -- not just this
        /// channel -- which is why a totally unrelated, healthy channel
        /// (owned by a DIFFERENT extension, so IMPORTANT-A's per-extension
        /// fail-soft can't mask the bug) is asserted on here: pre-fix its
        /// delivery is delayed/stuck for this tick and any that follow until
        /// some later tick's AdvanceTo happens to catch up; post-fix it
        /// keeps arriving promptly, tick after tick, while the throwing
        /// channel's own topic goes permanently silent and its extension
        /// flips Unavailable.
        /// </summary>
        [Fact]
        public async Task ThrowingEqualsDuringDecideFailSoftsOnlyThatChannelAndClockKeepsAdvancing()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new EqualsThrowsTestExtension());
            engine.RegisterExtension(new MultiChannelTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, EqualsThrowsTestExtension.Topic, Timeout);
                await SubscribeAsync(client, "chan.a", Timeout);

                // Tick0: first-ever Decide for both channels is a forced
                // keyframe -- Equals is never consulted on a keyframe, so
                // both succeed regardless of the fix.
                engine.TickAndWait(0.0, EqualsThrowsTestExtension.Snapshot(new EqualsThrowsPayload(), a: 1), Timeout);
                var seenTick0 = new HashSet<string>();
                for (var i = 0; i < 2; i++)
                {
                    var delivered = await ReceiveStreamDataAsync(client, Timeout);
                    seenTick0.Add(delivered.Topic);
                }
                Assert.Contains(EqualsThrowsTestExtension.Topic, seenTick0);
                Assert.Contains("chan.a", seenTick0);

                // Tick1: a NEW EqualsThrowsPayload instance is not
                // keyframe-due (interval is huge) and isn't numeric, so the
                // deadband falls back to Equals -- which throws.
                engine.TickAndWait(1.0, EqualsThrowsTestExtension.Snapshot(new EqualsThrowsPayload(), a: 2), Timeout);

                // The healthy, differently-owned channel still gets mapped,
                // recorded, AND delivered THIS tick -- proof the clock
                // genuinely advanced rather than merely being unstuck later.
                var afterA = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal("chan.a", afterA.Topic);
                Assert.Equal(2.0, Convert.ToDouble(afterA.Payload));

                // The throwing channel's own topic never emits again -- its
                // owning extension went Unavailable -- and nothing else
                // arrives for it.
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));
                Assert.False(engine.AvailabilityOf(EqualsThrowsTestExtension.ExtensionId).IsAvailable);

                // A THIRD tick proves the engine is genuinely healthy going
                // forward, not merely coincidentally unstuck for one more
                // delivery.
                engine.TickAndWait(2.0, EqualsThrowsTestExtension.Snapshot(new EqualsThrowsPayload(), a: 3), Timeout);
                var afterA2 = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal("chan.a", afterA2.Topic);
                Assert.Equal(3.0, Convert.ToDouble(afterA2.Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// C2-2(a): <c>ChannelEmitter.TryToDouble</c> accepts a wider set of
        /// numeric CLR types (including <c>decimal</c>) than
        /// <c>JsonWriter.AppendValue</c> supported -- a mapper returning a
        /// boxed <c>decimal</c> passed the emitter's deadband gate fine but
        /// threw <c>NotSupportedException</c> at delivery-serialization time.
        /// Proves the widening: the value now serializes (as a JSON number)
        /// and reaches the subscriber, and the owning extension is never
        /// marked Unavailable.
        /// </summary>
        [Fact]
        public async Task DecimalChannelValueSerializesAndDeliversAfterJsonWriterWidening()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new DecimalPayloadTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, DecimalPayloadTestExtension.Topic, Timeout);

                engine.TickAndWait(0.0, DecimalPayloadTestExtension.Snapshot(123.45m), Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(DecimalPayloadTestExtension.Topic, delivered.Topic);
                Assert.Equal(123.45, Convert.ToDouble(delivered.Payload), 3);
                Assert.True(engine.AvailabilityOf(DecimalPayloadTestExtension.ExtensionId).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// C2-2(b): a payload that is genuinely unserializable (not fixed by
        /// the (a) widening -- an arbitrary CLR object, not a recognized
        /// numeric/string/dictionary/enumerable shape) must fail-soft the
        /// OWNING extension on the first failed delivery rather than
        /// recurring silently forever. Proven via <c>ChannelCounters</c>'s
        /// <c>Considered</c>: pinned at 1 (IMPORTANT-A's availability gate
        /// stops the channel from even being considered again) rather than
        /// climbing with every subsequent tick.
        /// </summary>
        [Fact]
        public async Task GenuinelyUnserializablePayloadFailsSoftTheOwningExtensionInsteadOfRecurringSilently()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new PoisonPayloadTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, PoisonPayloadTestExtension.Topic, Timeout);

                engine.TickAndWait(0.0, PoisonPayloadTestExtension.Snapshot(), TimeSpan.FromMilliseconds(500));
                engine.TickAndWait(1.0, PoisonPayloadTestExtension.Snapshot(), TimeSpan.FromMilliseconds(500));
                engine.TickAndWait(2.0, PoisonPayloadTestExtension.Snapshot(), TimeSpan.FromMilliseconds(500));

                // Never reaches the wire -- the payload can never serialize.
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                Assert.False(engine.AvailabilityOf(PoisonPayloadTestExtension.ExtensionId).IsAvailable);
                Assert.Equal(1, engine.ChannelCounters(PoisonPayloadTestExtension.Topic).Considered);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// C2-3: a throw during <c>Courier.SubscribeStream</c>'s SYNCHRONOUS
        /// catch-up delivery (a second subscriber joining after a poison
        /// sample is already archived) used to unwind after
        /// <c>_subscriptions.Subscribe</c> + the Courier's own subscriber-set
        /// add but BEFORE <c>session.Unsubscribers[topic]</c> was set and
        /// before the ack was sent -- an orphaned subscriber (no ack, no
        /// bookkeeping to clean it up later). Proven end-to-end: the second
        /// client's ack must still arrive, the shared subscription count
        /// must correctly reflect both subscribers, and disconnecting the
        /// second client must cleanly bring the count back down (proof its
        /// Unsubscribers entry was genuinely registered, not orphaned).
        /// </summary>
        [Fact]
        public async Task SubscribeCatchUpThrowRollsBackBookkeepingInsteadOfOrphaningTheSubscriber()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new PoisonPayloadTestExtension());
            engine.Start();
            try
            {
                await using var clientA = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(clientA, PoisonPayloadTestExtension.Topic, Timeout);

                // Records one poison sample into the archive so a SECOND
                // subscriber's synchronous catch-up has something already
                // "arrived" to (attempt to) deliver.
                engine.TickAndWait(0.0, PoisonPayloadTestExtension.Snapshot(), TimeSpan.FromMilliseconds(500));

                await using var clientB = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var ack = await SubscribeAsync(clientB, PoisonPayloadTestExtension.Topic, TimeSpan.FromSeconds(2));
                Assert.Equal("subscribed", ack.Name);
                Assert.Equal(2, engine.SubscriberCountFor(PoisonPayloadTestExtension.Topic));

                await clientB.DisposeAsync();

                var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(3);
                while (engine.SubscriberCountFor(PoisonPayloadTestExtension.Topic) != 1 && DateTime.UtcNow < deadline)
                {
                    await Task.Delay(25);
                }
                Assert.Equal(1, engine.SubscriberCountFor(PoisonPayloadTestExtension.Topic));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// C2-4: <c>WriteCommandResponse</c> serializes the handler's result
        /// OUTSIDE <c>InvokeCommandHandler</c>'s guard (in the
        /// <c>OnMessageReceived</c> callback), so a handler that returns an
        /// unserializable result used to throw silently -- the client never
        /// receives ANY response (not even an error) and the failure is
        /// unattributed. Post-fix: the client gets an explicit
        /// <see cref="ErrorMsg"/> instead of silence, and the owning
        /// extension is marked Unavailable.
        /// </summary>
        [Fact]
        public async Task UnserializableCommandResultSendsAnErrorResponseInsteadOfSilence()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new PoisonResultCommandTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "r-poison",
                    Command = PoisonResultCommandTestExtension.Command,
                    Args = null,
                    SentAt = 0.0,
                }));

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("r-poison", error.RequestId);
                Assert.False(engine.AvailabilityOf(PoisonResultCommandTestExtension.ExtensionId).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// C1-pub: <c>ProcessPublish</c> trusted the caller-stamped
        /// <c>ut</c> with no sanity check against the clock's current
        /// position. An extension that captures "now" (via
        /// <c>IExtensionHost.NowUt()</c>) and only gets around to
        /// <c>Publish</c>ing it AFTER a quickload rewound the clock backward
        /// hands the engine a ghost timestamp from the abandoned timeline --
        /// numerically AHEAD of the rewound clock, so it can never be caught
        /// by <c>Courier.ResetTimeline</c>'s one-time retroactive prune
        /// (which only ever runs at the moment of the rewind, strictly
        /// before this late Publish call). Proven by clamping: the
        /// delivered sample's <c>Meta.ValidAt</c> must land at-or-before the
        /// clock's position when the publish was actually processed, never
        /// at the stale pre-rewind UT it arrived stamped with.
        /// </summary>
        [Fact]
        public async Task PublishedUtFromBeforeAQuickloadRewindIsClampedRatherThanGhostingIntoTheArchive()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var extension = new GhostPublishTestExtension();
            engine.RegisterExtension(extension);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, GhostPublishTestExtension.Topic, Timeout);

                // Advance to a high UT, establishing the "old" timeline the
                // extension will (mis-)remember.
                engine.TickAndWait(500.0, null, Timeout);

                // Quickload: rewinds the clock back to UT 10.
                engine.TickAndWait(10.0, null, Timeout);

                // The extension captured "now" (500) BEFORE the rewind and
                // only gets around to Publishing it afterward.
                extension.Publisher!.Publish(42.0, 500.0);

                // Advance far enough that the ghost's ORIGINAL (unclamped)
                // fireUt=500 would have fired by now too, whether or not the
                // fix clamped it -- so this assertion isn't just "nothing
                // arrived yet".
                engine.TickAndWait(600.0, null, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(GhostPublishTestExtension.Topic, delivered.Topic);
                Assert.Equal(42.0, Convert.ToDouble(delivered.Payload));
                Assert.True(
                    delivered.Meta.ValidAt <= 10.0 + 1e-6,
                    $"expected the ghost's ValidAt to be clamped to <= 10, but got {delivered.Meta.ValidAt}");
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Coverage-sweep Finding 1 (round 3): <c>_samplers</c> used to be a
        /// bare <c>List&lt;ISnapshotSampler&gt;</c> with no owner
        /// attribution at all — unlike a channel mapper or command handler
        /// (see <see cref="IsChannelAvailable"/>/<see cref="IsCommandAvailable"/>),
        /// a sampler that throws was caught (so the Courier thread survived
        /// — CRITICAL-2) but never marked its owning extension
        /// <see cref="Availability.Unavailable"/>, so the SAME throwing
        /// sampler was re-invoked, and re-logged, every single tick forever.
        /// Proves both halves of the fix: the owning extension goes
        /// Unavailable after the first throw, AND the sampler is skipped
        /// (not re-invoked) on the very next tick.
        /// </summary>
        [Fact]
        public void ThrowingSamplerFailSoftsItsOwningExtensionAndIsSkippedOnTheNextTick()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var extension = new ThrowingSamplerTestExtension();
            engine.RegisterExtension(extension);
            engine.Start();
            try
            {
                var snapshot = new KspSnapshot { Values = new Dictionary<string, object?>() };

                engine.TickAndWait(0.0, snapshot, Timeout);
                Assert.Equal(1, extension.Sampler.CallCount);

                // Pre-fix: no owner attribution means the extension stays
                // Available no matter how many times its sampler throws.
                Assert.False(
                    engine.AvailabilityOf(ThrowingSamplerTestExtension.ExtensionId).IsAvailable,
                    "owning extension should be Unavailable after its sampler threw");

                engine.TickAndWait(1.0, snapshot, Timeout);

                // Pre-fix: the sampler loop unconditionally re-invokes every
                // registered sampler every tick, so CallCount would climb to
                // 2 here. Post-fix: the owner is Unavailable, so this second
                // tick must SKIP it entirely — CallCount stays pinned at 1.
                Assert.Equal(1, extension.Sampler.CallCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Coverage-sweep Finding 2 (round 3): <c>FailSoftCommand</c>/
        /// <c>FailSoftChannel</c> used to build their log <c>reason</c> via
        /// an unguarded <c>$"...{ex.Message}"</c> interpolation BEFORE the
        /// owner lookup + <c>MarkExtensionUnavailable</c> call. <c>Message</c>
        /// is an ordinary virtual getter — a legal (if hostile) custom
        /// exception can override it to throw — so a poisoned Message getter
        /// aborted the fail-soft guard before it ever attributed the
        /// failure, escaping to <c>CourierLoop</c>'s own non-attributing
        /// backstop try/catch. The offending extension never went
        /// Unavailable and (for a non-delayed command, as here) the
        /// dispatch's <c>onResult</c>/<c>Done</c> callback never fired
        /// either, since the escape happens before <c>ProcessDispatchCommand</c>
        /// reaches them.
        /// </summary>
        [Fact]
        public void CommandHandlerThrowingAnExceptionWhoseMessageGetterThrowsStillMarksTheOwnerUnavailable()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new MessageGetterThrowsCommandTestExtension());
            engine.RegisterExtension(new MultiChannelTestExtension());
            engine.Start();
            try
            {
                var resolved = false;
                engine.DispatchCommandAndWait(
                    MessageGetterThrowsCommandTestExtension.Command, null, "vantage-1",
                    _ => resolved = true,
                    TimeSpan.FromMilliseconds(500));

                // Pre-fix: the poisoned Message getter aborts FailSoftCommand
                // before MarkExtensionUnavailable runs, so the owner stays
                // Available and onResult/Done never fire (resolved stays
                // false) -- the whole thing silently vanishes into
                // CourierLoop's backstop instead.
                Assert.True(resolved, "onResult should still fire (with a graceful null) once the guard attributes and returns");
                Assert.False(
                    engine.AvailabilityOf(MessageGetterThrowsCommandTestExtension.ExtensionId).IsAvailable,
                    "owning extension should be Unavailable even though ex.Message itself throws");
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// M1 vessel-extension foundation: proves <c>IExtensionHost.
        /// ForceKeyframe</c> actually reaches <c>ChannelEmitter</c> and makes
        /// the NEXT <c>Decide</c> call unconditional, even for a value that
        /// would otherwise be suppressed by the deadband/rate-clamp gates --
        /// the mechanism <c>Sitrep.Host.VesselEpochSampler</c> relies on to
        /// turn a vessel-guid change into a clean epoch boundary (see
        /// local_docs/telemetry-mod/m1-provider-taxonomy-design.md §6.1).
        /// <c>VesselEpochSampler</c> itself is unit-tested against a fake
        /// <c>IExtensionHost</c> in <c>Sitrep.Host.Tests</c> (no real engine
        /// needed there); THIS test is the complementary proof that the
        /// engine-level plumbing behind <c>ForceKeyframe</c> is real.
        /// </summary>
        [Fact]
        public async Task ForceKeyframeMakesTheNextDecideCallUnconditionalEvenWithinTheDeadband()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new ForceKeyframeTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ForceKeyframeTestExtension.Topic, Timeout);

                // Initial subscribe-triggered keyframe.
                engine.TickAndWait(0.0, ForceKeyframeTestExtension.Snapshot(0), Timeout);
                Assert.Equal(1, engine.ChannelCounters(ForceKeyframeTestExtension.Topic).Emitted);
                await ReceiveStreamDataAsync(client, Timeout);

                // A small change, well within the wide (100-unit) deadband --
                // Considered goes up, Emitted does not.
                engine.TickAndWait(1.0, ForceKeyframeTestExtension.Snapshot(10), Timeout);
                Assert.Equal(2, engine.ChannelCounters(ForceKeyframeTestExtension.Topic).Considered);
                Assert.Equal(1, engine.ChannelCounters(ForceKeyframeTestExtension.Topic).Emitted);
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // Force a keyframe via a command handler (the Courier-thread-
                // safe call site ForceKeyframe's contract requires).
                var forced = false;
                engine.DispatchCommandAndWait(
                    ForceKeyframeTestExtension.ForceCommand, null, "vantage-1",
                    _ => forced = true,
                    Timeout);
                Assert.True(forced);

                // SAME value as the last (skipped) tick -- still within the
                // deadband -- but the forced keyframe makes this Decide call
                // unconditional: it emits anyway.
                engine.TickAndWait(2.0, ForceKeyframeTestExtension.Snapshot(10), Timeout);
                Assert.Equal(2, engine.ChannelCounters(ForceKeyframeTestExtension.Topic).Emitted);
                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(ForceKeyframeTestExtension.Topic, delivered.Topic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A structured payload that serializes FINE (it's a
        /// <c>Dictionary&lt;string, object?&gt;</c> subclass, so
        /// <c>JsonWriter.AppendValue</c> writes it as a plain JSON object --
        /// empty, here, since no entries are ever added) but whose
        /// <c>Equals</c> throws. Deliberately NOT an unserializable shape:
        /// this isolates the C2-1 bug (a throw from
        /// <c>ChannelEmitter.Decide</c>'s deadband Equals fallback) from the
        /// separate C2-2 bug (a throw from delivery-time serialization) --
        /// using a poison-serialization payload here would trip the C2-2
        /// guard at the very first delivery instead of exercising Decide's
        /// own Equals-throws path this test targets.
        /// </summary>
        private sealed class EqualsThrowsPayload : Dictionary<string, object?>
        {
            public override bool Equals(object? obj) => throw new InvalidOperationException("boom -- Equals throws");
            public override int GetHashCode() => 0;
        }

        private sealed class EqualsThrowsTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-equals-throws";
            public const string Topic = "equals.throws";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource(Topic, s => s != null && s.Values.TryGetValue("throws", out var v) ? v : null);
            }

            public static KspSnapshot Snapshot(EqualsThrowsPayload throwsValue, double a)
            {
                return new KspSnapshot
                {
                    Values = new Dictionary<string, object?> { ["throws"] = throwsValue, ["a"] = a, ["b"] = a * 100 },
                };
            }
        }

        private sealed class DecimalPayloadTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-decimal-payload";
            public const string Topic = "decimal.topic";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource(Topic, s => s != null && s.Values.TryGetValue("value", out var v) ? v : null);
            }

            public static KspSnapshot Snapshot(decimal value)
            {
                return new KspSnapshot { Values = new Dictionary<string, object?> { ["value"] = value } };
            }
        }

        /// <summary>Backs <c>ForceKeyframeMakesTheNextDecideCallUnconditionalEvenWithinTheDeadband</c> — a wide deadband (100) and long keyframe cadence (10,000 UT) so an in-deadband re-tick would ordinarily be skipped, isolating the forced-keyframe path from cadence/change-gate noise.</summary>
        private sealed class ForceKeyframeTestExtension : ISitrepExtension
        {
            public const string Topic = "force.keyframe.topic";
            public const string ForceCommand = "force.keyframe.command";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-force-keyframe",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 10_000, quantum: EmissionQuantum.Absolute(100)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = ForceCommand, Delayed = false },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource(Topic, s => s != null && s.Values.TryGetValue("v", out var v) ? v : null);
                host.AddCommandHandler<object?, object?>(ForceCommand, _ =>
                {
                    host.ForceKeyframe(Topic);
                    return null;
                });
            }

            public static KspSnapshot Snapshot(double v) => new KspSnapshot { Values = new Dictionary<string, object?> { ["v"] = v } };
        }

        private sealed class PoisonPayload
        {
            public int Marker;
        }

        private sealed class PoisonPayloadTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-poison-payload";
            public const string Topic = "poison.topic";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource(Topic, s => new PoisonPayload());
            }

            public static KspSnapshot Snapshot() => new KspSnapshot { Values = new Dictionary<string, object?>() };
        }

        private sealed class PoisonResultCommandTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-poison-result-command";
            public const string Command = "poison.result.command";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delayed = false },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddCommandHandler<object?, object?>(Command, _ => new PoisonPayload());
            }
        }

        private sealed class GhostPublishTestExtension : ISitrepExtension
        {
            public const string Topic = "ghost.publish.topic";

            public IChannelPublisher? Publisher { get; private set; }

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-ghost-publish",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 10000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                Publisher = host.Publisher(Topic);
            }
        }

        // NOTE (LOW-4): the ClearTopic lossy-lane flush that
        // BroadcastTimelineReset performs on a rewind is proven
        // DETERMINISTICALLY at the outbox level by
        // Sitrep.Host.Tests.ChannelOutboxClearTopicTests (a gated connection
        // parks the pump so the reliable-then-lossy drain ordering is
        // asserted exactly). An engine-level version isn't a valid
        // fail-first test: ChannelEngine builds its own outbox from the real
        // Fleck connection, whose independent pump thread drains a queued
        // lossy frame to the wire almost immediately — so the queued-at-reset
        // window the fix closes can't be forced deterministically from here.
        // The data-plane guarantee (no stale pre-rewind VALUE reaches a
        // subscriber after a reset) is covered separately by CRITICAL-1's
        // CourierTimelineResetTests and the wire-level
        // ServerClockRewindResets... test.

        private sealed class CrashyCommandTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-crashy-command";
            public const string Command = "crashy.command";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delayed = false },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddCommandHandler<string, string>(Command, args => "pong:" + args);
            }
        }

        private sealed class ScalarArgCommandTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-scalar-arg-command";
            public const string Command = "scalar.command";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delayed = false },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddCommandHandler<double, double>(Command, x => x * 2);
            }
        }

        private sealed class ThrowsAfterRegisteringTwoChannelsExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-throws-after-registering";
            public const string Chan1 = "broken.chan1";
            public const string Chan2 = "broken.chan2";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Chan1,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                    new ChannelDeclaration
                    {
                        Topic = Chan2,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource(Chan1, s => s != null && s.Values.TryGetValue("chan1", out var v) ? v : null);
                host.AddChannelSource(Chan2, s => s != null && s.Values.TryGetValue("chan2", out var v) ? v : null);
                throw new InvalidOperationException("boom -- simulated bad extension");
            }
        }

        private sealed class PublisherOnlyTestExtension : ISitrepExtension
        {
            public const string Topic = "publisher.only";

            public IChannelPublisher? Publisher { get; private set; }

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-publisher-only",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                Publisher = host.Publisher(Topic);
            }
        }

        private sealed class MultiChannelTestExtension : ISitrepExtension
        {
            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-multi",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = "chan.a",
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                    new ChannelDeclaration
                    {
                        Topic = "chan.b",
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource("chan.a", s => s != null && s.Values.TryGetValue("a", out var v) ? v : null);
                host.AddChannelSource("chan.b", s => s != null && s.Values.TryGetValue("b", out var v) ? v : null);
            }

            public static KspSnapshot Snapshot(double a, double b)
            {
                return new KspSnapshot { Values = new Dictionary<string, object?> { ["a"] = a, ["b"] = b } };
            }
        }

        private sealed class ThrowingSampler : ISnapshotSampler
        {
            public int CallCount { get; private set; }

            public void Sample(KspSnapshot snapshot)
            {
                CallCount++;
                throw new InvalidOperationException("boom -- sampler throws");
            }
        }

        private sealed class ThrowingSamplerTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-throwing-sampler";

            public ThrowingSampler Sampler { get; } = new ThrowingSampler();

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
            };

            public void Register(IExtensionHost host)
            {
                host.AddSampler(Sampler);
            }
        }

        /// <summary>A legal but hostile exception whose own Message getter throws — see <see cref="MessageGetterThrowsCommandTestExtension"/>.</summary>
        private sealed class MessageThrowsException : Exception
        {
            public override string Message => throw new InvalidOperationException("boom -- Message getter itself throws");
        }

        private sealed class MessageGetterThrowsCommandTestExtension : ISitrepExtension
        {
            public const string ExtensionId = "test-message-getter-throws-command";
            public const string Command = "message.getter.throws.command";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = ExtensionId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delayed = false },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddCommandHandler<object?, object?>(Command, _ => throw new MessageThrowsException());
            }
        }

        private sealed class DeliveryClassTestExtension : ISitrepExtension
        {
            public const string ReliableTopic = "reliable.topic";
            public const string LossyTopic = "lossy.topic";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-delivery",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = ReliableTopic,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                    new ChannelDeclaration
                    {
                        Topic = LossyTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource(ReliableTopic, ReadValue);
                host.AddChannelSource(LossyTopic, ReadValue);
            }

            private static object? ReadValue(KspSnapshot? s) =>
                s != null && s.Values.TryGetValue("value", out var v) ? v : null;

            public static KspSnapshot Snapshot(double value)
            {
                return new KspSnapshot { Values = new Dictionary<string, object?> { ["value"] = value } };
            }
        }

        private sealed class DelayFlagTestExtension : ISitrepExtension
        {
            public const string InfraCommand = "infra.ping";
            public const string VesselCommand = "vessel.ping";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-delay-flag",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = InfraCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommand, Delayed = true },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddCommandHandler<string, string>(InfraCommand, args => "pong:" + args);
                host.AddCommandHandler<string, string>(VesselCommand, args => "pong:" + args);
            }
        }

        /// <summary>
        /// Minimal <see cref="IVesselActuator"/> test double for
        /// <see cref="VesselCommandsDispatchWithTheirDeclaredDelayDispositionActuationDelayedPlanningImmediate"/> —
        /// records only what that test asserts on; every other member
        /// returns a bare success <see cref="Ack"/> (never touches KSP, and
        /// this project never references <c>Gonogo.KSP</c> at all).
        /// </summary>
        private sealed class RecordingVesselActuator : IVesselActuator
        {
            public bool? LastSetSasEnabled;
            public bool? LastSetAbortEnabled;
            public int ClearTargetCallCount;

            public Ack SetSas(bool enabled)
            {
                LastSetSasEnabled = enabled;
                return Ack.Ok();
            }

            public Ack SetSasMode(SasMode mode) => Ack.Ok();
            public Ack SetRcs(bool enabled) => Ack.Ok();
            public Ack SetGear(bool enabled) => Ack.Ok();
            public Ack SetBrakes(bool enabled) => Ack.Ok();
            public Ack SetLights(bool enabled) => Ack.Ok();

            public Ack SetAbort(bool enabled)
            {
                LastSetAbortEnabled = enabled;
                return Ack.Ok();
            }

            public Ack SetThrottle(double value) => Ack.Ok();
            public StageResult Stage() => new StageResult { Success = true, NewStage = 0 };
            public Ack SetActionGroup(int group, bool state) => Ack.Ok();
            public AddManeuverNodeResult AddManeuverNode(double ut, double prograde, double normal, double radialOut) =>
                new AddManeuverNodeResult { Success = true, NodeId = "node-1" };
            public Ack UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut) => Ack.Ok();
            public Ack RemoveManeuverNode(string nodeId) => Ack.Ok();
            public Ack SetTarget(TargetKind kind, string? vesselId, int? bodyIndex) => Ack.Ok();

            public Ack ClearTarget()
            {
                ClearTargetCallCount++;
                return Ack.Ok();
            }

            public Ack SetWarp(int index) => Ack.Ok();
            public Ack SetPause(bool paused) => Ack.Ok();
        }

        /// <summary>
        /// A KSP-free stand-in for <c>Gonogo.KSP.VesselExtension</c>'s
        /// COMMAND half only (no channels — this test only exercises
        /// command dispatch) — the exact same manifest declarations and the
        /// exact same <see cref="VesselCommandProvider"/> handler wiring
        /// production uses, so this test proves the real taxonomy, not a
        /// simplified restatement of it. See this file's own top-of-class
        /// doc comment for why <c>Sitrep.Host.IntegrationTests</c> can't
        /// reference <c>Gonogo.KSP</c> directly (net472 + KSP/Unity
        /// reference assemblies).
        /// </summary>
        private sealed class VesselCommandTestExtension : ISitrepExtension
        {
            private readonly IVesselActuator _actuator;

            public VesselCommandTestExtension(IVesselActuator actuator)
            {
                _actuator = actuator;
            }

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-vessel-commands",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = VesselCommandProvider.SetSasCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetSasModeCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetRcsCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetGearCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetBrakesCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetLightsCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetAbortCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetThrottleCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.StageCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.SetActionGroupCommand, Delayed = true },
                    new CommandDeclaration { Command = VesselCommandProvider.ManeuverAddCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommandProvider.ManeuverUpdateCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommandProvider.ManeuverRemoveCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommandProvider.TargetSetCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommandProvider.TargetClearCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommandProvider.SetWarpIndexCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommandProvider.SetPausedCommand, Delayed = false },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetSasCommand, args => VesselCommandProvider.HandleSetSas(_actuator, args));
                host.AddCommandHandler<SetSasModeArgs, Ack>(VesselCommandProvider.SetSasModeCommand, args => VesselCommandProvider.HandleSetSasMode(_actuator, args));
                host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetRcsCommand, args => VesselCommandProvider.HandleSetRcs(_actuator, args));
                host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetGearCommand, args => VesselCommandProvider.HandleSetGear(_actuator, args));
                host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetBrakesCommand, args => VesselCommandProvider.HandleSetBrakes(_actuator, args));
                host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetLightsCommand, args => VesselCommandProvider.HandleSetLights(_actuator, args));
                host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetAbortCommand, args => VesselCommandProvider.HandleSetAbort(_actuator, args));
                host.AddCommandHandler<SetThrottleArgs, Ack>(VesselCommandProvider.SetThrottleCommand, args => VesselCommandProvider.HandleSetThrottle(_actuator, args));
                host.AddCommandHandler<object?, StageResult>(VesselCommandProvider.StageCommand, args => VesselCommandProvider.HandleStage(_actuator, args));
                host.AddCommandHandler<SetActionGroupArgs, Ack>(VesselCommandProvider.SetActionGroupCommand, args => VesselCommandProvider.HandleSetActionGroup(_actuator, args));
                host.AddCommandHandler<AddManeuverNodeArgs, AddManeuverNodeResult>(VesselCommandProvider.ManeuverAddCommand, args => VesselCommandProvider.HandleManeuverAdd(_actuator, args));
                host.AddCommandHandler<UpdateManeuverNodeArgs, Ack>(VesselCommandProvider.ManeuverUpdateCommand, args => VesselCommandProvider.HandleManeuverUpdate(_actuator, args));
                host.AddCommandHandler<RemoveManeuverNodeArgs, Ack>(VesselCommandProvider.ManeuverRemoveCommand, args => VesselCommandProvider.HandleManeuverRemove(_actuator, args));
                host.AddCommandHandler<SetTargetArgs, Ack>(VesselCommandProvider.TargetSetCommand, args => VesselCommandProvider.HandleTargetSet(_actuator, args));
                host.AddCommandHandler<object?, Ack>(VesselCommandProvider.TargetClearCommand, args => VesselCommandProvider.HandleTargetClear(_actuator, args));
                host.AddCommandHandler<SetWarpIndexArgs, Ack>(VesselCommandProvider.SetWarpIndexCommand, args => VesselCommandProvider.HandleSetWarpIndex(_actuator, args));
                host.AddCommandHandler<SetPausedArgs, Ack>(VesselCommandProvider.SetPausedCommand, args => VesselCommandProvider.HandleSetPaused(_actuator, args));
            }
        }
    }
}
