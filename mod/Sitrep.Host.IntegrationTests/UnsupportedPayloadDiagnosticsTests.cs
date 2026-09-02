using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What a THIRD-PARTY Uplink author sees when a channel of theirs publishes
    /// a CLR type the wire codec cannot write.
    ///
    /// <para>The failure used to be shaped as badly as a failure can be: the
    /// client received <c>subscribed</c> and then nothing, ever, which is
    /// byte-for-byte indistinguishable from a channel that has simply not
    /// produced a value yet. The host log did carry the fault, but the browser
    /// is the surface an author is actually watching while they build, and it
    /// said nothing at all.</para>
    ///
    /// <para>Two halves, and they are separate fixes. A boxed ENUM is no longer
    /// an unsupported type: it writes as its integer ordinal like every
    /// declared enum in the codec, so that payload now simply arrives. A plain
    /// POCO is still unsupported (deliberately: see the report on this branch),
    /// but the drop is now announced to the subscriber as an
    /// <see cref="ErrorMsg"/> naming the topic and the offending CLR type, the
    /// same treatment an unserializable COMMAND result has had since C2-4.</para>
    /// </summary>
    public class UnsupportedPayloadDiagnosticsTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(400);

        /// <summary>
        /// The report's headline case, fixed: a subscriber whose channel
        /// publishes an unserializable POCO is TOLD, rather than being acked
        /// and then starved in a way it cannot tell from "no data yet".
        /// </summary>
        [Fact]
        public async Task AnUnserializablePayloadTellsTheSubscriberInsteadOfGoingQuiet()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ThirdPartyPayloadUplink(ThirdPartyPayloadUplink.Poco));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Equal("subscribed", (await SubscribeAsync(client, ThirdPartyPayloadUplink.Topic, Timeout)).Name);

                engine.TickAndWait(0.0, ThirdPartyPayloadUplink.Snapshot(), TimeSpan.FromMilliseconds(500));

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("payload-serialization-error", error.Code);
                Assert.Equal(ThirdPartyPayloadUplink.Topic, error.Topic);

                // (b) of the brief: the message must name the offending type
                // AND the channel, or it does not shorten anyone's search.
                Assert.Contains(ThirdPartyPayloadUplink.Topic, error.Message);
                Assert.Contains(nameof(BurnPlan), error.Message);

                // Still no telemetry frame: the payload genuinely cannot be
                // written, so the fix is the announcement, not a delivery.
                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Empty(frames);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The KSP-log half, which is the surface a player pasting a log into a
        /// bug report gives you. The engine's diagnostic sink is
        /// <c>UnityEngine.Debug.LogWarning</c> in production (GonogoAddon), so
        /// a line reaching it here is a line reaching KSP.log there. It must
        /// name the topic and the type, and must NOT claim the mapper threw:
        /// the mapper returned a perfectly good value and an author sent to
        /// audit it is being sent to the wrong file.
        /// </summary>
        [Fact]
        public async Task AnUnserializablePayloadIsAttributedInTheKspVisibleLogWithoutBlamingTheMapper()
        {
            var diagnostics = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetDiagnosticLog(diagnostics.Enqueue);
            engine.RegisterUplink(new ThirdPartyPayloadUplink(ThirdPartyPayloadUplink.Poco));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ThirdPartyPayloadUplink.Topic, Timeout);
                engine.TickAndWait(0.0, ThirdPartyPayloadUplink.Snapshot(), TimeSpan.FromMilliseconds(500));
                await ReceiveTypedAsync<ErrorMsg>(client, Timeout);

                var lines = diagnostics.ToArray();
                Assert.Contains(lines, l => l.Contains(ThirdPartyPayloadUplink.Topic)
                    && l.Contains(nameof(BurnPlan)));
                Assert.DoesNotContain(lines, l => l.Contains("mapper threw"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The report's second case, fixed differently: a boxed enum was never
        /// genuinely unsupported, it just had no case. It now arrives as its
        /// integer ordinal, the same shape a declared contract enum has always
        /// had on the wire, and the uplink stays available.
        /// </summary>
        [Fact]
        public async Task ABoxedEnumPayloadReachesTheWireAsItsOrdinal()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ThirdPartyPayloadUplink(ThirdPartyPayloadUplink.Enum));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ThirdPartyPayloadUplink.Topic, Timeout);

                engine.TickAndWait(0.0, ThirdPartyPayloadUplink.Snapshot(), Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(ThirdPartyPayloadUplink.Topic, delivered.Topic);
                Assert.Equal((int)ThrottleMode.Nominal, Convert.ToInt32(delivered.Payload));
                Assert.True(engine.AvailabilityOf(ThirdPartyPayloadUplink.UplinkId).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>A third-party enum, of the shape any Uplink author might declare.</summary>
        private enum ThrottleMode
        {
            Idle = 0,
            Nominal = 1,
            Full = 2,
        }

        /// <summary>
        /// A plain third-party POCO: no contract attribute, no flattener, not a
        /// dictionary or an enumerable. Exactly what an outside author reaches
        /// for first, and exactly what the codec cannot write.
        /// </summary>
        internal sealed class BurnPlan
        {
            public double DeltaV { get; set; }
            public string Node { get; set; } = "";
        }

        private sealed class ThirdPartyPayloadUplink : ISitrepUplink
        {
            public const string UplinkId = "third-party-payload";
            public const string Topic = "thirdparty.payload";
            public const string Poco = "poco";
            public const string Enum = "enum";

            private readonly string _kind;

            public ThirdPartyPayloadUplink(string kind) => _kind = kind;

            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
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

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, _ => _kind == Enum
                    ? (object?)ThrottleMode.Nominal
                    : new BurnPlan { DeltaV = 1234.5, Node = "circularise" });
            }

            public static KspSnapshot Snapshot() => new KspSnapshot { Values = new Dictionary<string, object?>() };
        }
    }
}
