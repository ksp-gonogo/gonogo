using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A kept namespace, the delivery part shapes use: each connection is sent a
    /// kept value once per subscription, from the source's own copy, whatever
    /// the timeline or the Courier's archive did in between.
    /// </summary>
    public class KeptNamespaceTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(400);

        private const string Topic = KeptTestUplink.Prefix + "fuelTank";

        private static KspSnapshot At(double ut) => new KspSnapshot { Ut = ut };

        private static async Task<List<StreamData<object?>>> CopiesAsync(WsTestHarness.TestClient client) =>
            (await DrainAllStreamDataAsync(client, Quiet)).Where(d => d.Topic == Topic).ToList();

        [Fact]
        public async Task ASecondConnectionGetsOneCopyAndTheFirstGetsNoneExtra()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new KeptTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var first = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(first, Topic, Timeout);
                uplink.KeepOnNextTick("fuelTank", "shape");
                engine.TickAndWait(1.0, At(1.0), Timeout);
                Assert.Single(await CopiesAsync(first));

                await using var second = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(second, Topic, Timeout);
                engine.TickAndWait(2.0, At(2.0), Timeout);
                engine.TickAndWait(3.0, At(3.0), Timeout);

                var copy = Assert.Single(await CopiesAsync(second));
                Assert.Equal("shape", copy.Payload?.ToString());
                Assert.Empty(await CopiesAsync(first));
                Assert.Equal(new[] { Topic, Topic }, uplink.Subscribed);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AfterAQuickloadEachSubscriberGetsOneCopyOnTheNewTimelineAndALateOneGetsItToo()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new KeptTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var watching = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(watching, Topic, Timeout);
                uplink.KeepOnNextTick("fuelTank", "shape");
                engine.TickAndWait(5.0, At(5.0), Timeout);
                Assert.Single(await CopiesAsync(watching));

                engine.TickAndWait(2.0, At(2.0), Timeout);

                var resent = Assert.Single(await CopiesAsync(watching));
                Assert.Equal(1, resent.Meta.TimelineEpoch);

                await using var late = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(late, Topic, Timeout);
                var copy = Assert.Single(await CopiesAsync(late));
                Assert.Equal(1, copy.Meta.TimelineEpoch);
                Assert.Equal("shape", copy.Payload?.ToString());
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AfterTheTopicIsTrimmedALateSubscriberStillGetsOneCopy()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new KeptTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var first = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(first, Topic, Timeout);
                uplink.KeepOnNextTick("fuelTank", "shape");
                engine.TickAndWait(1.0, At(1.0), Timeout);
                Assert.Single(await CopiesAsync(first));
                await first.SendAsync(EnvelopeCodec.WriteUnsubscribe(new Unsubscribe { Topic = Topic }));

                uplink.TrimOnNextTick(engine, Topic);
                engine.TickAndWait(500.0, At(500.0), Timeout);
                engine.TickAndWait(1000.0, At(1000.0), Timeout);

                await using var late = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(late, Topic, Timeout);
                Assert.Equal("shape", Assert.Single(await CopiesAsync(late)).Payload?.ToString());
                Assert.Empty(await CopiesAsync(first));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AKeptNamespaceRefusesAViewerFilterItWouldNeverApply()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                Assert.Throws<ArgumentException>(() => engine.RegisterKeptNamespace("filtered.", new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    ViewerFilter = (payload, _) => payload,
                }));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>A kept namespace whose values are kept, and whose topics are trimmed, on the Courier thread from a sampled source, as part shapes are.</summary>
        private sealed class KeptTestUplink : ISitrepUplink
        {
            public const string Prefix = "kepttest.";

            private IKeptChannelSource? _source;
            private readonly ConcurrentQueue<(string SubTopic, object Payload)> _toKeep = new ConcurrentQueue<(string, object)>();
            private readonly ConcurrentQueue<(ChannelEngine Engine, string Topic)> _toTrim = new ConcurrentQueue<(ChannelEngine, string)>();
            private readonly ConcurrentQueue<string> _subscribed = new ConcurrentQueue<string>();

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "kept-test", Version = "1.0.0" };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public string[] Subscribed => _subscribed.ToArray();

            public void KeepOnNextTick(string subTopic, object payload) => _toKeep.Enqueue((subTopic, payload));

            public void TrimOnNextTick(ChannelEngine engine, string topic) => _toTrim.Enqueue((engine, topic));

            public void Register(IUplinkHost host)
            {
                _source = ((ChannelEngine)host).RegisterKeptNamespace(Prefix, new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                });
                _source.OnSubscribed(topic => _subscribed.Enqueue(topic));
                host.AddSampledSource(_ => new object(), _ =>
                {
                    while (_toKeep.TryDequeue(out var keep))
                    {
                        _source.Keep(keep.SubTopic, keep.Payload);
                    }
                    while (_toTrim.TryDequeue(out var trim))
                    {
                        trim.Engine.TrimTopicForTests(trim.Topic);
                    }
                });
            }
        }
    }
}
