using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>system.uplink.pending</c>: the ground-side pending-uplink queue,
    /// populated from <c>ChannelEngine.ProcessDispatchCommand</c>'s delayed
    /// branch. An entry carries only dispatch-time facts and predictions (see
    /// <see cref="PendingUplink"/>'s doc comment). A command on the live path
    /// leaves when its reply lands at the centre, which is never sooner than
    /// light could carry it, or once it is late with the link down.
    /// </summary>
    public class UplinkPendingQueueTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task DelayedCommandDispatchIsEnqueuedThenLeavesTheQueueWhenItsReplyLands()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                const double signalDelay = 5.0;

                // Birth tick: establishes _signalDelaySeconds = 5 (read live at
                // dispatch time below) and fires the channel's first emission
                // (empty queue -- nothing dispatched yet).
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);

                var birthFrame = await ReceiveStreamDataAsync(client, Timeout);
                var birthPayload = Assert.IsType<Dictionary<string, object?>>(birthFrame.Payload);
                Assert.Empty(Assert.IsType<List<object?>>(birthPayload["pending"]));

                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op,
                    label: "run.");

                // A tick past the dispatch (but well short of the round trip)
                // re-runs the channel-source mapper with the new entry present.
                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay),
                    Timeout);

                var enqueuedFrame = await ReceiveStreamDataAsync(client, Timeout);
                var enqueuedPayload = Assert.IsType<Dictionary<string, object?>>(enqueuedFrame.Payload);
                var pending = Assert.IsType<List<object?>>(enqueuedPayload["pending"]);
                var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(pending));

                // NextRequestId() is only ever called from the delayed-dispatch
                // path ("c" + an Interlocked.Increment starting at 0) -- this is
                // the first (and only) delayed dispatch on a freshly constructed
                // engine, so "c1" is deterministic, not a guess.
                Assert.Equal("c1", entry["id"]);
                Assert.Equal(PendingQueueTestUplink.Command, entry["command"]);
                Assert.Equal("run.", entry["label"]);
                Assert.Equal("KSC", entry["vantage"]);
                Assert.Equal(0.0, entry["dispatchedAt"]);
                Assert.Equal(signalDelay, entry["oneWaySeconds"]);

                // The reply lands at the centre on the round trip (2 * 5s = 10s), in
                // the clock advance after the tick at 11 s has listed the queue, so
                // the next tick lists it gone.
                engine.TickAndWait(
                    11.0,
                    FreezeGateTestUplink.Snapshot(11.0, connected: true, delay: signalDelay),
                    Timeout);
                engine.TickAndWait(
                    12.0,
                    FreezeGateTestUplink.Snapshot(12.0, connected: true, delay: signalDelay),
                    Timeout);

                var prunedFrame = await ReceiveStreamDataAsync(client, Timeout);
                var prunedPayload = Assert.IsType<Dictionary<string, object?>>(prunedFrame.Payload);
                Assert.Empty(Assert.IsType<List<object?>>(prunedPayload["pending"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Switching signal delay off while commands are on their way delivers
        /// every one of them at once, in the order sent, confirms each at that
        /// moment rather than at its old predicted time, and takes them off the
        /// pending list. A command sent after the switch arrives at once too.
        /// </summary>
        [Fact]
        public async Task SwitchingDelayOffDeliversEveryCommandOnItsWayAtOnceInTheOrderSent()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                var confirmedAt = new Dictionary<string, double>();
                var now = 0.0;
                void Send(string name) => engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command, name, "KSC", _ => confirmedAt[name] = now, TestBudgets.Op, label: "run.", clientRequestId: name);

                engine.TickAndWait(now, FreezeGateTestUplink.Snapshot(now, connected: true, delay: 5.0), Timeout);
                Send("first");
                now = 1.0;
                engine.TickAndWait(now, FreezeGateTestUplink.Snapshot(now, connected: true, delay: 5.0), Timeout);
                Send("second");
                now = 2.0;
                engine.TickAndWait(now, FreezeGateTestUplink.Snapshot(now, connected: true, delay: 5.0), Timeout);
                Assert.Empty(uplink.RanInOrder);

                // The switch goes off; the next reading carries no delay.
                using var off = engine.DelayModifiers.Register(0.0, "test: switched off");
                now = 3.0;
                engine.TickAndWait(now, FreezeGateTestUplink.Snapshot(now, connected: true, delay: 0.0), Timeout);

                Assert.Equal(new[] { "first", "second" }, uplink.RanInOrder);
                Assert.Equal(3.0, confirmedAt["first"]);
                Assert.Equal(3.0, confirmedAt["second"]);

                Send("third");
                now = 4.0;
                engine.TickAndWait(now, FreezeGateTestUplink.Snapshot(now, connected: true, delay: 0.0), Timeout);
                Assert.Equal(new[] { "first", "second", "third" }, uplink.RanInOrder);

                var (_, ids) = await DrainResetsAndPendingAsync(client);
                Assert.Empty(ids);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Switching signal delay on delays only what is sent after the switch.
        /// </summary>
        [Fact]
        public void SwitchingDelayOnDelaysOnlyCommandsSentAfterTheSwitch()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            using var off = engine.DelayModifiers.Register(0.0, "test: switched off");
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0), Timeout);
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "before", "KSC", _ => { }, TestBudgets.Op, label: "run.");
                engine.TickAndWait(0.5, FreezeGateTestUplink.Snapshot(0.5, connected: true, delay: 0.0), Timeout);
                Assert.Equal(new[] { "before" }, uplink.RanInOrder);

                off.Dispose();
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: 5.0), Timeout);
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "after", "KSC", _ => { }, TestBudgets.Op, label: "run.");
                engine.TickAndWait(3.0, FreezeGateTestUplink.Snapshot(3.0, connected: true, delay: 5.0), Timeout);
                Assert.Equal(new[] { "before" }, uplink.RanInOrder);

                engine.TickAndWait(7.0, FreezeGateTestUplink.Snapshot(7.0, connected: true, delay: 5.0), Timeout);
                Assert.Equal(new[] { "before", "after" }, uplink.RanInOrder);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Raising the light speed shortens the delay: what is on its way has
        /// the same share of its journey left but over the shorter delay, so it
        /// arrives sooner, and a command sent after still arrives after one sent
        /// before.
        /// </summary>
        [Fact]
        public void RaisingLightSpeedBringsCommandsOnTheirWayForwardAndKeepsTheirOrder()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 10.0), Timeout);
                // Leaves at 0 for an arrival at 10.
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "slow", "KSC", _ => { }, TestBudgets.Op, label: "run.");

                // At 4 the light speed doubles: 6 seconds left become 3, so arrival moves to 7.
                using var faster = engine.DelayModifiers.Register(0.5, "test: light speed doubled");
                engine.TickAndWait(4.0, FreezeGateTestUplink.Snapshot(4.0, connected: true, delay: 5.0), Timeout);
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "fast", "KSC", _ => { }, TestBudgets.Op, label: "run.");

                engine.TickAndWait(6.0, FreezeGateTestUplink.Snapshot(6.0, connected: true, delay: 5.0), Timeout);
                Assert.Empty(uplink.RanInOrder);

                engine.TickAndWait(8.0, FreezeGateTestUplink.Snapshot(8.0, connected: true, delay: 5.0), Timeout);
                Assert.Equal(new[] { "slow" }, uplink.RanInOrder);

                engine.TickAndWait(10.0, FreezeGateTestUplink.Snapshot(10.0, connected: true, delay: 5.0), Timeout);
                Assert.Equal(new[] { "slow", "fast" }, uplink.RanInOrder);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Lowering the light speed lengthens the delay, which changes nothing
        /// already sent: the command on its way keeps its arrival.
        /// </summary>
        [Fact]
        public void LoweringLightSpeedLeavesCommandsOnTheirWayAsTheyWere()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 5.0), Timeout);
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "sent before", "KSC", _ => { }, TestBudgets.Op, label: "run.");

                using var slower = engine.DelayModifiers.Register(2.0, "test: light speed halved");
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: 10.0), Timeout);
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "sent after", "KSC", _ => { }, TestBudgets.Op, label: "run.");

                engine.TickAndWait(6.0, FreezeGateTestUplink.Snapshot(6.0, connected: true, delay: 10.0), Timeout);
                Assert.Equal(new[] { "sent before" }, uplink.RanInOrder);

                engine.TickAndWait(12.0, FreezeGateTestUplink.Snapshot(12.0, connected: true, delay: 10.0), Timeout);
                Assert.Equal(new[] { "sent before", "sent after" }, uplink.RanInOrder);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ZeroDelayCommandDispatchIsNeverEnqueued()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                // No "delay" key at all -- _signalDelaySeconds stays at its
                // default 0, so ProcessDispatchCommand's uplinkDelay is null
                // ("no live delay authority"), which the pending-queue invariant
                // treats the same as an explicit delay:0 -- neither enqueues.
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true),
                    Timeout);

                var birthFrame = await ReceiveStreamDataAsync(client, Timeout);
                var birthPayload = Assert.IsType<Dictionary<string, object?>>(birthFrame.Payload);
                Assert.Empty(Assert.IsType<List<object?>>(birthPayload["pending"]));

                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op,
                    label: "run.");

                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true),
                    Timeout);

                // The queue is still empty, so there is nothing new to send: the engine's own copy is the answer, not a repeat frame.
                Assert.Empty(Assert.IsType<PendingUplinkQueue>(engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ADelayedDispatchCarriesTheClientsOwnRequestIdApartFromTheEnginesId()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                const double signalDelay = 5.0;
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay), Timeout);
                await ReceiveStreamDataAsync(client, Timeout);

                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op,
                    clientRequestId: "c7");

                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay), Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(frame.Payload);
                var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(Assert.IsType<List<object?>>(payload["pending"])));

                Assert.Equal("c1", entry["id"]);
                Assert.Equal("c7", entry["clientRequestId"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task DelayedCommandDispatchCarriesTopicOntoTheQueueEntry()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                const double signalDelay = 5.0;

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);

                var birthFrame = await ReceiveStreamDataAsync(client, Timeout);
                var birthPayload = Assert.IsType<Dictionary<string, object?>>(birthFrame.Payload);
                Assert.Empty(Assert.IsType<List<object?>>(birthPayload["pending"]));

                // Topic threads the same way Label already does (see the
                // sibling test above) -- dispatch-time addressing carried
                // verbatim onto the PendingUplink entry, never inspected by
                // the engine.
                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op,
                    label: "run.",
                    topic: "kos/7");

                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay),
                    Timeout);

                var enqueuedFrame = await ReceiveStreamDataAsync(client, Timeout);
                var enqueuedPayload = Assert.IsType<Dictionary<string, object?>>(enqueuedFrame.Payload);
                var pending = Assert.IsType<List<object?>>(enqueuedPayload["pending"]);
                var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(pending));

                Assert.Equal("c1", entry["id"]);
                Assert.Equal("run.", entry["label"]);
                Assert.Equal("kos/7", entry["topic"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A control-channel write carries the scalar it asked for onto the
        /// queue entry. Without it a renderer can say a SAS command is in
        /// flight and not which mode, which is the difference between an
        /// expectation it can draw and a spinner.
        ///
        /// <para>Still a dispatch-time fact: the engine reads the args it was
        /// handed and never the craft. It is also the only path a second command
        /// centre or a station screen has to the value, since own-dispatch
        /// memory is per-client by construction.</para>
        /// </summary>
        [Fact]
        public async Task DelayedControlChannelDispatchCarriesTheCommandedValue()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                const double signalDelay = 5.0;
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);
                await ReceiveStreamDataAsync(client, Timeout);

                // vessel.control.setThrottle is a declared control channel whose
                // value field is SetThrottleArgs.Value, so the args key is
                // "value". The args bag is what the envelope decoder produces.
                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.ThrottleCommand,
                    new Dictionary<string, object> { ["value"] = 0.65 },
                    "KSC",
                    _ => { },
                    TestBudgets.Op);

                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay),
                    Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(frame.Payload);
                var pending = Assert.IsType<List<object?>>(payload["pending"]);
                var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(pending));

                Assert.Equal("vessel.control.setThrottle", entry["command"]);
                Assert.Equal(0.65, Assert.IsType<double>(entry["commandedValue"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A switch dispatches as 1 or 0, which is what it already is on the
        /// wire: the channel's own declared args type says how to read it back,
        /// so one numeric field describes every channel without a variant.
        /// </summary>
        [Fact]
        public async Task ADiscreteControlChannelDispatchCarriesItsSwitchAsAScalar()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                const double signalDelay = 5.0;
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);
                await ReceiveStreamDataAsync(client, Timeout);

                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.GearCommand,
                    new Dictionary<string, object> { ["enabled"] = true },
                    "KSC",
                    _ => { },
                    TestBudgets.Op);

                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay),
                    Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(frame.Payload);
                var pending = Assert.IsType<List<object?>>(payload["pending"]);
                var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(pending));

                Assert.Equal(1.0, Assert.IsType<double>(entry["commandedValue"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A command that is not a declared control channel carries no value,
        /// and the field is omitted rather than sent as a zero: a zero throttle
        /// and an unknown value must never render the same.
        /// </summary>
        [Fact]
        public async Task ANonChannelCommandCarriesNoCommandedValue()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                const double signalDelay = 5.0;
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);
                await ReceiveStreamDataAsync(client, Timeout);

                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op);

                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay),
                    Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(frame.Payload);
                var pending = Assert.IsType<List<object?>>(payload["pending"]);
                var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(pending));

                Assert.False(entry.ContainsKey("commandedValue"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task DelayedCommandDispatchWithNoTopicStillEnqueues()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                const double signalDelay = 5.0;

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);

                var birthFrame = await ReceiveStreamDataAsync(client, Timeout);
                var birthPayload = Assert.IsType<Dictionary<string, object?>>(birthFrame.Payload);
                Assert.Empty(Assert.IsType<List<object?>>(birthPayload["pending"]));

                // No topic passed at all -- Topic is purely carried metadata,
                // never a gate on whether the dispatch enqueues (that's the
                // uplinkDelay/comms-loss gates above it in
                // ProcessDispatchCommand, unrelated to topic).
                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op,
                    label: "run.");

                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay),
                    Timeout);

                var enqueuedFrame = await ReceiveStreamDataAsync(client, Timeout);
                var enqueuedPayload = Assert.IsType<Dictionary<string, object?>>(enqueuedFrame.Payload);
                var pending = Assert.IsType<List<object?>>(enqueuedPayload["pending"]);
                var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(pending));

                Assert.Equal("c1", entry["id"]);
                Assert.Equal("", entry["topic"]);
            }
            finally
            {
                engine.Stop();
            }
        }


        /// <summary>
        /// The engine tells the dispatching client the flight time it actually
        /// scheduled, so a loss deadline is sized from the route the command
        /// took rather than from the only delay a client can see.
        ///
        /// <para>The pending queue cannot carry this: its <c>Id</c> is
        /// engine-minted precisely because two clients can choose the same
        /// request id, so nothing there pairs an entry with the caller that
        /// caused it. The acceptance callback is per-dispatch and therefore
        /// can.</para>
        /// </summary>
        [Fact]
        public async Task ADelayedDispatchReportsItsOwnFlightTimeToTheCaller()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                const double signalDelay = 5.0;
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);

                var accepted = new List<double>();
                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op,
                    onAccepted: seconds => accepted.Add(seconds!.Value));

                Assert.Equal(new[] { signalDelay }, accepted);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A dispatch with no signal delay to wait out reports nothing. Silence
        /// here is the ordinary answer for an instant command, not a failure,
        /// and a client must not read it as one.
        /// </summary>
        [Fact]
        public async Task AZeroDelayDispatchReportsNoFlightTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0),
                    Timeout);

                var accepted = new List<double>();
                engine.DispatchCommandAndWait(
                    PendingQueueTestUplink.Command,
                    "x",
                    "KSC",
                    _ => { },
                    TestBudgets.Op,
                    onAccepted: seconds => accepted.Add(seconds!.Value));

                Assert.Empty(accepted);
            }
            finally
            {
                engine.Stop();
            }
        }
        /// <summary>
        /// The pending list is TrueNow, so a centre that saw another centre's
        /// entries would know what it had just sent before light could carry it.
        /// Each session is sent the entries dispatched at its own vantage, plus
        /// any it dispatched itself under another.
        /// </summary>
        [Fact]
        public async Task EachSessionIsSentOnlyItsOwnVantagesPendingEntriesAndItsOwnOverrides()
        {
            const double signalDelay = 5.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new StaticSource("ground:gs1"));
            engine.RegisterCommandCentreSource(new StaticSource("ground:gs2"));
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay), Timeout);

                await using var atGs1 = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var atGs2 = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await atGs1.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                await atGs2.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs2" }));
                await SubscribeAsync(atGs1, ChannelEngine.UplinkPendingTopic, Timeout);
                await SubscribeAsync(atGs2, ChannelEngine.UplinkPendingTopic, Timeout);

                await SendCommandAsync(atGs1, "gs1-own", vantage: "");
                await SendCommandAsync(atGs2, "gs2-own", vantage: "");
                await SendCommandAsync(atGs1, "gs1-as-gs2", vantage: "ground:gs2");

                // The requests reach the engine from the socket on their own
                // thread, so the tick that lists them is the one after they are
                // accepted.
                await ReceiveTypedAsync<CommandAccepted>(atGs1, Timeout);
                await ReceiveTypedAsync<CommandAccepted>(atGs1, Timeout);
                await ReceiveTypedAsync<CommandAccepted>(atGs2, Timeout);
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay), Timeout);

                Assert.Equal(new[] { "gs1-as-gs2", "gs1-own" }, await LatestPendingRequestIdsAsync(atGs1));
                Assert.Equal(new[] { "gs1-as-gs2", "gs2-own" }, await LatestPendingRequestIdsAsync(atGs2));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A queued command the game refuses is listed under <c>settled</c> for
        /// every connection at its command centre once its reply is home, with
        /// the refusal's code and the game's words, so a screen that did not
        /// send it can say what became of it.
        /// </summary>
        [Fact]
        public async Task ARefusedCommandIsSettledForEveryScreenAtItsCentre()
        {
            const double signalDelay = 5.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new StaticSource("ground:gs1"));
            engine.RegisterCommandCentreSource(new StaticSource("ground:gs2"));
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay), Timeout);

                await using var sender = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var watcher = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var elsewhere = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await sender.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                await watcher.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                await elsewhere.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs2" }));
                await SubscribeAsync(watcher, ChannelEngine.UplinkPendingTopic, Timeout);
                await SubscribeAsync(elsewhere, ChannelEngine.UplinkPendingTopic, Timeout);

                await sender.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    RequestId = "rcs-1",
                    Command = PendingQueueTestUplink.RefusedCommand,
                    Args = "x",
                    Label = "Toggle RCS",
                }));
                await ReceiveTypedAsync<CommandAccepted>(sender, Timeout);
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay), Timeout);
                // At the craft and refused there, but the reply is still on its way home: nobody at the centre can know yet.
                engine.TickAndWait(9.5, FreezeGateTestUplink.Snapshot(9.5, connected: true, delay: signalDelay), Timeout);
                Assert.Empty(await LatestSettledAsync(watcher));
                engine.TickAndWait(11.0, FreezeGateTestUplink.Snapshot(11.0, connected: true, delay: signalDelay), Timeout);
                engine.TickAndWait(12.0, FreezeGateTestUplink.Snapshot(12.0, connected: true, delay: signalDelay), Timeout);

                var settled = Assert.Single(await LatestSettledAsync(watcher));
                Assert.Equal("rcs-1", settled.GetProperty("clientRequestId").GetString());
                Assert.Equal(PendingQueueTestUplink.RefusedCommand, settled.GetProperty("command").GetString());
                Assert.Equal("Toggle RCS", settled.GetProperty("label").GetString());
                Assert.Equal("ground:gs1", settled.GetProperty("vantage").GetString());
                Assert.Equal("refused", settled.GetProperty("outcome").GetString());
                Assert.Equal("modeUnavailable", settled.GetProperty("code").GetString());
                Assert.Equal("No RCS thrusters aboard", settled.GetProperty("detail").GetString());
                Assert.Equal(System.Text.Json.JsonValueKind.Null, settled.GetProperty("message").ValueKind);

                Assert.Empty(await LatestSettledAsync(elsewhere));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A live-path command whose reply has not landed by its predicted time
        /// stays on the queue past it, marked overdue, rather than leaving on the
        /// prediction. When its reply does land it leaves, listed as answered for
        /// every screen at the centre. One long tick that jumps past the reply
        /// time is how a live reply comes in late.
        /// </summary>
        [Fact]
        public async Task ALiveCommandWhoseReplyIsLateStaysOnTheQueueUntilItLandsAndIsListedAnswered()
        {
            const double signalDelay = 5.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new StaticSource("ground:gs1"));
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay), Timeout);

                await using var sender = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var watcher = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await sender.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                await watcher.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                await SubscribeAsync(watcher, ChannelEngine.UplinkPendingTopic, Timeout);
                await SendCommandAsync(sender, "late-1", vantage: "");
                await ReceiveTypedAsync<CommandAccepted>(sender, Timeout);
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay), Timeout);

                // Predicted home at 10 s; the centre is at 20 s before the reply has been carried in.
                engine.TickAndWait(20.0, FreezeGateTestUplink.Snapshot(20.0, connected: true, delay: signalDelay), Timeout);
                var (pending, settled) = await LatestQueueAsync(watcher);
                var entry = Assert.Single(pending);
                Assert.Equal("late-1", entry.GetProperty("clientRequestId").GetString());
                Assert.Equal(20.0, entry.GetProperty("replyOverdueUt").GetDouble());
                Assert.Empty(settled);

                engine.TickAndWait(21.0, FreezeGateTestUplink.Snapshot(21.0, connected: true, delay: signalDelay), Timeout);
                (pending, settled) = await LatestQueueAsync(watcher);
                Assert.Empty(pending);
                var answered = Assert.Single(settled);
                Assert.Equal("late-1", answered.GetProperty("clientRequestId").GetString());
                Assert.Equal("answered", answered.GetProperty("outcome").GetString());
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A live-path command that is late with the link to the craft down, so no
        /// reply can come, leaves the queue then and is listed as nothing.
        /// </summary>
        [Fact]
        public async Task ALiveCommandLateWithTheLinkDownLeavesTheQueue()
        {
            const double signalDelay = 5.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new StaticSource("ground:gs1"));
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay), Timeout);
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "x", "ground:gs1", _ => { }, TestBudgets.Op, clientRequestId: "down-1");
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay), Timeout);
                Assert.Single(Queue(engine).Pending);

                engine.TickAndWait(5.0, FreezeGateTestUplink.Snapshot(5.0, connected: false, delay: signalDelay), Timeout);
                Assert.Single(Queue(engine).Pending);
                engine.TickAndWait(14.0, FreezeGateTestUplink.Snapshot(14.0, connected: false, delay: signalDelay), Timeout);
                Assert.Empty(Queue(engine).Pending);
                Assert.Empty(Queue(engine).Settled);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static PendingUplinkQueue Queue(ChannelEngine engine) =>
            Assert.IsType<PendingUplinkQueue>(engine.PayloadOf(ChannelEngine.UplinkPendingTopic));

        /// <summary>The <c>pending</c> and <c>settled</c> entries on the last pending frame to arrive.</summary>
        private static async Task<(List<System.Text.Json.JsonElement> Pending, List<System.Text.Json.JsonElement> Settled)> LatestQueueAsync(TestClient client)
        {
            var pending = new List<System.Text.Json.JsonElement>();
            var settled = new List<System.Text.Json.JsonElement>();
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(TestBudgets.Quiet);
                }
                catch (OperationCanceledException)
                {
                    return (pending, settled);
                }
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData data && data.Topic == ChannelEngine.UplinkPendingTopic)
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(raw);
                    var payload = doc.RootElement.GetProperty("payload");
                    pending = payload.GetProperty("pending").EnumerateArray().Select(e => e.Clone()).ToList();
                    settled = payload.GetProperty("settled").EnumerateArray().Select(e => e.Clone()).ToList();
                }
            }
        }

        /// <summary>The <c>settled</c> entries on the last pending frame to arrive.</summary>
        private static async Task<List<System.Text.Json.JsonElement>> LatestSettledAsync(TestClient client)
        {
            var settled = new List<System.Text.Json.JsonElement>();
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(TestBudgets.Quiet);
                }
                catch (OperationCanceledException)
                {
                    return settled;
                }
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData data && data.Topic == ChannelEngine.UplinkPendingTopic)
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(raw);
                    settled = new List<System.Text.Json.JsonElement>();
                    foreach (var entry in doc.RootElement.GetProperty("payload").GetProperty("settled").EnumerateArray())
                    {
                        settled.Add(entry.Clone());
                    }
                }
            }
        }

        /// <summary>
        /// Loading another save is a new timeline even when its UT is later, so
        /// nothing dispatched in the old game is still shown as on its way.
        /// </summary>
        [Fact]
        public async Task ATickUnderADifferentSaveResetsTheTimelineAndEmptiesThePendingList()
        {
            const double signalDelay = 5.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new PendingQueueTestUplink());
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                engine.NoteSave("career-a");
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay), Timeout);
                engine.DispatchCommandAndWait(PendingQueueTestUplink.Command, "x", "KSC", _ => { }, Timeout);
                engine.TickAndWait(1.0, FreezeGateTestUplink.Snapshot(1.0, connected: true, delay: signalDelay), Timeout);
                var (sameSaveResets, beforeIds) = await DrainResetsAndPendingAsync(client);
                Assert.Equal(0, sameSaveResets);
                Assert.Single(beforeIds);

                engine.NoteSave("career-b");
                engine.TickAndWait(2.0, FreezeGateTestUplink.Snapshot(2.0, connected: true, delay: signalDelay), Timeout);
                engine.TickAndWait(3.0, FreezeGateTestUplink.Snapshot(3.0, connected: true, delay: signalDelay), Timeout);
                var (resets, afterIds) = await DrainResetsAndPendingAsync(client);
                Assert.Equal(1, resets);
                Assert.Empty(afterIds);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static Task SendCommandAsync(TestClient client, string requestId, string vantage) =>
            client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                RequestId = requestId,
                Command = PendingQueueTestUplink.Command,
                Args = "x",
                Vantage = vantage,
            }));

        /// <summary>The client request ids on the last pending frame to arrive, sorted.</summary>
        private static async Task<string[]> LatestPendingRequestIdsAsync(TestClient client)
        {
            var (_, ids) = await DrainResetsAndPendingAsync(client);
            return ids;
        }

        /// <summary>How many timeline resets arrived, and the sorted client request ids on the last pending frame.</summary>
        private static async Task<(int Resets, string[] Ids)> DrainResetsAndPendingAsync(TestClient client)
        {
            var resets = 0;
            var ids = Array.Empty<string>();
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(TestBudgets.Quiet);
                }
                catch (OperationCanceledException)
                {
                    return (resets, ids);
                }
                switch (EnvelopeCodec.ParseServerMessage(raw))
                {
                    case EventMsg ev when ev.Name == "timeline-reset" && ev.Topic == ChannelEngine.UplinkPendingTopic:
                        resets++;
                        break;
                    case StreamData data when data.Topic == ChannelEngine.UplinkPendingTopic:
                        using (var doc = System.Text.Json.JsonDocument.Parse(raw))
                        {
                            var found = new List<string>();
                            foreach (var entry in doc.RootElement.GetProperty("payload").GetProperty("pending").EnumerateArray())
                            {
                                found.Add(entry.GetProperty("clientRequestId").GetString() ?? "");
                            }
                            found.Sort(StringComparer.Ordinal);
                            ids = found.ToArray();
                        }
                        break;
                }
            }
        }

        private sealed class StaticSource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;

            public StaticSource(string id) => _centre = new Centre(id);

            public string ProviderId => "static-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return _centre;
            }

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }

        private sealed class PendingQueueTestUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public const string Command = "pending-queue-test.dispatch";

            /// <summary>
            /// Two real declared control-channel commands, handled here so a
            /// dispatch of one actually enqueues: ProcessDispatchCommand only
            /// enqueues a command some uplink handles. Their names are what
            /// matter, since the commanded-value lookup is keyed on the command
            /// and reflected off the contract's own [SitrepControlChannel]
            /// declarations, not off anything this double says.
            /// </summary>
            public const string ThrottleCommand = "vessel.control.setThrottle";
            public const string GearCommand = "vessel.control.setGear";

            /// <summary>A command the game always refuses, with its own words.</summary>
            public const string RefusedCommand = "pending-queue-test.refuse";

            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            private readonly List<string> _order = new List<string>();

            /// <summary>The arguments of the dispatched commands, in the order the uplink ran them.</summary>
            public string[] RanInOrder
            {
                get
                {
                    lock (_order)
                    {
                        return _order.ToArray();
                    }
                }
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "pending-queue-test",
                Version = "1.0.0",
                // Declared so every command below has a real Subject to
                // resolve: this uplink registers alone, so vessel.control has
                // to be its own declaration, matching Gonogo.KSP.VesselUplink's
                // real pairing of these two commands with that channel.
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    { Kind = SampleKind.Continuous,
                        Topic = VesselViewProvider.ControlTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = VesselViewProvider.ControlTopic },
                    new CommandDeclaration { Command = ThrottleCommand, Delay = DelayRole.Delayed, Subject = VesselViewProvider.ControlTopic },
                    new CommandDeclaration { Command = GearCommand, Delay = DelayRole.Delayed, Subject = VesselViewProvider.ControlTopic },
                    new CommandDeclaration { Command = RefusedCommand, Delay = DelayRole.Delayed, Subject = VesselViewProvider.ControlTopic },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    lock (_order)
                    {
                        _order.Add(args);
                    }
                    return "pong:" + args;
                });
                host.AddCommandHandler<Dictionary<string, object>, string>(
                    ThrottleCommand,
                    _ => "ok");
                host.AddCommandHandler<Dictionary<string, object>, string>(
                    GearCommand,
                    _ => "ok");
                host.AddCommandHandler<string, CommandResult>(
                    RefusedCommand,
                    _ => CommandResult.Fail(CommandErrorCode.ModeUnavailable, "No RCS thrusters aboard"));
                host.SetConnectivitySource(ComputeConnected);
                host.SetSignalDelaySource(ComputeDelay);
            }

            private static bool? ComputeConnected(KspSnapshot? snapshot)
            {
                if (snapshot == null
                    || !snapshot.Values.TryGetValue("connected", out var value)
                    || value == null)
                {
                    return null;
                }
                return Convert.ToBoolean(value);
            }

            private static CommsDelay? ComputeDelay(KspSnapshot? snapshot)
            {
                if (snapshot == null
                    || !snapshot.Values.TryGetValue("delay", out var value)
                    || value == null)
                {
                    return null;
                }
                return new CommsDelay
                {
                    OneWaySeconds = Convert.ToDouble(value),
                    Source = CommsDelaySource.SignalDelay,
                };
            }
        }
    }
}
