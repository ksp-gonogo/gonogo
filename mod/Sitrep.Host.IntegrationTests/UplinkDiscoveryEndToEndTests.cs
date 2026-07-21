using System;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// End-to-end proof that the discovery path
    /// (<see cref="UplinkDiscovery.Discover(System.Collections.Generic.IEnumerable{System.Reflection.Assembly})"/>
    /// + <see cref="ChannelEngine.RegisterDiscoveredUplink"/>) delivers a
    /// real sample over the wire exactly like the hand-registered
    /// <see cref="ChannelEngine.RegisterUplink(ISitrepUplink)"/> path already
    /// proven throughout <see cref="ChannelEngineTests"/> — the foundation's
    /// whole point is that discovery is a drop-in replacement for the old
    /// hardcoded registration list, not a parallel code path with its own
    /// behavior.
    /// </summary>
    public class UplinkDiscoveryEndToEndTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public async Task DiscoveredUplinkEmitsThroughTheRealEngine()
        {
            var discovered = UplinkDiscovery.Discover(new[] { typeof(UplinkDiscoveryEndToEndTests).Assembly })
                .Where(d => d.Uplink.Manifest.Id == "e2e-discovery-test")
                .ToList();
            Assert.Single(discovered);

            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            foreach (var d in discovered)
            {
                engine.RegisterDiscoveredUplink(d.Uplink, d.ContractMajor, d.ContractMinor);
            }
            Assert.True(engine.AvailabilityOf("e2e-discovery-test").IsAvailable);

            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, DiscoveryEchoUplink.Topic, Timeout);

                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(DiscoveryEchoUplink.Topic, delivered.Topic);
                Assert.Equal("hello-from-discovery", delivered.Payload);
            }
            finally
            {
                engine.Stop();
            }
        }

        [SitrepUplink("e2e-discovery-test")]
        public sealed class DiscoveryEchoUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public const string Topic = "test.discovery.echo";

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "e2e-discovery-test",
                Version = "1.0.0",
                Channels = new[]
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IUplinkHost host) =>
                host.AddChannelSource(Topic, _ => "hello-from-discovery");
        }
    }
}
