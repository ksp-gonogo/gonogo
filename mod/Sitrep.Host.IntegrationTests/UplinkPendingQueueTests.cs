using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>system.uplink.pending</c>: the ground-side pending-uplink queue,
    /// populated from <c>ChannelEngine.ProcessDispatchCommand</c>'s delayed
    /// branch and pruned on Tick. Prediction-only, hard invariant (see
    /// <see cref="PendingUplink"/>'s doc comment): an entry carries only
    /// dispatch-time facts and ages out on the PREDICTED round trip
    /// (<c>DispatchedAt + 2*OneWaySeconds</c>), never on real completion,
    /// this suite never asserts on <c>uplink.HandledCount</c> or any other
    /// execution-side signal, only on the queue's own delivered shape.
    /// </summary>
    public class UplinkPendingQueueTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public async Task DelayedCommandDispatchIsEnqueuedThenPrunedAfterThePredictedRoundTrip()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
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
                    TimeSpan.FromMilliseconds(300),
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

                // Tick past the PREDICTED round trip (2 * 5s = 10s) -- the entry
                // must age out on the prediction, regardless of whether the
                // command actually reached/ran on the craft.
                engine.TickAndWait(
                    11.0,
                    FreezeGateTestUplink.Snapshot(11.0, connected: true, delay: signalDelay),
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

        [Fact]
        public async Task ZeroDelayCommandDispatchIsNeverEnqueued()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkPendingTopic, Timeout);

                // No "delay" key at all -- _signalDelaySeconds stays at its
                // default 0, so ProcessDispatchCommand's uplinkDelay is null
                // ("no live delay authority"), which the brief's invariant
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
                    TimeSpan.FromMilliseconds(300),
                    label: "run.");

                engine.TickAndWait(
                    1.0,
                    FreezeGateTestUplink.Snapshot(1.0, connected: true),
                    Timeout);

                var afterDispatchFrame = await ReceiveStreamDataAsync(client, Timeout);
                var afterDispatchPayload = Assert.IsType<Dictionary<string, object?>>(afterDispatchFrame.Payload);
                Assert.Empty(Assert.IsType<List<object?>>(afterDispatchPayload["pending"]));
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
                    TimeSpan.FromMilliseconds(300),
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
        /// handed and never the craft. It is also the only path a SECOND command
        /// centre or a station screen has to the value, since own-dispatch
        /// memory is per-client by construction.</para>
        /// </summary>
        [Fact]
        public async Task DelayedControlChannelDispatchCarriesTheCommandedValue()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new PendingQueueTestUplink();
            engine.RegisterUplink(uplink);
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
                    TimeSpan.FromMilliseconds(300));

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
                    TimeSpan.FromMilliseconds(300));

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
                    TimeSpan.FromMilliseconds(300));

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
                    TimeSpan.FromMilliseconds(300),
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

        private sealed class PendingQueueTestUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public const string Command = "pending-queue-test.dispatch";

            /// <summary>
            /// Two real declared control-channel commands, handled here so a
            /// dispatch of one actually enqueues: ProcessDispatchCommand only
            /// enqueues a command some uplink handles. Their NAMES are what
            /// matter, since the commanded-value lookup is keyed on the command
            /// and reflected off the contract's own [SitrepControlChannel]
            /// declarations, not off anything this double says.
            /// </summary>
            public const string ThrottleCommand = "vessel.control.setThrottle";
            public const string GearCommand = "vessel.control.setGear";

            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "pending-queue-test",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delayed = true },
                    new CommandDeclaration { Command = ThrottleCommand, Delayed = true },
                    new CommandDeclaration { Command = GearCommand, Delayed = true },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "pong:" + args;
                });
                host.AddCommandHandler<Dictionary<string, object>, string>(
                    ThrottleCommand,
                    _ => "ok");
                host.AddCommandHandler<Dictionary<string, object>, string>(
                    GearCommand,
                    _ => "ok");
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
