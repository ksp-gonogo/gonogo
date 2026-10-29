using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A topic whose key segment names the craft it routes to keeps delivering to a
    /// subscriber that connected before the key moved to another craft.
    /// </summary>
    public class KeyRoutedRepointTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string Topic = "routed.core1";

        [Fact]
        public async Task ASubscriberFollowsTheKeyWhenItMovesToAnotherCraft()
        {
            var uplink = new RoutedTestUplink();
            uplink.Place("core1", "craftA");
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                Tick(engine, 1.0);
                Tick(engine, 2.0);
                Assert.NotEmpty(await DrainAllStreamDataAsync(client, Quiet));

                uplink.Place("core1", "craftB");
                Tick(engine, 3.0);
                Tick(engine, 4.0);
                Tick(engine, 5.0);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == Topic && PayloadAt(f) >= 3.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task EverySubscriberOfTheTopicFollowsTheKey()
        {
            var uplink = new RoutedTestUplink();
            uplink.Place("core1", "craftA");
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(first, Topic, Timeout);
                await SubscribeAsync(second, Topic, Timeout);
                Tick(engine, 1.0);
                Tick(engine, 2.0);
                await DrainAllStreamDataAsync(first, Quiet);
                await DrainAllStreamDataAsync(second, Quiet);

                uplink.Place("core1", "craftB");
                Tick(engine, 3.0);
                Tick(engine, 4.0);
                Tick(engine, 5.0);

                foreach (var client in new[] { first, second })
                {
                    var frames = await DrainAllStreamDataAsync(client, Quiet);
                    Assert.Contains(frames, f => f.Topic == Topic && PayloadAt(f) >= 3.0);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASubscriberSurvivesTheKeyBeingUnplacedForATickAndPlacedAgain()
        {
            var uplink = new RoutedTestUplink();
            uplink.Place("core1", "craftA");
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                Tick(engine, 1.0);
                Tick(engine, 2.0);
                await DrainAllStreamDataAsync(client, Quiet);

                uplink.Unplace("core1");
                Tick(engine, 3.0);
                uplink.Place("core1", "craftB");
                Tick(engine, 4.0);
                Tick(engine, 5.0);
                Tick(engine, 6.0);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == Topic && PayloadAt(f) >= 4.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static double PayloadAt(StreamData<object?> frame) =>
            Convert.ToDouble(((IDictionary<string, object?>)frame.Payload!)["ut"]);

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, Timeout);

        private sealed class RoutedTestUplink : ISitrepUplink
        {
            private readonly ConcurrentDictionary<string, string> _craftOfKey = new ConcurrentDictionary<string, string>();
            private IDynamicChannelSource? _source;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "routed-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Place(string key, string craft) => _craftOfKey[key] = craft;

            public void Unplace(string key) => _craftOfKey.TryRemove(key, out _);

            public void Register(IUplinkHost host)
            {
                _source = host.RegisterDynamicNamespace("routed.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                    PerVesselNode = true,
                    VesselIdForKey = key => _craftOfKey.TryGetValue(key, out var craft) ? craft : null,
                });
                host.AddSampledSource(s => s?.Ut, ut =>
                {
                    if (ut is double now && _source != null)
                    {
                        _source.Publisher("core1").Publish(new Dictionary<string, object?> { ["ut"] = now }, now);
                    }
                }, "routed.");
            }
        }
    }
}
