using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command-request naming a known, active ground centre as its vantage runs
    /// from that centre and is answered, as the same request with no vantage is,
    /// when the craft it addresses is reachable.
    /// </summary>
    public class CommandVantageOverrideAnswerTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private const string Centre = "ground:Crater Rim Station";
        private const string RequestId = "rig-probe-2";

        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public async Task AThrottleToAReachableCraft_IsAnswered_WithOrWithoutAKnownCentreAsItsVantage(bool withVantage)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new ThrottleUplink();
            engine.RegisterCommandCentreSource(new CentreSource());
            engine.RegisterUplink(uplink);
            engine.ResolveCapabilities();
            engine.Start();
            Tick(engine, 0.0);
            Tick(engine, 1.0);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(
                    "{\"type\":\"command-request\",\"requestId\":\"" + RequestId + "\",\"command\":\"" + ThrottleUplink.Command
                    + "\",\"label\":\"" + ThrottleUplink.Command + "\",\"topic\":\"\",\"vantage\":\"" + (withVantage ? Centre : "")
                    + "\",\"args\":{\"value\":0},\"sentAt\":0}");

                using var ticking = new CancellationTokenSource();
                var ticker = Task.Run(async () =>
                {
                    for (var ut = 2.0; !ticking.IsCancellationRequested; ut += 1.0)
                    {
                        Tick(engine, ut);
                        await Task.Delay(50);
                    }
                });
                string answer;
                try
                {
                    answer = await ReceiveAnswerAsync(client);
                }
                finally
                {
                    ticking.Cancel();
                    await ticker;
                }

                Assert.Contains("\"requestId\":\"" + RequestId + "\"", answer);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task<string> ReceiveAnswerAsync(TestClient client)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (true)
            {
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero)
                {
                    throw new TimeoutException("The command-request was never answered.");
                }
                var text = await client.ReceiveAsync(remaining);
                if (text.Contains("\"requestId\":\"" + RequestId + "\""))
                {
                    return text;
                }
            }
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, Timeout);

        private sealed class ThrottleUplink : ISitrepUplink
        {
            public const string Command = "vessel.control.setThrottle";
            private const string Topic = "vantage-answer-test.state";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "vantage-override-answer-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<Dictionary<string, object?>, string>(Command, _ => "throttled");
                host.AddChannelSource(Topic, _ => null);
                host.SetConnectivitySource(_ => true);
            }
        }

        private sealed class CentreSource : ICommandCentreSource
        {
            public string ProviderId => "vantage-override-answer-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return new Centre();
            }

            private sealed class Centre : ICommandCentre
            {
                public string Id => CommandVantageOverrideAnswerTests.Centre;
                public string DisplayName => "Crater Rim Station";
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
