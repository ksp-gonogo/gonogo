using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using static Sitrep.Host.IntegrationTests.WsTestHarness;
using Sitrep.Host.Hosting;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The host record over real connections: two screens asking for the role
    /// together, and a holder whose socket closing starts its grace.
    /// </summary>
    public class HostRecordTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private static string Request(string requestId, string command, object args) =>
            EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = command,
                Args = args,
                SentAt = 0.0,
            });

        private static async Task<string> AnswerAsync(TestClient client, string requestId)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (true)
            {
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero)
                {
                    throw new TimeoutException("no answer to " + requestId);
                }

                var raw = await client.ReceiveAsync(remaining);
                if (raw.Contains("\"requestId\":\"" + requestId + "\"") && raw.Contains("command-response"))
                {
                    return raw;
                }
            }
        }

        private static async Task<string> AskAsync(TestClient client, string requestId, string command, object args)
        {
            await client.SendAsync(Request(requestId, command, args));
            return await AnswerAsync(client, requestId);
        }

        [Fact]
        public async Task TwoClaimsArrivingTogetherOverTwoConnections_ExactlyOneWins()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                await using var a = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var b = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                for (var round = 0; round < 25; round++)
                {
                    var tokenA = "tab-a-" + round;
                    var tokenB = "tab-b-" + round;
                    var asks = await Task.WhenAll(
                        AskAsync(a, "a" + round, "host.claim", new Dictionary<string, object?> { ["token"] = tokenA }),
                        AskAsync(b, "b" + round, "host.claim", new Dictionary<string, object?> { ["token"] = tokenB }));

                    var winners = asks.Count(r => r.Contains("\"holds\":true"));
                    Assert.Equal(1, winners);
                    var loser = asks.Single(r => r.Contains("\"holds\":false"));
                    var winnerToken = asks[0].Contains("\"holds\":true") ? tokenA : tokenB;
                    Assert.Contains("\"holderId\":\"" + HostRecord.PublicId(winnerToken) + "\"", loser);

                    await AskAsync(a, "ra" + round, "host.release", new Dictionary<string, object?> { ["token"] = winnerToken });
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AHoldersSocketClosingStartsTheGrace_AndTheSameTokenTakesTheRoleBackOnANewConnection()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                await using var other = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Contains("\"holds\":true", await AskAsync(first, "c1", "host.claim", new Dictionary<string, object?> { ["token"] = "tab-a" }));


                var refused = await AskAsync(other, "c2", "host.claim", new Dictionary<string, object?> { ["token"] = "tab-b" });
                Assert.Contains("\"holds\":false", refused);
                Assert.Contains("\"holderId\":\"" + HostRecord.PublicId("tab-a") + "\"", refused);

                await first.DisposeAsync();

                await using var reloaded = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Assert.Contains("\"holds\":true", await AskAsync(reloaded, "c3", "host.claim", new Dictionary<string, object?> { ["token"] = "tab-a" }));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnotherScreenIsGrantedTheRoleAsSoonAsTheHoldersSocketHasClosed()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                await using var other = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await AskAsync(first, "d1", "host.claim", new Dictionary<string, object?> { ["token"] = "tab-a" });
                await first.DisposeAsync();

                var deadline = DateTime.UtcNow + Timeout;
                string answer;
                var n = 0;
                do
                {
                    await Task.Delay(50);
                    answer = await AskAsync(other, "d-b" + n++, "host.claim", new Dictionary<string, object?> { ["token"] = "tab-b" });
                }
                while (answer.Contains("\"holds\":false") && DateTime.UtcNow < deadline);

                Assert.Contains("\"holds\":true", answer);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ApproveCheckAndRevokeAnswerOverTheWire_AndNeverPublishTheCredential()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await AskAsync(client, "e1", "host.claim", new Dictionary<string, object?> { ["token"] = "tab-a" });

                Assert.Contains("\"success\":false", await AskAsync(client, "e2", "host.station.approve",
                    new Dictionary<string, object?> { ["token"] = "tab-x", ["credential"] = "station-secret", ["name"] = "Tablet" }));
                Assert.Contains("\"success\":true", await AskAsync(client, "e3", "host.station.approve",
                    new Dictionary<string, object?> { ["token"] = "tab-a", ["credential"] = "station-secret", ["name"] = "Tablet" }));

                var check = await AskAsync(client, "e4", "host.station.check", new Dictionary<string, object?> { ["token"] = "tab-a", ["credential"] = "station-secret" });
                Assert.Contains("\"approved\":true", check);
                Assert.DoesNotContain("station-secret", check);

                var record = JsonWriterText(HostRecordWire.BuildHostRecordModel(engine.HostRecordForTests));
                Assert.Contains("\"name\":\"Tablet\"", record);
                Assert.DoesNotContain("station-secret", record);
                Assert.DoesNotContain("tab-a\"", record);

                Assert.Contains("\"success\":true", await AskAsync(client, "e5", "host.station.revoke",
                    new Dictionary<string, object?> { ["token"] = "tab-a", ["stationId"] = HostRecord.PublicId("station-secret") }));
                Assert.Contains("\"approved\":false", await AskAsync(client, "e6", "host.station.check",
                    new Dictionary<string, object?> { ["token"] = "tab-a", ["credential"] = "station-secret" }));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static string JsonWriterText(object? node) => node switch
        {
            null => "",
            string text => text,
            System.Collections.Generic.IDictionary<string, object?> map =>
                string.Join(",", map.Select(p => "\"" + p.Key + "\":\"" + JsonWriterText(p.Value) + "\"")),
            System.Collections.IEnumerable list => string.Join(",", list.Cast<object?>().Select(JsonWriterText)),
            _ => node.ToString() ?? "",
        };
    }
}
