using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Every registered channel's delay role rides <c>system.uplinks</c>, Uplink
    /// channels included, so a client reads each in the right lane without a scan
    /// of any repo having seen the Uplink.
    ///
    /// <para>Read off the real socket. The roles block is held equal to the committed
    /// <c>mod/golden-fixtures/delay-roles-roster.json</c>, which
    /// <c>packages/sitrep-client/src/uplink-delay-roles.test.ts</c> feeds through the
    /// real client decode path into the store, so neither half can drift without
    /// the other going red.</para>
    /// </summary>
    public class DelayRolesRosterTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        private static readonly string FixturePath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "delay-roles-roster.json");

        [Fact]
        public async Task SystemUplinksCarriesEveryDeclaredDelayRole()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new DelayRolesTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                // Materializes a topic under the TrueNow namespace, which the prefix
                // must cover rather than the roster listing it on its own.
                await SubscribeAsync(client, DelayRolesTestUplink.LivePrefix + "alpha", Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinksTopic, Timeout);

                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var roles = await ReceiveDelayRolesAsync(client);
                using var fixture = JsonDocument.Parse(File.ReadAllText(FixturePath));
                var expected = fixture.RootElement.GetProperty("delayRoles");

                foreach (var list in new[] { "trueNow", "heldAtHome", "trueNowPrefixes" })
                {
                    Assert.Equal(Strings(expected, list), Strings(roles.RootElement, list));
                }

                var trueNow = Strings(roles.RootElement, "trueNow");
                var heldAtHome = Strings(roles.RootElement, "heldAtHome");
                Assert.Contains(DelayRolesTestUplink.LinkTrueNowTopic, trueNow);
                Assert.Contains(DelayRolesTestUplink.SecondTrueNowTopic, trueNow);
                Assert.Equal(new[] { DelayRolesTestUplink.HeldAtHomeTopic }, heldAtHome);
                Assert.DoesNotContain(DelayRolesTestUplink.HeldAtHomeTopic, trueNow);
                Assert.DoesNotContain(DelayRolesTestUplink.DelayedTopic, trueNow.Concat(heldAtHome));
                Assert.DoesNotContain(DelayRolesTestUplink.LivePrefix + "alpha", trueNow);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static string[] Strings(JsonElement block, string name) =>
            block.GetProperty(name).EnumerateArray().Select(e => e.GetString()!).ToArray();

        /// <summary>The <c>delayRoles</c> block of the next roster frame, parsed from the raw text the socket carried.</summary>
        private static async Task<JsonDocument> ReceiveDelayRolesAsync(TestClient client)
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
                var block = frame.RootElement.GetProperty("payload").GetProperty("delayRoles");
                return JsonDocument.Parse(block.GetRawText());
            }
        }

        /// <summary>
        /// One of each role. The held-at-home and TrueNow topics borrow real Uplink
        /// channel names so the client half reads as the case it stands for: an RP-1
        /// ledger held at home and two comms-link facts current everywhere at once.
        /// Beside them a craft-side channel that stays delayed, and a TrueNow dynamic
        /// namespace.
        /// </summary>
        private sealed class DelayRolesTestUplink : ISitrepUplink
        {
            public const string HeldAtHomeTopic = "rp1.programs";
            public const string LinkTrueNowTopic = "comms.linkMargin";
            public const string SecondTrueNowTopic = "comms.dataRate";
            public const string DelayedTopic = "uplinktest.craftState";
            public const string LivePrefix = "uplinktest.live.";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "delay-roles-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Declare(HeldAtHomeTopic, DelayRole.Delayed, heldAtHome: true),
                    Declare(LinkTrueNowTopic, DelayRole.TrueNow),
                    Declare(SecondTrueNowTopic, DelayRole.TrueNow),
                    Declare(DelayedTopic, DelayRole.Delayed),
                },
            };

            private static ChannelDeclaration Declare(string topic, DelayRole delay, bool heldAtHome = false) =>
                new ChannelDeclaration
                {
                    Topic = topic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = delay,
                    HeldAtHome = heldAtHome,
                };

            public void Register(IUplinkHost host)
            {
                foreach (var channel in Manifest.Channels)
                {
                    host.AddChannelSource(channel.Topic, _ => null);
                }
                host.RegisterDynamicNamespace(LivePrefix, Declare(LivePrefix, DelayRole.TrueNow));
            }
        }
    }
}
