using System;
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
    /// What a subscriber receives on a topic after a timeline reset. A load drops
    /// the clock while the game is still building its scene, so a reading taken
    /// then describes nothing, and what the archive retained was written before
    /// the load.
    /// </summary>
    public class FirstFrameAfterLoadTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        [Fact]
        public async Task ASampledChannelsFirstFrameAfterALoadIsReadFromTheLoadedWorld()
        {
            using var engine = NewEngine(out _);
            try
            {
                await using var client = await Subscribed(engine, LoadWorldUplink.Sampled);
                await PlayUntilTheLoad(engine, client);

                engine.SetGameState(GamePhase.Loading, "FLIGHT");
                Tick(engine, 2.0, value: null);
                Tick(engine, 2.1, value: null);
                Assert.Empty(await DrainAllStreamDataAsync(client, Quiet));

                engine.SetGameState(GamePhase.Ready, "FLIGHT");
                Tick(engine, 2.2, value: "saved");

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var frame = Assert.Single(frames);
                Assert.Equal("saved", frame.Payload);
                Assert.Equal(1, frame.Meta.TimelineEpoch);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASampledChannelsRealNullStillGoesOutOnceTheWorldStands()
        {
            using var engine = NewEngine(out _);
            try
            {
                await using var client = await Subscribed(engine, LoadWorldUplink.Sampled);
                await PlayUntilTheLoad(engine, client);

                engine.SetGameState(GamePhase.Loading, "FLIGHT");
                Tick(engine, 2.0, value: null);
                engine.SetGameState(GamePhase.Ready, "FLIGHT");
                Tick(engine, 2.2, value: null);

                var frame = Assert.Single(await DrainAllStreamDataAsync(client, Quiet));
                Assert.Null(frame.Payload);
                Assert.Equal(1, frame.Meta.TimelineEpoch);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AQuietPushedChannelGetsItsSurvivingValueOnlyOnceTheWorldStands()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                await using var client = await Subscribed(engine, LoadWorldUplink.Pushed);
                uplink.Push("survivor", 1.0);
                await PlayUntilTheLoad(engine, client);

                engine.SetGameState(GamePhase.Loading, "FLIGHT");
                Tick(engine, 2.0, value: null);
                Tick(engine, 2.1, value: null);
                Assert.Empty(await DrainAllStreamDataAsync(client, Quiet));

                engine.SetGameState(GamePhase.Ready, "FLIGHT");
                Tick(engine, 2.2, value: "saved");
                Tick(engine, 2.3, value: "saved");

                var frame = Assert.Single(await DrainAllStreamDataAsync(client, Quiet));
                Assert.Equal("survivor", frame.Payload);
                Assert.Equal(1, frame.Meta.TimelineEpoch);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task APushedChannelThatReadsTheLoadedWorldIsNotPrecededByItsRetainedValue()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                await using var client = await Subscribed(engine, LoadWorldUplink.Pushed);
                uplink.Push("survivor", 1.0);
                await PlayUntilTheLoad(engine, client);

                engine.SetGameState(GamePhase.Loading, "FLIGHT");
                Tick(engine, 2.0, value: null);
                engine.SetGameState(GamePhase.Ready, "FLIGHT");
                Tick(engine, 2.2, value: "saved");
                uplink.Push("loaded", 2.2);
                Tick(engine, 2.3, value: "saved");

                var frame = Assert.Single(await DrainAllStreamDataAsync(client, Quiet));
                Assert.Equal("loaded", frame.Payload);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task OnlyTheLastValuePushedDuringTheLoadGoesOutAndOnlyOnceTheWorldStands()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                await using var client = await Subscribed(engine, LoadWorldUplink.Pushed);
                uplink.Push("survivor", 1.0);
                await PlayUntilTheLoad(engine, client);

                engine.SetGameState(GamePhase.Loading, "FLIGHT");
                Tick(engine, 2.0, value: null);
                uplink.Push("half built", 2.0);
                uplink.Push("built", 2.0);
                Tick(engine, 2.1, value: null);
                Assert.Empty(await DrainAllStreamDataAsync(client, Quiet));

                engine.SetGameState(GamePhase.Ready, "FLIGHT");
                Tick(engine, 2.2, value: "saved");
                Tick(engine, 2.3, value: "saved");

                var frame = Assert.Single(await DrainAllStreamDataAsync(client, Quiet));
                Assert.Equal("built", frame.Payload);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnEventPushedDuringTheLoadIsNotHeld()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                await using var client = await Subscribed(engine, LoadWorldUplink.Notice);
                await PlayUntilTheLoad(engine, client);

                engine.SetGameState(GamePhase.Loading, "FLIGHT");
                Tick(engine, 2.0, value: null);
                uplink.PushNotice("mid load", 2.0);
                Tick(engine, 2.1, value: null);

                var frame = Assert.Single(await DrainAllStreamDataAsync(client, Quiet));
                Assert.Equal("mid load", frame.Payload);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASampledChannelIsNotSentItsRetainedValueWhenTheClockGoesBackWithNoLoad()
        {
            using var engine = NewEngine(out _);
            try
            {
                await using var client = await Subscribed(engine, LoadWorldUplink.Sampled);
                await PlayUntilTheLoad(engine, client);

                Tick(engine, 2.0, value: "rewound");

                var frame = Assert.Single(await DrainAllStreamDataAsync(client, Quiet));
                Assert.Equal("rewound", frame.Payload);
                Assert.Equal(1, frame.Meta.TimelineEpoch);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine NewEngine(out LoadWorldUplink uplink)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            uplink = new LoadWorldUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            return engine;
        }

        private static async Task<TestClient> Subscribed(ChannelEngine engine, string topic)
        {
            var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
            await SubscribeAsync(client, topic, Timeout);
            return client;
        }

        private static async Task PlayUntilTheLoad(ChannelEngine engine, TestClient client)
        {
            Tick(engine, 1.0, value: "before the save");
            Tick(engine, 5.0, value: "abandoned");
            await DrainAllStreamDataAsync(client, Quiet);
        }

        private static void Tick(ChannelEngine engine, double ut, string? value)
        {
            var values = new Dictionary<string, object?>();
            if (value != null)
            {
                values[LoadWorldUplink.SnapshotKey] = value;
            }
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = values }, Timeout);
        }

        private sealed class LoadWorldUplink : ISitrepUplink
        {
            public const string SnapshotKey = "load-world";
            public const string Sampled = "load-world-test.sampled";
            public const string Pushed = "load-world-test.pushed";
            public const string Notice = "load-world-test.notice";

            private IChannelPublisher? _pushed;
            private IChannelPublisher? _notice;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "load-world-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    State(Sampled),
                    State(Pushed),
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Event,
                        Topic = Notice,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            private static ChannelDeclaration State(string topic) => new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Sampled, snapshot => snapshot != null && snapshot.Values.TryGetValue(SnapshotKey, out var value) ? value : null);
                _pushed = host.Publisher(Pushed);
                _notice = host.Publisher(Notice);
            }

            public void Push(object? value, double ut) => _pushed!.Publish(value, ut);

            public void PushNotice(object? value, double ut) => _notice!.Publish(value, ut);
        }
    }
}
