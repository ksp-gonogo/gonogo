using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Commcast;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Commcast through the real socket, at three command centres a signal delay
    /// apart: what each connection receives, and when, is what a third party with
    /// a WebSocket would see.
    ///
    /// <para>Separations: A to B 5 s, A to C 20 s, B to C 18 s, every pair routed
    /// unless a test says otherwise. UT advances only when a test ticks, so "not
    /// yet" is asserted one tick short of the signal delay and "now" on it.</para>
    /// </summary>
    public class CommcastEndToEndTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string A = "ground:a";
        private const string B = "ground:b";
        private const string C = "ground:c";
        private const string Seat = "vessel:probe";
        private const double SeatToA = 7;

        private static readonly Dictionary<(string, string), double> Separations = new()
        {
            [(A, B)] = 5,
            [(A, C)] = 20,
            [(B, C)] = 18,
        };




        [Fact]
        public async Task ANonMemberCannotSpeakToAGroup()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));

            var refused = await scene.CommandAsync(scene.C, CommcastUplink.SendCommand, Send("m1", "g1", "let me in"));
            Assert.False(refused.Success);
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
        /// signal delay from the speaker, and the stream starts for it at the first
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
            var (_, batch, _) = await NextRadioAsync(scene.C);
            Assert.Equal(500, batch.GetProperty("seq").GetInt32());
            await scene.C.AssertNoBinaryFrameArrivesAsync(Quiet);
        }



        [Fact]
        public void TheTwoLimitsAreNamedForWhatTheyCountAndSizedForIt()
        {
            Assert.NotSame(CommcastUplink.SaidBudget, CommcastUplink.AcknowledgedBudget);
            Assert.Equal(50, CommcastUplink.SaidBudget.Threshold);
            Assert.Equal(150, CommcastUplink.AcknowledgedBudget.Threshold);
            Assert.Contains("messages and membership changes", CommcastUplink.SaidBudget.Name);
            Assert.Contains("acknowledgements", CommcastUplink.AcknowledgedBudget.Name);
        }


        [Fact]
        public async Task AMessageCannotBeSaidAgainToACentreThatIsNotAMember()
        {
            await using var scene = await Scene.StartAsync();
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            var toOutsider = Send("m1", "g1", "psst");
            toOutsider["to"] = new List<object?> { C };

            Assert.False((await scene.CommandAsync(scene.A, CommcastUplink.SendCommand, toOutsider)).Success);

            scene.Tick(100);
            await scene.C.AssertNoMessageArrivesAsync(Quiet);
        }


        /// <summary>A message is a command from one centre to another: it lands in the recipient's ledger when its lane command does, and in no other.</summary>
        [Fact]
        public async Task AMessageLandsInTheRecipientsLedgerWhenItsCommandDoesAndInNoOthers()
        {
            await using var scene = await Scene.StartAsync(delivery: true, withLedger: true);
            scene.Inputs!.SetLinks(new Sitrep.Host.Comms.LiveLinkGraph(new[] { (B, C, 18.0) }));
            // The ledgers a screen is handed on subscribing arrive on the first tick.
            scene.Tick(1);
            await DrainAllStreamDataAsync(scene.A, Quiet);
            await DrainAllStreamDataAsync(scene.C, Quiet);
            await scene.CommandAsync(scene.B, CommcastUplink.OpenCommand, Open("g1", C));
            await scene.CommandAsync(scene.B, CommcastUplink.SendCommand, Send("m1", "g1", "hello"));

            scene.Tick(17);
            Assert.DoesNotContain(await DrainAllStreamDataAsync(scene.C, Quiet), f => f.Topic == CommcastUplink.LedgerTopic && Items(f.Payload).Count > 0);

            scene.Tick(19);
            var ledger = await LedgerWhereAsync(scene.C, items => HasText(items, "hello"));
            var text = TextOf(ledger, "hello")!;
            Assert.Equal(B, text["from"]);
            Assert.Equal(19.0, Math.Round(Convert.ToDouble(text["arrivedUt"])), 0);
            Assert.Contains(ledger, i => (string?)i["kind"] == "members");
            Assert.DoesNotContain(await DrainAllStreamDataAsync(scene.A, Quiet), f => f.Topic == CommcastUplink.LedgerTopic && Items(f.Payload).Count > 0);
        }

        /// <summary>What a centre said is in its own ledger at once, for every screen there, with how each recipient stands.</summary>
        [Fact]
        public async Task WhatACentreSaidIsInItsOwnLedgerAtOnceForEveryScreenThere()
        {
            await using var scene = await Scene.StartAsync(delivery: true, withLedger: true);
            await scene.CommandAsync(scene.B, CommcastUplink.OpenCommand, Open("g1", C));
            await scene.ReceiptAsync(scene.B, Send("m1", "g1", "hello"));

            var colleague = await scene.OpenScreenAtAsync(B);
            scene.Tick(1);
            var ledger = await LedgerWhereAsync(colleague, items => HasText(items, "hello"));
            var text = TextOf(ledger, "hello")!;
            Assert.False(text.ContainsKey("arrivedUt"));
            Assert.Equal(new[] { B, C }, Strings(text["to"]));
        }

        /// <summary>
        /// The operator's scenario: a message to a centre nobody sits at waits for a
        /// path, outlives the hour a command lasts, and a screen that opens there
        /// later finds the group and the words in that centre's ledger.
        /// </summary>
        [Fact]
        public async Task AMessageToAnEmptyCentreWaitsForAPathAndIsInItsLedgerForAScreenThatOpensThereAnHourLater()
        {
            await using var scene = await Scene.StartAsync(unrouted: (B, C), delivery: true, subscribeC: false);
            Assert.True((await scene.CommandAsync(scene.B, CommcastUplink.OpenCommand, Open("g1", C))).Success);
            var receipt = await scene.ReceiptAsync(scene.B, Send("m1", "g1", "hello"));
            Assert.Equal(new[] { B }, Strings(receipt["addressed"]));
            Assert.Equal(new[] { C }, Strings(receipt["queued"]));

            // The words are in the speaker's uplink queue, to be cancelled from there.
            var queue = Assert.IsType<PendingUplinkQueue>(scene.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic));
            Assert.Contains(queue.Pending, p => p.Vantage == B && p.Craft == C && p.Label == "hello");

            // An hour with no path, and a centre outside the group hears nothing.
            var bystander = await scene.OpenScreenAtAsync(A);
            scene.Tick(3700);
            await DrainAllStreamDataAsync(bystander, Quiet);

            // The path opens and the command lands.
            scene.Inputs!.SetLinks(new Sitrep.Host.Comms.LiveLinkGraph(new[] { (B, C, 20.0) }));
            scene.Tick(3701);
            scene.Tick(3730);

            // A screen sits down at the centre and is handed its ledger, with the group in it.
            var screen = await scene.OpenScreenAtAsync(C);
            scene.Tick(3731);
            var ledger = await LedgerWhereAsync(screen, items => HasText(items, "hello"));
            Assert.Equal(B, TextOf(ledger, "hello")!["from"]);
            Assert.Contains(ledger, i => (string?)i["kind"] == "members" && Strings(i["members"]).Contains(C));

            // Every screen there is handed the same.
            var second = await scene.OpenScreenAtAsync(C);
            scene.Tick(3732);
            Assert.True(HasText(await LedgerWhereAsync(second, items => HasText(items, "hello")), "hello"));
        }

        /// <summary>The ledger is kept with the game: a restart from the save still holds the waiting message, and a save from before it was sent holds nothing.</summary>
        [Fact]
        public async Task AMessageKeptForACentreSurvivesASaveAndALoadAndIsGoneFromATimelineBeforeItWasSent()
        {
            await using var before = await Scene.StartAsync(unrouted: (B, C), delivery: true, subscribeC: false);
            var beforeSend = before.Saved();
            Assert.True((await before.CommandAsync(before.B, CommcastUplink.OpenCommand, Open("g1", C))).Success);
            await before.ReceiptAsync(before.B, Send("m1", "g1", "hello"));
            before.Tick(10);
            var afterSend = before.Saved();
            Assert.True(afterSend.Sections.ContainsKey("commcast"));

            await using var restarted = await Scene.StartAsync(unrouted: (B, C), delivery: true, subscribeC: false);
            restarted.Load(afterSend, savedUt: 10);
            var queue = Assert.IsType<PendingUplinkQueue>(restarted.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic));
            Assert.Contains(queue.Pending, p => p.Vantage == B && p.Craft == C);
            restarted.Inputs!.SetLinks(new Sitrep.Host.Comms.LiveLinkGraph(new[] { (B, C, 20.0) }));
            restarted.Tick(4000);
            restarted.Tick(4030);
            var screen = await restarted.OpenScreenAtAsync(C);
            restarted.Tick(4031);
            Assert.True(HasText(await LedgerWhereAsync(screen, items => HasText(items, "hello")), "hello"));

            await using var earlier = await Scene.StartAsync(unrouted: (B, C), delivery: true, subscribeC: false);
            earlier.Load(beforeSend, savedUt: 0);
            earlier.Inputs!.SetLinks(new Sitrep.Host.Comms.LiveLinkGraph(new[] { (B, C, 20.0) }));
            earlier.Tick(4000);
            earlier.Tick(4030);
            var empty = await earlier.OpenScreenAtAsync(C);
            earlier.Tick(4031);
            var told = await LedgerWhereAsync(empty, _ => true);
            Assert.Empty(told);
        }

        /// <summary>Delivery and reading are two things: the sender's ledger learns that the command ran when the reply is home, and that a screen read it when that notice is.</summary>
        [Fact]
        public async Task TheSendersLedgerLearnsOfDeliveryAndOfReadingSeparately()
        {
            await using var scene = await Scene.StartAsync(delivery: true, withLedger: true);
            scene.Inputs!.SetLinks(new Sitrep.Host.Comms.LiveLinkGraph(new[] { (B, C, 18.0) }));
            await scene.CommandAsync(scene.B, CommcastUplink.OpenCommand, Open("g1", C));
            await scene.CommandAsync(scene.B, CommcastUplink.SendCommand, Send("m1", "g1", "hello"));
            scene.Tick(19);
            await LedgerWhereAsync(scene.C, items => HasText(items, "hello"));

            // A screen at the recipient reads it.
            var read = new Dictionary<string, object?>
            {
                ["messageId"] = "m1",
                ["author"] = new Dictionary<string, object?> { ["name"] = "Capcom", ["stationKey"] = "screen-c", ["seat"] = "mission-control" },
            };
            Assert.True((await scene.CommandAsync(scene.C, CommcastUplink.AckCommand, read)).Success);

            scene.Tick(38);
            var ledger = await LedgerWhereAsync(scene.B, items => TextOf(items, "hello")?.ContainsKey("delivered") == true && TextOf(items, "hello")?.ContainsKey("read") == true);
            var text = TextOf(ledger, "hello")!;
            Assert.True(((IDictionary<string, object?>)text["delivered"]!).ContainsKey(C));
            var readBy = (IDictionary<string, object?>)text["read"]!;
            Assert.Equal("screen-c", (string?)((IDictionary<string, object?>)readBy[C]!)["stationKey"]);
        }

        /// <summary>Like any command, a message can be cancelled from the sender's uplink queue before it reaches the recipient, and then never does.</summary>
        [Fact]
        public async Task AMessageCancelledBeforeItReachesItsRecipientNeverDoes()
        {
            await using var scene = await Scene.StartAsync(unrouted: (B, C), delivery: true, withLedger: true);
            await scene.CommandAsync(scene.B, CommcastUplink.OpenCommand, Open("g1", C));
            await scene.ReceiptAsync(scene.B, Send("m1", "g1", "hello"));
            var queue = Assert.IsType<PendingUplinkQueue>(scene.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic));
            var waiting = Assert.Single(queue.Pending, p => p.Label == "hello");

            object? reply = null;
            var cancel = new UplinkCancelRequest { Epoch = scene.Engine.JourneyAt(B).Epoch, Craft = C, LaneSeq = waiting.LaneSeq ?? 1 };
            scene.Engine.DispatchCommandAndWait(ChannelEngine.UplinkCancelCommand, cancel, B, r => reply = r, Timeout);
            scene.Tick(10);
            Assert.IsType<CommandResult<UplinkActionReply>>(reply);

            scene.Inputs!.SetLinks(new Sitrep.Host.Comms.LiveLinkGraph(new[] { (B, C, 20.0) }));
            scene.Tick(30);
            scene.Tick(60);
            var ledger = await LedgerWhereAsync(scene.B, items => TextOf(items, "hello")?.ContainsKey("ended") == true);
            Assert.Equal("cancelled", (string?)((IDictionary<string, object?>)TextOf(ledger, "hello")!["ended"]!)[C]);
            var heard = await DrainAllStreamDataAsync(scene.C, Quiet);
            Assert.DoesNotContain(heard, f => f.Topic == CommcastUplink.LedgerTopic && HasText(Items(f.Payload), "hello"));
        }

        [Fact]
        public async Task TheDelayExemptionCannotSpeak()
        {
            await using var scene = await Scene.StartAsync();
            await scene.A.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = "meta-open",
                Command = CommcastUplink.OpenCommand,
                Vantage = ChannelEngine.MetaVantage,
                Args = Open("g1", B),
                SentAt = 0.0,
            }));
            var refused = await ReceiveTypedAsync<ErrorMsg>(scene.A, Timeout);
            Assert.Equal("meta-open", refused.RequestId);
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
        /// A group is joined by invitation only. Detecting a transmission, even
        /// once it has reached this vantage, grants no right to add yourself.
        /// </summary>
        [Fact]
        public async Task AVantageTheTransmissionHasReachedCannotAddItself()
        {
            await using var scene = await Scene.StartAsync(discovery: true);
            await scene.CommandAsync(scene.A, CommcastUplink.OpenCommand, Open("g1", B));
            await scene.CommandAsync(scene.A, CommcastUplink.TransmitCommand, Transmit("t1", "g1", 0, OneChunk));
            var selfAdd = new Dictionary<string, object?> { ["groupId"] = "g1", ["added"] = new List<object?> { C } };

            scene.Tick(20);
            Assert.False((await scene.CommandAsync(scene.C, CommcastUplink.AddCommand, selfAdd)).Success);

            scene.Tick(100);
            await scene.C.AssertNoBinaryFrameArrivesAsync(Quiet);
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

        /// <summary>The entries of a ledger payload.</summary>
        private static List<Dictionary<string, object?>> Items(object? payload) =>
            ((IEnumerable<object?>)((Dictionary<string, object?>)payload!)["items"]!).Select(o => (Dictionary<string, object?>)o!).ToList();

        /// <summary>Reads the next ledger a screen is told until one satisfies <paramref name="ready"/>, and returns it.</summary>
        private static async Task<List<Dictionary<string, object?>>> LedgerWhereAsync(TestClient client, Func<List<Dictionary<string, object?>>, bool> ready)
        {
            while (true)
            {
                var data = await ReceiveStreamDataAsync(client, Timeout);
                if (data.Topic != CommcastUplink.LedgerTopic)
                {
                    continue;
                }
                var items = Items(data.Payload);
                if (ready(items))
                {
                    return items;
                }
            }
        }

        private static Dictionary<string, object?>? TextOf(List<Dictionary<string, object?>> items, string body) =>
            items.FirstOrDefault(i => (string?)i["kind"] == "text" && (string?)i["body"] == body);

        private static bool HasText(List<Dictionary<string, object?>> items, string body) => TextOf(items, body) != null;

        private static string[] Strings(object? list) =>
            ((IEnumerable<object?>)list!).Select(o => (string)o!).ToArray();


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
            private bool _withLedger;
            internal ChannelEngine Engine => _engine;
            private LedgerUplink _ledger = null!;

            public TestClient A { get; private set; } = null!;
            public TestClient B { get; private set; } = null!;
            public TestClient C { get; private set; } = null!;

            private readonly List<TestClient> _extra = new();

            /// <summary>What store-and-forward delivery reads of the game's links, when a scene was started with delivery.</summary>
            public Sitrep.Host.Comms.DeliveryInputs? Inputs { get; private set; }

            private Scene(ChannelEngine engine) => _engine = engine;

            public static async Task<Scene> StartAsync((string, string)? unrouted = null, bool subscribeB = true, bool discovery = false, string? seatReaches = null, bool seat = false, bool delivery = false, bool subscribeC = true, bool withLedger = false)
            {
                var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
                var inputs = delivery ? new Sitrep.Host.Comms.DeliveryInputs() : null;
                if (inputs != null)
                {
                    engine.SetDeliveryInputs(inputs);
                }
                foreach (var id in new[] { CommcastEndToEndTests.A, CommcastEndToEndTests.B, CommcastEndToEndTests.C })
                {
                    engine.RegisterCommandCentreSource(new StaticSource(id));
                }
                if (seat)
                {
                    engine.RegisterCommandCentreSeatSource(new SeatCentreSource());
                }
                var ledger = new LedgerUplink(unrouted, seat ? seatReaches ?? "" : null);
                engine.RegisterUplink(ledger);
                engine.RegisterUplink(new CommcastUplink());
                engine.Start();
                var scene = new Scene(engine) { _discovery = discovery, _ledger = ledger, Inputs = inputs, _withLedger = withLedger };
                scene.Tick(0);
                scene.A = await scene.ConnectAtAsync(CommcastEndToEndTests.A, subscribe: true);
                scene.B = await scene.ConnectAtAsync(CommcastEndToEndTests.B, subscribe: subscribeB);
                scene.C = await scene.ConnectAtAsync(CommcastEndToEndTests.C, subscribe: subscribeC);
                return scene;
            }

            /// <summary>A new screen sits down at <paramref name="centre"/> and subscribes to its traffic; what the host says on subscribing is delivered on the next tick.</summary>
            public async Task<TestClient> OpenScreenAtAsync(string centre)
            {
                var client = await ConnectAtAsync(centre, subscribe: true, forceLedger: true);
                _extra.Add(client);
                return client;
            }

            /// <summary>What a save written now would carry, as the save file holds it.</summary>
            public DeliverySnapshot Saved() =>
                Sitrep.Host.Comms.DeliverySnapshotCodec.Decode(Sitrep.Host.Comms.DeliverySnapshotCodec.Encode(_engine.DeliverySnapshotNow()))!;

            /// <summary>The game loads <paramref name="saved"/>, written at <paramref name="savedUt"/>.</summary>
            public void Load(DeliverySnapshot saved, double savedUt)
            {
                _engine.NoteGameLoaded(saved, null, savedUt, "save-a", "token-" + savedUt);
                Tick(savedUt);
            }

            public void Tick(double ut) => _engine.TickAndWait(ut, null, Timeout);

            /// <summary>Ticks to <paramref name="ut"/> as a tick that belongs to the save folder <paramref name="save"/>.</summary>
            public void Tick(double ut, string save)
            {
                _engine.NoteSave(save);
                Tick(ut);
            }

            /// <summary>Changes how far apart two centres are, from the next tick.</summary>
            public void Shorten(string a, string b, double seconds) => _ledger.Override(a, b, seconds);

            /// <summary>Sends a message and returns what the mod said it did with it.</summary>
            public async Task<Dictionary<string, object?>> ReceiptAsync(TestClient client, Dictionary<string, object?> send, string? vantage = null)
            {
                var result = await ResultAsync(client, CommcastUplink.SendCommand, send, vantage);
                Assert.True((bool)result["success"]!);
                Assert.True(result.ContainsKey("payload"), "the send returned no receipt");
                return (Dictionary<string, object?>)result["payload"]!;
            }

            public async Task<CommandResult> CommandAsync(TestClient client, string command, Dictionary<string, object?> args, string? vantage = null) =>
                new CommandResult { Success = (bool)(await ResultAsync(client, command, args, vantage))["success"]! };

            private async Task<Dictionary<string, object?>> ResultAsync(TestClient client, string command, Dictionary<string, object?> args, string? vantage)
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
                    return (Dictionary<string, object?>)response.Result!;
                }
            }

            private async Task<TestClient> ConnectAtAsync(string centre, bool subscribe, bool forceLedger = false)
            {
                var client = await TestClient.ConnectAsync(_engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
                if (subscribe)
                {
                    if (_withLedger || forceLedger)
                    {
                        Assert.Equal("subscribed", (await SubscribeAsync(client, CommcastUplink.LedgerTopic, Timeout)).Name);
                    }
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
                foreach (var extra in _extra)
                {
                    await extra.DisposeAsync();
                }
                _engine.Stop();
                _engine.Dispose();
            }
        }

        /// <summary>Writes the separations above into the ledger, and their routes, on every tick.</summary>
        private sealed class LedgerUplink : ISitrepUplink
        {
            private readonly (string, string)? _unrouted;
            private readonly Dictionary<(string, string), double> _overridden = new();
            private IUplinkHost? _host;

            public void Override(string a, string b, double seconds)
            {
                lock (_overridden)
                {
                    _overridden[(a, b)] = seconds;
                    _overridden[(b, a)] = seconds;
                }
            }

            private readonly string? _seatReaches;

            public LedgerUplink((string, string)? unrouted, string? seatReaches = null)
            {
                _unrouted = unrouted;
                _seatReaches = seatReaches;
            }

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
                        lock (_overridden)
                        {
                            if (_overridden.TryGetValue((from, to), out var changed))
                            {
                                seconds = changed;
                            }
                        }
                        _host!.SetCentreDelay(from, to, seconds);
                        reached.Add(to);
                    }
                    routes[from] = reached;
                }
                if (_seatReaches != null)
                {
                    // Written as the delay Uplink writes a seat: an origin only, never a destination.
                    var seatRoutes = new List<string>();
                    if (_seatReaches.Length > 0)
                    {
                        _host!.SetCentreDelay(Seat, _seatReaches, SeatToA);
                        seatRoutes.Add(_seatReaches);
                    }
                    routes[Seat] = seatRoutes;
                }
                ((ICentreRouteWriter)_host!).SetCentreRoutes(routes);
            }
        }

        private sealed class SeatCentreSource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre = new SeatCentre();

            public string ProviderId => "seat-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return _centre;
            }

            private sealed class SeatCentre : ICommandCentre
            {
                public string Id => Seat;
                public string DisplayName => Seat;
                public CommandCentreKind Kind => CommandCentreKind.CrewedVessel;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
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
