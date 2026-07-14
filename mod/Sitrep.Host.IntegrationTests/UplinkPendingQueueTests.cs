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
    /// <c>system.uplink.pending</c> — the ground-side pending-uplink queue,
    /// populated from <c>ChannelEngine.ProcessDispatchCommand</c>'s delayed
    /// branch and pruned on Tick. Prediction-only, hard invariant (see
    /// <see cref="PendingUplink"/>'s doc comment): an entry carries only
    /// dispatch-time facts and ages out on the PREDICTED round trip
    /// (<c>DispatchedAt + 2*OneWaySeconds</c>), never on real completion —
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
            public const string Command = "pending-queue-test.dispatch";
            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "pending-queue-test",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delayed = true },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "pong:" + args;
                });
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
