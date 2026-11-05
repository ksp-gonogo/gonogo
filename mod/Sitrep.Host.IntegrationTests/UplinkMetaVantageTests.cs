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
    /// An Uplink opens one of its own commands to the meta vantage through
    /// <see cref="CommandDeclaration.AllowMetaVantage"/>. Every other Uplink command
    /// sent from meta is refused, and an Uplink cannot open a command another Uplink owns.
    /// </summary>
    public class UplinkMetaVantageTests
    {
        private static readonly System.TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task MetaVantage_AcceptsACommandItsUplinkDeclaresAndRefusesOneItDoesNot()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new QuoteUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SendAsync(client, "r1", QuoteUplink.Quote);
                var answered = await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
                Assert.Equal("r1", answered.RequestId);

                await SendAsync(client, "r2", QuoteUplink.Change);
                var refused = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("r2", refused.RequestId);
                Assert.Equal(FaultCode.UnknownVantage, refused.Code);
                Assert.Equal(MetaVantageCommands.RefusalFor(QuoteUplink.Change), refused.Message);

                Assert.Equal(new[] { QuoteUplink.Quote + "@meta" }, uplink.Seen);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task MetaVantage_CannotBeOpenedOnACommandAnotherUplinkOwns()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var owner = new QuoteUplink();
            engine.RegisterUplink(owner);
            engine.RegisterUplink(new HijackUplink());
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                Assert.False(engine.AvailabilityOf(HijackUplink.UplinkId).IsAvailable);
                Assert.Contains(QuoteUplink.Change, engine.AvailabilityOf(HijackUplink.UplinkId).Reason);

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendAsync(client, "r1", QuoteUplink.Change);
                var refused = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal(FaultCode.UnknownVantage, refused.Code);
                Assert.Empty(owner.Seen);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static Task SendAsync(TestClient client, string requestId, string command) =>
            client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = command,
                Vantage = ChannelEngine.MetaVantage,
                Args = null,
                SentAt = 0.0,
            }));

        private sealed class QuoteUplink : ISitrepUplink
        {
            public const string UplinkId = "test-meta-quote";
            public const string Quote = "test-meta-quote.price";
            public const string Change = "test-meta-quote.start";

            private readonly List<string> _seen = new List<string>();

            public IReadOnlyList<string> Seen
            {
                get { lock (_seen) { return _seen.ToArray(); } }
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Quote, Delay = DelayRole.TrueNow, AllowMetaVantage = true },
                    new CommandDeclaration { Command = Change, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                foreach (var command in Manifest.Commands.Select(c => c.Command))
                {
                    host.AddVantageCommandHandler<object?, object?>(command, (_, vantage) =>
                    {
                        lock (_seen) { _seen.Add(command + "@" + vantage); }
                        return null;
                    });
                }
            }
        }

        private sealed class HijackUplink : ISitrepUplink
        {
            public const string UplinkId = "test-meta-hijack";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = QuoteUplink.Change, Delay = DelayRole.TrueNow, AllowMetaVantage = true },
                },
            };

            public void Register(IUplinkHost host)
            {
            }
        }
    }
}
