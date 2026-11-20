using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The mode the dashboard is in, over real connections: one screen enters a
    /// mode and moves its timeline, and another reads the same state.
    /// </summary>
    public class ModeStateTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private static async Task<string> AskAsync(TestClient client, string requestId, string command, object args)
        {
            await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = command,
                // Every screen sends its mode commands from the meta vantage, so the tests do too.
                Vantage = ChannelEngine.MetaVantage,
                Args = args,
                SentAt = 0.0,
            }));
            return await ReceiveRawWhereAsync(client, Timeout, "the answer to " + requestId,
                raw => raw.Contains("\"requestId\":\"" + requestId + "\"") && raw.Contains("command-response"));
        }

        private static Task<string> StateWhereAsync(TestClient client, string what, string fragment) =>
            ReceiveRawWhereAsync(client, Timeout, what,
                raw => raw.Contains("\"topic\":\"mode.state\"") && raw.Contains(fragment));

        [Fact]
        public async Task OneScreenEntersAModeAndMovesItsTimeline_AndAnotherReadsTheSameState()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            engine.SetGameState(GamePhase.Ready, "FLIGHT");
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var main = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var other = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(other, ChannelEngine.ModeStateTopic, Timeout);
                engine.TickAndWait(1.0, null, Timeout);
                await StateWhereAsync(other, "the live mode", "\"mode\":\"live\"");

                Assert.Contains("\"success\":true", await AskAsync(main, "m1", "mode.enter",
                    new Dictionary<string, object?> { ["mode"] = "replay" }));
                engine.TickAndWait(2.0, null, Timeout);
                var entered = await StateWhereAsync(other, "the entered mode", "\"mode\":\"replay\"");
                Assert.Contains("\"answers\":\"craft\",\"modelled\":false", entered);
                Assert.Contains("\"timeline\":null", entered);

                Assert.Contains("\"success\":true", await AskAsync(main, "m2", "mode.timeline.setRange",
                    new Dictionary<string, object?>
                    {
                        ["mode"] = "replay",
                        ["startUt"] = 1000.0,
                        ["endUt"] = 4000.0,
                        ["marks"] = new List<object?> { new Dictionary<string, object?> { ["ut"] = 2000.0, ["label"] = "Node 1" } },
                    }));
                Assert.Contains("\"success\":true", await AskAsync(main, "m3", "mode.timeline.seek",
                    new Dictionary<string, object?> { ["mode"] = "replay", ["ut"] = 2500.0 }));
                engine.TickAndWait(3.0, null, Timeout);
                var moved = await StateWhereAsync(other, "the moved timeline", "\"atUt\":2500");
                Assert.Contains("\"label\":\"Node 1\"", moved);
                Assert.Contains("\"playing\":false", moved);

                Assert.Contains("\"success\":false", await AskAsync(main, "m4", "mode.timeline.seek",
                    new Dictionary<string, object?> { ["mode"] = "live", ["ut"] = 1.0 }));

                Assert.Contains("\"success\":true", await AskAsync(main, "m5", "mode.exit",
                    new Dictionary<string, object?> { ["mode"] = "replay" }));
                engine.TickAndWait(4.0, null, Timeout);
                await StateWhereAsync(other, "live again", "\"mode\":\"live\"");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnEnteredModeEndsOnceNoScreenHasBeenConnectedForTheGrace_AndNotDuringAReload()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.LastScreenGraceSeconds = 1.5;
            engine.Start();
            engine.SetGameState(GamePhase.Ready, "FLIGHT");
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using (var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    Assert.Contains("\"success\":true", await AskAsync(first, "g1", "mode.enter",
                        new Dictionary<string, object?> { ["mode"] = "replay" }));
                }

                // A page that reloads is back well inside the grace, and finds the mode as it left it.
                await Task.Delay(300);
                await using (var reloaded = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeAsync(reloaded, ChannelEngine.ModeStateTopic, Timeout);
                    await StateWhereAsync(reloaded, "the mode kept across a reload", "\"mode\":\"replay\"");
                }

                await Task.Delay(2500);
                await using var later = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(later, ChannelEngine.ModeStateTopic, Timeout);
                await StateWhereAsync(later, "live for the next screen to open", "\"mode\":\"live\"");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AClientThatDoesNotReadTheModeIsNotAScreen_AndDoesNotKeepAnEnteredModeOn()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.LastScreenGraceSeconds = 1.0;
            engine.Start();
            engine.SetGameState(GamePhase.Ready, "FLIGHT");
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                // Connected throughout and never reading the mode, as a client that only records is.
                await using var recorder = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await using (var screen = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeAsync(screen, ChannelEngine.ModeStateTopic, Timeout);
                    Assert.Contains("\"success\":true", await AskAsync(screen, "s1", "mode.enter",
                        new Dictionary<string, object?> { ["mode"] = "replay" }));
                }

                await Task.Delay(2500);
                await using var later = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(later, ChannelEngine.ModeStateTopic, Timeout);
                await StateWhereAsync(later, "live, with only the recorder left", "\"mode\":\"live\"");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ARateChosenWhileHeldReachesEveryScreenWithTheTimelineStillHeld()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            engine.SetGameState(GamePhase.Ready, "FLIGHT");
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var main = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var other = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(other, ChannelEngine.ModeStateTopic, Timeout);
                Assert.Contains("\"success\":true", await AskAsync(main, "r1", "mode.enter",
                    new Dictionary<string, object?> { ["mode"] = "replay" }));
                Assert.Contains("\"success\":true", await AskAsync(main, "r2", "mode.timeline.setRange",
                    new Dictionary<string, object?> { ["mode"] = "replay", ["startUt"] = 1000.0, ["endUt"] = 4000.0 }));
                Assert.Contains("\"success\":true", await AskAsync(main, "r3", "mode.timeline.pause",
                    new Dictionary<string, object?> { ["mode"] = "replay", ["rate"] = 10.0 }));
                engine.TickAndWait(1.0, null, Timeout);
                var held = await StateWhereAsync(other, "the chosen rate", "\"rate\":10");
                Assert.Contains("\"playing\":false", held);
                Assert.Contains("\"atUt\":1000", held);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Theory]
        [InlineData(GamePhase.NoGame, "MAINMENU")]
        [InlineData(GamePhase.Loading, "LOADING")]
        public async Task WithNoTickAtAll_AScreenLearnsTheModeAndWatchesItsTimelinePlay(GamePhase phase, string scene)
        {
            // The main menu and a loading save: the game runs no tick and its clock stands still.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            engine.SetGameState(phase, scene);
            try
            {
                await using var main = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var other = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(other, ChannelEngine.ModeStateTopic, Timeout);
                await StateWhereAsync(other, "the live mode on subscribing", "\"mode\":\"live\"");

                Assert.Contains("\"success\":true", await AskAsync(main, "n1", "mode.declare",
                    new Dictionary<string, object?>
                    {
                        ["id"] = "probe.replay",
                        ["name"] = "Replay",
                        ["activation"] = "entered",
                        ["timeline"] = "playback",
                    }));
                Assert.Contains("\"success\":true", await AskAsync(main, "n2", "mode.enter",
                    new Dictionary<string, object?> { ["mode"] = "probe.replay" }));
                await StateWhereAsync(other, "the entered mode", "\"mode\":\"probe.replay\"");

                Assert.Contains("\"success\":true", await AskAsync(main, "n3", "mode.timeline.setRange",
                    new Dictionary<string, object?> { ["mode"] = "probe.replay", ["startUt"] = 0.0, ["endUt"] = 100000.0 }));
                Assert.Contains("\"success\":true", await AskAsync(main, "n4", "mode.timeline.play",
                    new Dictionary<string, object?> { ["mode"] = "probe.replay", ["rate"] = 1000.0 }));
                var first = await StateWhereAsync(other, "the playing timeline", "\"playing\":true");

                // Said again as real time passes, further along each time, with nothing ticking.
                var later = await ReceiveRawWhereAsync(other, Timeout, "a later position",
                    raw => raw.Contains("\"topic\":\"mode.state\"") && raw.Contains("\"playing\":true") && AtUtOf(raw) > AtUtOf(first) + 500);
                Assert.True(AtUtOf(later) > AtUtOf(first));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static double AtUtOf(string raw)
        {
            var from = raw.IndexOf("\"atUt\":", StringComparison.Ordinal) + 7;
            var to = raw.IndexOfAny(new[] { ',', '}' }, from);
            return double.Parse(raw.Substring(from, to - from), System.Globalization.CultureInfo.InvariantCulture);
        }

        [Theory]
        [InlineData("mode.declare")]
        [InlineData("mode.enter")]
        [InlineData("mode.exit")]
        [InlineData("mode.setInput")]
        [InlineData("mode.timeline.seek")]
        [InlineData("mode.timeline.play")]
        [InlineData("mode.timeline.pause")]
        [InlineData("mode.timeline.setRange")]
        public async Task EveryModeCommandIsAnsweredFromTheMetaVantage(string command)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            engine.SetGameState(GamePhase.Ready, "FLIGHT");
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "v1",
                    Command = command,
                    Vantage = ChannelEngine.MetaVantage,
                    Args = new Dictionary<string, object?> { ["mode"] = "replay", ["id"] = "probe.mode", ["activation"] = "entered" },
                    SentAt = 0.0,
                }));
                // The board may refuse the request for its own reasons; what must never come back is the vantage being turned away.
                var answer = await ReceiveRawWhereAsync(client, Timeout, "any answer to " + command,
                    raw => raw.Contains("\"requestId\":\"v1\""));
                Assert.Contains("command-response", answer);
                Assert.DoesNotContain("unknownVantage", answer);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void TheModeCommandsTheEngineAnswersAreTheOnesTheContractOpensToTheMetaVantage()
        {
            var declared = new[]
            {
                "mode.declare", "mode.enter", "mode.exit", "mode.setInput",
                "mode.timeline.pause", "mode.timeline.play", "mode.timeline.seek", "mode.timeline.setRange",
            };
            foreach (var command in declared)
            {
                Assert.True(MetaVantageCommands.IsApproved(command), command);
            }
            Assert.Equal(declared, MetaVantageCommands.Approved.Where(c => c.StartsWith("mode.", StringComparison.Ordinal)));
        }

        [Fact]
        public async Task AClientWithNoModHalfDeclaresAMode_AndItIsListed()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Contains("\"success\":true", await AskAsync(client, "d1", "mode.declare",
                    new Dictionary<string, object?>
                    {
                        ["id"] = "my-uplink.sim",
                        ["name"] = "Simulation",
                        ["activation"] = "entered",
                        ["timeline"] = "scrub",
                        ["answers"] = "craft",
                        ["modelled"] = true,
                    }));
                Assert.Contains("\"success\":false", await AskAsync(client, "d2", "mode.declare",
                    new Dictionary<string, object?> { ["id"] = "live", ["activation"] = "always" }));

                await SubscribeAsync(client, ChannelEngine.ModesTopic, Timeout);
                engine.TickAndWait(1.0, null, Timeout);
                var listed = await ReceiveRawWhereAsync(client, Timeout, "the listing",
                    raw => raw.Contains("\"topic\":\"system.modes\""));
                Assert.Contains("\"id\":\"my-uplink.sim\"", listed);
                Assert.Contains("\"owner\":\"client\"", listed);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
