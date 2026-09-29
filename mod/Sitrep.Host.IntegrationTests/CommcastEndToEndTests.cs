using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Commcast;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Commcast through the real socket, at three command centres a light-time
    /// apart: what each connection receives, and when, is what a third party with
    /// a WebSocket would see.
    ///
    /// <para>Separations: A to B 5 s, A to C 20 s, B to C 18 s, every pair routed
    /// unless a test says otherwise. UT advances only when a test ticks, so "not
    /// yet" is asserted one tick short of the light-time and "now" on it.</para>
    /// </summary>
    public class CommcastEndToEndTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string A = "ground:a";
        private const string B = "ground:b";
        private const string C = "ground:c";

        private static readonly Dictionary<(string, string), double> Separations = new()
        {
            [(A, B)] = 5,
            [(A, C)] = 20,
            [(B, C)] = 18,
        };

        [Fact]
        public async Task AMessageReachesAMemberOneLightTimeLaterAndNeverReachesANonMember()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            await scene.CommandAsync(scene.A, CommcastUplink.SendCommand, Send("m1", "g1", "hello"));

            scene.Tick(4);
            await scene.B.AssertNoMessageArrivesAsync(Quiet);

            scene.Tick(5);
            var opened = await NextTrafficAsync(scene.B);
            Assert.Equal("members", opened["kind"]);
            Assert.Equal(A, opened["from"]);
            var text = await NextTrafficAsync(scene.B);
            Assert.Equal("text", text["kind"]);
            Assert.Equal("hello", text["body"]);
            Assert.Equal(new[] { A, B }, Strings(text["to"]));

            scene.Tick(60);
            await scene.C.AssertNoMessageArrivesAsync(Quiet);
            await scene.C.AssertNoBinaryFrameArrivesAsync(Quiet);
        }

        [Fact]
        public async Task TheDeliveryIsStampedWithWhenItWasSaidAndWhenItArrived()
        {
            await using var scene = await Scene.StartAsync();
            scene.Tick(100);
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));

            scene.Tick(105);
            var data = await ReceiveStreamDataAsync(scene.B, Timeout);
            Assert.Equal(CommcastUplink.TrafficTopic, data.Topic);
            Assert.Equal(100.0, data.Meta.ValidAt);
            Assert.Equal(105.0, data.Meta.DeliveredAt);
            Assert.Equal(B, data.Meta.Vantage);
        }

        [Fact]
        public async Task ANonMemberCannotSpeakToAGroup()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));

            var refused = await scene.CommandAsync(scene.C, CommcastUplink.SendCommand, Send("m1", "g1", "let me in"));
            Assert.False(refused.Success);
        }

        /// <summary>
        /// A member knows it is one only once word of the group has reached it, so
        /// until then it can no more speak to the group than an outsider can.
        /// </summary>
        [Fact]
        public async Task AMemberCanSpeakOnlyOnceWordOfTheGroupHasReachedIt()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));

            scene.Tick(4);
            Assert.False((await scene.CommandAsync(scene.B, CommcastUplink.SendCommand, Send("m1", "g1", "early"))).Success);

            scene.Tick(5);
            Assert.True((await scene.CommandAsync(scene.B, CommcastUplink.SendCommand, Send("m2", "g1", "on time"))).Success);
        }

        [Fact]
        public async Task AnAcknowledgementCrossesBackToTheAuthorAlone()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B, C));
            await scene.CommandAsync(scene.A, CommcastUplink.SendCommand, Send("m1", "g1", "roger?"));
            scene.Tick(5);
            await DrainAllStreamDataAsync(scene.B, Quiet);
            await DrainAllStreamDataAsync(scene.A, Quiet);

            await scene.CommandAsync(scene.B, CommcastUplink.AckCommand, new Dictionary<string, object?> { ["messageId"] = "m1" });
            scene.Tick(9);
            await scene.A.AssertNoMessageArrivesAsync(Quiet);

            scene.Tick(10);
            var ack = await NextTrafficAsync(scene.A);
            Assert.Equal("ack", ack["kind"]);
            Assert.Equal("m1", ack["messageId"]);
            Assert.Equal(B, ack["from"]);

            scene.Tick(60);
            var atC = await DrainAllStreamDataAsync(scene.C, Quiet);
            Assert.DoesNotContain(atC, d => (d.Payload as Dictionary<string, object?>)?["kind"] as string == "ack");
        }

        [Fact]
        public async Task RadioArrivesOnTheBinaryLaneWithItsDescriptionAndAudioIntact()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            var audio = new[] { new byte[] { 0x9E, 0x01, 0x7B }, new byte[] { 0xFF, 0x00 } };
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 0, audio));

            scene.Tick(4);
            await scene.B.AssertNoBinaryFrameArrivesAsync(Quiet);

            scene.Tick(5);
            var (header, batch, segments) = await NextRadioAsync(scene.B);
            Assert.Equal(CommcastUplink.RadioTopic, header.Topic);
            Assert.Equal("t1", batch.GetProperty("transmissionId").GetString());
            Assert.Equal(A, batch.GetProperty("from").GetString());
            Assert.Equal(0, batch.GetProperty("seq").GetInt32());
            Assert.Equal(2, segments.Count - 1);
            Assert.Equal(audio[0], segments[1]);
            Assert.Equal(audio[1], segments[2]);
        }

        /// <summary>
        /// The operator's example: someone already in the group adds a centre part
        /// way through a keying. The newcomer hears the join and the stream one
        /// light-time from the speaker, and the stream starts for it at the first
        /// batch spoken after the add, never earlier.
        /// </summary>
        [Fact]
        public async Task ACentreAddedMidTransmissionHearsFromTheJoinOneLightTimeLater()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 0, OneChunk));

            scene.Tick(10);
            await scene.CommandAsync(scene.A, CommcastUplink.AddCommand, new Dictionary<string, object?> { ["groupId"] = "g1", ["added"] = new List<object?> { C } });
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 500, OneChunk));

            scene.Tick(29);
            await scene.C.AssertNoMessageArrivesAsync(Quiet);
            await scene.C.AssertNoBinaryFrameArrivesAsync(Quiet);

            scene.Tick(30);
            var join = await NextTrafficAsync(scene.C);
            Assert.Equal("members", join["kind"]);
            Assert.Equal(new[] { C }, Strings(join["added"]));
            var (_, batch, _) = await NextRadioAsync(scene.C);
            Assert.Equal(500, batch.GetProperty("seq").GetInt32());
            await scene.C.AssertNoBinaryFrameArrivesAsync(Quiet);
        }

        /// <summary>
        /// When someone other than the speaker adds a centre, the speaker addresses
        /// the newcomer only once word of the add has reached the speaker.
        /// </summary>
        [Fact]
        public async Task ASpeakerAddressesANewcomerOnceWordOfTheAddHasReachedIt()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            scene.Tick(5);
            await scene.CommandAsync(scene.B, CommcastUplink.AddCommand, new Dictionary<string, object?> { ["groupId"] = "g1", ["added"] = new List<object?> { C } });

            scene.Tick(9);
            await scene.CommandAsync(scene.A, CommcastUplink.SendCommand, Send("before", "g1", "not for C"));
            scene.Tick(10);
            await scene.CommandAsync(scene.A, CommcastUplink.SendCommand, Send("after", "g1", "for C"));

            scene.Tick(100);
            var bodies = (await DrainAllStreamDataAsync(scene.C, Quiet))
                .Select(d => (Dictionary<string, object?>)d.Payload!)
                .Where(p => (string?)p["kind"] == "text")
                .Select(p => (string?)p["body"])
                .ToList();
            Assert.Equal(new[] { "for C" }, bodies);
        }

        [Fact]
        public async Task AMemberWithNoPathFromTheSpeakerMissesWhatIsSaid()
        {
            await using var scene = await Scene.StartAsync(unrouted: (A, C));
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B, C));
            await scene.CommandAsync(scene.A, CommcastUplink.SendCommand, Send("m1", "g1", "anyone?"));

            scene.Tick(5);
            Assert.Equal("members", (await NextTrafficAsync(scene.B))["kind"]);
            scene.Tick(100);
            await scene.C.AssertNoMessageArrivesAsync(Quiet);
        }

        /// <summary>
        /// Nothing is replayed to a connection that subscribes after a transmission
        /// reached it; something still crossing when it subscribes still lands.
        /// </summary>
        [Fact]
        public async Task ALateSubscriberGetsWhatIsStillCrossingAndNothingThatAlreadyArrived()
        {
            await using var scene = await Scene.StartAsync(subscribeB: false);
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            scene.Tick(5);
            await scene.CommandAsync(scene.A, CommcastUplink.SendCommand, Send("m1", "g1", "in flight"));

            Assert.Equal("subscribed", (await SubscribeAsync(scene.B, CommcastUplink.TrafficTopic, Timeout)).Name);
            await scene.B.AssertNoMessageArrivesAsync(Quiet);

            scene.Tick(10);
            var text = await NextTrafficAsync(scene.B);
            Assert.Equal("in flight", text["body"]);
            await scene.B.AssertNoMessageArrivesAsync(Quiet);
        }

        [Fact]
        public async Task TheDelayExemptionCannotSpeak()
        {
            await using var scene = await Scene.StartAsync();
            var refused = await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B), vantage: ChannelEngine.MetaVantage);
            Assert.False(refused.Success);
        }

        /// <summary>
        /// A transmission is detectable wherever its speaker's signal reaches, member
        /// or not, and its row lands there exactly when its audio would.
        /// </summary>
        [Fact]
        public async Task ATransmissionIsListedWhereverItsSignalReachesAtTheInstantItsAudioWould()
        {
            await using var scene = await Scene.StartAsync(discovery: true);
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 0, OneChunk));

            scene.Tick(19);
            await scene.C.AssertNoMessageArrivesAsync(Quiet);

            scene.Tick(20);
            var data = await NextOnAsync(scene.C, CommcastUplink.TransmissionsTopic);
            var row = (Dictionary<string, object?>)data.Payload!;
            Assert.Equal("open", row["phase"]);
            Assert.Equal("t1", row["transmissionId"]);
            Assert.Equal(A, row["from"]);
            Assert.Equal(CommcastUplink.RadioTopic, row["topic"]);
            Assert.Equal(0.0, data.Meta.ValidAt);
            Assert.Equal(20.0, data.Meta.DeliveredAt);
            await scene.C.AssertNoBinaryFrameArrivesAsync(Quiet);
        }

        [Fact]
        public async Task NothingIsListedWhereTheSpeakerHasNoPath()
        {
            await using var scene = await Scene.StartAsync(unrouted: (A, C), discovery: true);
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 0, OneChunk));

            scene.Tick(100);
            await scene.C.AssertNoMessageArrivesAsync(Quiet);
        }

        /// <summary>
        /// Tuning in is adding yourself, allowed once the transmission has reached
        /// you. The speaker addresses you from when word of that reaches it, so the
        /// audio starts one round trip after you asked.
        /// </summary>
        [Fact]
        public async Task AVantageTheTransmissionHasReachedCanTuneInAndHearsFromOneRoundTripLater()
        {
            await using var scene = await Scene.StartAsync(discovery: true);
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 0, OneChunk));
            var tuneIn = new Dictionary<string, object?> { ["groupId"] = "g1", ["added"] = new List<object?> { C } };

            scene.Tick(19);
            Assert.False((await scene.CommandAsync(scene.C, CommcastUplink.AddCommand, tuneIn)).Success);

            scene.Tick(20);
            Assert.True((await scene.CommandAsync(scene.C, CommcastUplink.AddCommand, tuneIn)).Success);

            scene.Tick(39);
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 100, OneChunk));
            scene.Tick(40);
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 200, OneChunk));

            scene.Tick(100);
            var (_, batch, _) = await NextRadioAsync(scene.C);
            Assert.Equal(200, batch.GetProperty("seq").GetInt32());
            await scene.C.AssertNoBinaryFrameArrivesAsync(Quiet);
        }

        [Fact]
        public async Task TuningInAddsNobodyElse()
        {
            await using var scene = await Scene.StartAsync(discovery: true);
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 0, OneChunk));
            scene.Tick(20);

            var both = new Dictionary<string, object?> { ["groupId"] = "g1", ["added"] = new List<object?> { C, "ground:d" } };
            Assert.False((await scene.CommandAsync(scene.C, CommcastUplink.AddCommand, both)).Success);
        }

        private static async Task<StreamData<object?>> NextOnAsync(TestClient client, string topic)
        {
            while (true)
            {
                var data = await ReceiveStreamDataAsync(client, Timeout);
                if (data.Topic == topic)
                {
                    return data;
                }
            }
        }

        private static readonly byte[][] OneChunk = { new byte[] { 0x01, 0x02 } };

        private static Dictionary<string, object?> Open(string groupId, params string[] members) => new()
        {
            ["groupId"] = groupId,
            ["members"] = members.Cast<object?>().ToList(),
        };

        private static Dictionary<string, object?> Send(string id, string groupId, string body) => new()
        {
            ["id"] = id,
            ["groupId"] = groupId,
            ["body"] = body,
        };

        private static Dictionary<string, object?> Transmit(string id, string groupId, int seq, byte[][] chunks) => new()
        {
            ["transmissionId"] = id,
            ["groupId"] = groupId,
            ["seq"] = seq,
            ["chunks"] = chunks.Select(c => (object?)Convert.ToBase64String(c)).ToList(),
        };

        private static string[] Strings(object? list) =>
            ((IEnumerable<object?>)list!).Select(o => (string)o!).ToArray();

        private static async Task<Dictionary<string, object?>> NextTrafficAsync(TestClient client)
        {
            while (true)
            {
                var data = await ReceiveStreamDataAsync(client, Timeout);
                if (data.Topic == CommcastUplink.TrafficTopic)
                {
                    return (Dictionary<string, object?>)data.Payload!;
                }
            }
        }

        private static async Task<(StreamBinary Header, System.Text.Json.JsonElement Batch, IReadOnlyList<byte[]> Segments)> NextRadioAsync(TestClient client)
        {
            var frame = await client.ReceiveBinaryAsync(Timeout);
            Assert.True(BinaryFrameCodec.TryParseStreamBinary(
                frame, 0, frame.Length, out var header, out var segments, out var reason), reason);
            var batch = System.Text.Json.JsonDocument.Parse(segments[0]).RootElement.Clone();
            return (header, batch, segments);
        }

        /// <summary>An engine with three ground centres, the commcast Uplink, and one connection standing at each.</summary>
        private sealed class Scene : IAsyncDisposable
        {
            private readonly ChannelEngine _engine;
            private int _request;
            private bool _discovery;

            public TestClient A { get; private set; } = null!;
            public TestClient B { get; private set; } = null!;
            public TestClient C { get; private set; } = null!;

            private Scene(ChannelEngine engine) => _engine = engine;

            public static async Task<Scene> StartAsync((string, string)? unrouted = null, bool subscribeB = true, bool discovery = false)
            {
                var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
                foreach (var id in new[] { CommcastEndToEndTests.A, CommcastEndToEndTests.B, CommcastEndToEndTests.C })
                {
                    engine.RegisterCommandCentreSource(new StaticSource(id));
                }
                engine.RegisterUplink(new LedgerUplink(unrouted));
                engine.RegisterUplink(new CommcastUplink());
                engine.Start();
                var scene = new Scene(engine) { _discovery = discovery };
                scene.Tick(0);
                scene.A = await scene.ConnectAtAsync(CommcastEndToEndTests.A, subscribe: true);
                scene.B = await scene.ConnectAtAsync(CommcastEndToEndTests.B, subscribe: subscribeB);
                scene.C = await scene.ConnectAtAsync(CommcastEndToEndTests.C, subscribe: true);
                return scene;
            }

            public void Tick(double ut) => _engine.TickAndWait(ut, null, Timeout);

            public async Task<CommandResult> CommandAsync(TestClient client, string command, Dictionary<string, object?> args, string? vantage = null)
            {
                var requestId = "r" + (++_request);
                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = requestId,
                    Command = command,
                    Vantage = vantage,
                    Args = args,
                    SentAt = 0.0,
                }));
                while (true)
                {
                    var response = await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
                    if (response.RequestId != requestId)
                    {
                        continue;
                    }
                    var result = (Dictionary<string, object?>)response.Result!;
                    return new CommandResult { Success = (bool)result["success"]! };
                }
            }

            private async Task<TestClient> ConnectAtAsync(string centre, bool subscribe)
            {
                var client = await TestClient.ConnectAsync(_engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
                if (subscribe)
                {
                    Assert.Equal("subscribed", (await SubscribeAsync(client, CommcastUplink.TrafficTopic, Timeout)).Name);
                    Assert.Equal("subscribed", (await SubscribeAsync(client, CommcastUplink.RadioTopic, Timeout)).Name);
                }
                if (_discovery)
                {
                    Assert.Equal("subscribed", (await SubscribeAsync(client, CommcastUplink.TransmissionsTopic, Timeout)).Name);
                }
                return client;
            }

            public async ValueTask DisposeAsync()
            {
                await A.DisposeAsync();
                await B.DisposeAsync();
                await C.DisposeAsync();
                _engine.Stop();
                _engine.Dispose();
            }
        }

        /// <summary>Writes the separations above into the ledger, and their routes, on every tick.</summary>
        private sealed class LedgerUplink : ISitrepUplink
        {
            private readonly (string, string)? _unrouted;
            private IUplinkHost? _host;

            public LedgerUplink((string, string)? unrouted) => _unrouted = unrouted;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "test-ledger", Version = "1.0.0" };

            public void Register(IUplinkHost host)
            {
                _host = host;
                host.AddSampledSource(_ => null, _ => Apply());
            }

            private void Apply()
            {
                var routes = new Dictionary<string, IReadOnlyCollection<string>>();
                foreach (var from in new[] { A, B, C })
                {
                    var reached = new List<string>();
                    foreach (var to in new[] { A, B, C })
                    {
                        if (from == to)
                        {
                            _host!.SetCentreDelay(from, to, 0);
                            reached.Add(to);
                            continue;
                        }
                        if (_unrouted is (string x, string y) && ((x == from && y == to) || (x == to && y == from)))
                        {
                            continue;
                        }
                        var seconds = Separations.TryGetValue((from, to), out var s) ? s : Separations[(to, from)];
                        _host!.SetCentreDelay(from, to, seconds);
                        reached.Add(to);
                    }
                    routes[from] = reached;
                }
                ((ICentreRouteWriter)_host!).SetCentreRoutes(routes);
            }
        }

        private sealed class StaticSource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;

            public StaticSource(string id) => _centre = new Centre(id);

            public string ProviderId => "static-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return _centre;
            }

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
