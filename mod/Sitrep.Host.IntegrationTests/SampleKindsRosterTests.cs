using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Every registered channel's sample kind rides <c>system.uplinks</c>, Uplink
    /// channels and namespaces included, so a client knows how to draw between a
    /// channel's samples without a scan of any repo having seen the Uplink.
    /// </summary>
    public class SampleKindsRosterTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task SystemUplinksCarriesEveryDeclaredKind()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new KindsTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                // A topic under the namespace, which its prefix covers rather than the roster listing it.
                await SubscribeAsync(client, KindsTestUplink.EventPrefix + "alpha", Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinksTopic, Timeout);

                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                using var kinds = await ReceiveSampleKindsAsync(client);
                var topics = Map(kinds.RootElement, "topics");
                var prefixes = Map(kinds.RootElement, "prefixes");

                Assert.Equal("continuous", topics[KindsTestUplink.ContinuousTopic]);
                Assert.Equal("discrete", topics[KindsTestUplink.DiscreteTopic]);
                Assert.Equal("event", topics[KindsTestUplink.EventTopic]);
                Assert.Equal("event", prefixes[KindsTestUplink.EventPrefix]);
                Assert.False(topics.ContainsKey(KindsTestUplink.EventPrefix + "alpha"));
                Assert.Equal("discrete", topics[ChannelEngine.UplinksTopic]);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static Dictionary<string, string> Map(JsonElement block, string name) =>
            block.GetProperty(name).EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!);

        private static async Task<JsonDocument> ReceiveSampleKindsAsync(TestClient client)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (true)
            {
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero)
                {
                    throw new TimeoutException("No system.uplinks frame arrived within " + Timeout + ".");
                }
                var raw = await client.ReceiveAsync(remaining);
                if (EnvelopeCodec.ParseServerMessage(raw) is not StreamData<object?> data
                    || data.Topic != ChannelEngine.UplinksTopic)
                {
                    continue;
                }
                using var frame = JsonDocument.Parse(raw);
                var block = frame.RootElement.GetProperty("payload").GetProperty("sampleKinds");
                return JsonDocument.Parse(block.GetRawText());
            }
        }

        private sealed class KindsTestUplink : ISitrepUplink
        {
            public const string ContinuousTopic = "kindstest.level";
            public const string DiscreteTopic = "kindstest.mode";
            public const string EventTopic = "kindstest.happened";
            public const string EventPrefix = "kindstest.notices.";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "sample-kinds-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Declare(ContinuousTopic, SampleKind.Continuous),
                    Declare(DiscreteTopic, SampleKind.Discrete),
                    Declare(EventTopic, SampleKind.Event),
                },
            };

            private static ChannelDeclaration Declare(string topic, SampleKind kind) =>
                new ChannelDeclaration
                {
                    Kind = kind,
                    Topic = topic,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                };

            public void Register(IUplinkHost host)
            {
                foreach (var channel in Manifest.Channels)
                {
                    host.AddChannelSource(channel.Topic, _ => null);
                }
                host.RegisterDynamicNamespace(EventPrefix, Declare(EventPrefix, SampleKind.Event));
            }
        }
    }
}
