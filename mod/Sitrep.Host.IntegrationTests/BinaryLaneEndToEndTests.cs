using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The binary lane through the REAL socket: a real
    /// <see cref="System.Net.WebSockets.ClientWebSocket"/> against a real
    /// <see cref="ChannelEngine"/>, so what is asserted is what a third party
    /// would see on the wire rather than what a codec unit test says it should.
    ///
    /// <para>The one that is easy to skip and is the reason the flag exists is
    /// <see cref="AByteArrayOnAnOrdinaryChannelStillGoesOutAsJson"/>: the lane
    /// is DECLARED, and nothing may infer it from a payload's CLR type. Without
    /// that assertion the obvious "optimisation" of sniffing for
    /// <c>byte[]</c> looks harmless, and it would silently change the wire
    /// shape of every channel that publishes a number array on purpose.</para>
    /// </summary>
    public class BinaryLaneEndToEndTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(400);

        [Fact]
        public async Task AnOpaqueChannelArrivesAsABinaryFrameWithItsSegmentsIntact()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.Batch));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Equal("subscribed", (await SubscribeAsync(client, OpaqueUplink.Topic, Timeout)).Name);

                engine.TickAndWait(0.0, OpaqueUplink.Snapshot(), TimeSpan.FromMilliseconds(500));

                var frame = await client.ReceiveBinaryAsync(Timeout);
                Assert.True(BinaryFrameCodec.TryParseStreamBinary(
                    frame, 0, frame.Length, out var header, out var segments, out var reason), reason);

                Assert.Equal("stream-binary", header.Type);
                Assert.Equal(OpaqueUplink.Topic, header.Topic);
                Assert.Equal(OpaqueUplink.BatchSegments.Length, segments.Count);
                for (var i = 0; i < OpaqueUplink.BatchSegments.Length; i++)
                {
                    Assert.Equal(OpaqueUplink.BatchSegments[i], segments[i]);
                }

                // The delivery is a real delivery, not a special case that
                // skipped the pipeline: it carries the vantage the connection
                // is observing at, and a UT it was valid at.
                Assert.Equal("ksc", header.Meta.Vantage);
                Assert.Equal(0.0, header.Meta.ValidAt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A producer with genuinely one segment this frame does not have to
        /// wrap it in a collection, and what arrives is a one-segment frame
        /// rather than a differently-shaped one.
        /// </summary>
        [Fact]
        public async Task ASingleByteArrayIsCarriedAsOneSegment()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.Single));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Equal("subscribed", (await SubscribeAsync(client, OpaqueUplink.Topic, Timeout)).Name);
                engine.TickAndWait(0.0, OpaqueUplink.Snapshot(), TimeSpan.FromMilliseconds(500));

                var frame = await client.ReceiveBinaryAsync(Timeout);
                Assert.True(BinaryFrameCodec.TryParseStreamBinary(
                    frame, 0, frame.Length, out _, out var segments, out var reason), reason);
                Assert.Single(segments);
                Assert.Equal(OpaqueUplink.SingleSegment, segments[0]);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// PLANTED CONTROL for "declared, never inferred". The payload here is
        /// the same CLR type the lane carries, on a channel that did not ask
        /// for the lane, and it must still arrive as an ordinary JSON
        /// <c>stream-data</c> holding a number array. Publishing a
        /// <c>byte[]</c> as numbers is a legitimate thing for a channel to do,
        /// and a rule that sniffed the type would rewrite its wire shape
        /// without anyone asking.
        /// </summary>
        [Fact]
        public async Task AByteArrayOnAnOrdinaryChannelStillGoesOutAsJson()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.NotDeclared));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Equal("subscribed", (await SubscribeAsync(client, OpaqueUplink.Topic, Timeout)).Name);
                engine.TickAndWait(0.0, OpaqueUplink.Snapshot(), TimeSpan.FromMilliseconds(500));

                var data = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(OpaqueUplink.Topic, data.Topic);
                var numbers = Assert.IsType<List<object?>>(data.Payload);
                Assert.Equal(OpaqueUplink.SingleSegment.Length, numbers.Count);

                await client.AssertNoBinaryFrameArrivesAsync(Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Absence discipline at the producing end. A null on a lane that
        /// carries bytes is a producer contradicting its own declaration, and
        /// the honest answer is a named refusal on both surfaces, not a frame
        /// with zero segments: zero segments already means "nothing to say this
        /// tick", and a listener must be able to tell that from a broken
        /// channel.
        ///
        /// <para>The channel declares <c>AbsenceIsData</c> because that is the
        /// only way a null reaches the wire at all: without it the engine's
        /// birth gate drops the sample upstream and the channel goes quiet,
        /// which is existing behaviour and not this lane's business. So the
        /// contradiction under test is the deliberate one, a producer asking
        /// for a tombstone on a lane that has no way to spell one.</para>
        /// </summary>
        [Fact]
        public async Task ANullPayloadOnTheBinaryLaneIsRefusedByNameNotSentAsAnEmptyFrame()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.Null));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Equal("subscribed", (await SubscribeAsync(client, OpaqueUplink.Topic, Timeout)).Name);
                engine.TickAndWait(0.0, OpaqueUplink.Snapshot(), TimeSpan.FromMilliseconds(500));

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("payload-serialization-error", error.Code);
                Assert.Equal(OpaqueUplink.Topic, error.Topic);
                Assert.Contains("returned null", error.Message);

                await client.AssertNoBinaryFrameArrivesAsync(Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A mapper that hands the lane something that is not bytes at all is
        /// the ordinary serialization failure, and gets the ordinary treatment:
        /// the uplink is marked unavailable and the subscriber is told which
        /// type arrived, rather than being acked and starved.
        /// </summary>
        [Fact]
        public async Task ANonBytePayloadOnTheBinaryLaneNamesTheTypeItGot()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.WrongType));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Equal("subscribed", (await SubscribeAsync(client, OpaqueUplink.Topic, Timeout)).Name);
                engine.TickAndWait(0.0, OpaqueUplink.Snapshot(), TimeSpan.FromMilliseconds(500));

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("payload-serialization-error", error.Code);
                Assert.Contains("must return byte[]", error.Message);

                await client.AssertNoBinaryFrameArrivesAsync(Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The inbound half. The lane runs server-to-client only, and a client
        /// that sends one UP the socket used to have its bytes UTF-8 decoded
        /// unconditionally and then reported as a malformed envelope, which
        /// names the wrong problem. It is now refused by name.
        /// </summary>
        [Fact]
        public async Task AnInboundBinaryFrameIsRefusedByNameRatherThanMangled()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.Batch));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendBytesAsync(new byte[] { BinaryLane.Magic, BinaryLane.LaneStreamBinary, 0, 2, 0x7B, 0x7D });

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("binary-frame-not-accepted", error.Code);
                Assert.Contains("server-to-client only", error.Message);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// An inbound frame on a lane byte this build does not know is refused
        /// as an UNKNOWN LANE rather than as the one lane it does know. The
        /// distinction is what tells a newer client "this mod is older" instead
        /// of "you sent that the wrong way".
        /// </summary>
        [Fact]
        public async Task AnInboundFrameOnAnUnknownLaneSaysSo()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.Batch));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendBytesAsync(new byte[] { BinaryLane.Magic, 0x42, 0, 0 });

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("binary-frame-not-accepted", error.Code);
                Assert.Contains("unknown binary lane 0x42", error.Message);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// PLANTED CONTROL for the inbound guard: an ordinary text subscribe on
        /// the same socket must still work. A discriminator that refused
        /// everything would pass every assertion above and break the protocol.
        /// </summary>
        [Fact]
        public async Task AnOrdinaryTextSubscribeStillWorksAlongsideTheGuard()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OpaqueUplink(OpaqueUplink.Batch));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendBytesAsync(new byte[] { BinaryLane.Magic, 0x42, 0, 0 });
                var refusal = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("binary-frame-not-accepted", refusal.Code);

                Assert.Equal("subscribed", (await SubscribeAsync(client, OpaqueUplink.Topic, Timeout)).Name);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class OpaqueUplink : ISitrepUplink
        {
            public const string UplinkId = "opaque";
            public const string Topic = "opaque.payload";
            public const string Batch = "batch";
            public const string Single = "single";
            public const string Null = "null";
            public const string WrongType = "wrong-type";
            public const string NotDeclared = "not-declared";

            public static readonly byte[] SingleSegment = { 0x01, 0x02, 0x03, 0xFE, 0xFF };

            public static readonly byte[][] BatchSegments =
            {
                new byte[] { 0x9E, 0x01, 0x00 },
                new byte[] { 0x7B, 0x22 },
                new byte[] { 0xFF },
            };

            private readonly string _kind;

            public OpaqueUplink(string kind)
            {
                _kind = kind;
                Manifest = new UplinkManifest
                {
                    Id = UplinkId,
                    Version = "1.0.0",
                    Channels = new List<ChannelDeclaration>
                    {
                        new ChannelDeclaration
                        {
                            Topic = Topic,
                            Delivery = Delivery.ReliableOrdered,
                            Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                            OpaquePayload = kind != NotDeclared,
                            // Only reachable WITH this. A null mapper result on
                            // an ordinary channel never reaches the delivery
                            // closure at all: the engine's birth gate drops it
                            // upstream and the channel simply stays quiet. The
                            // contradiction the lane has to answer for is the
                            // one a producer opts into, where a null is emitted
                            // deliberately as a tombstone.
                            AbsenceIsData = kind == Null,
                        },
                    },
                };
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; }

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, _ => _kind switch
                {
                    Batch => BatchSegments,
                    Single => SingleSegment,
                    NotDeclared => SingleSegment,
                    WrongType => "not bytes",
                    _ => null,
                });
            }

            public static KspSnapshot Snapshot() => new KspSnapshot { Values = new Dictionary<string, object?>() };
        }
    }
}
