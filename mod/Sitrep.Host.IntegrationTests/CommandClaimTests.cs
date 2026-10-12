using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A client whose connection closed while its command was on its way gets
    /// the command's outcome on a later connection by naming the request id in
    /// a claim, and only by naming it. Sent at UT 0 with a five-second signal
    /// delay, a command runs at 5 and its answer is home at 10.
    /// </summary>
    public class CommandClaimTests
    {
        private const double Delay = 5.0;

        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task AClaimDeliversAnOutcomeThatCameWhileNoConnectionWasOpen()
        {
            using var engine = NewEngine();
            try
            {
                Tick(engine, 0.0);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendCommandAsync(first, "client-1");
                await ReceiveTypedAsync<CommandAccepted>(first, Timeout);
                await first.DisposeAsync();
                await WaitForAsync(() => engine.SessionCountForTests == 0);

                Tick(engine, 10.0);

                await using var next = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await next.SendAsync(Claim("client-1"));
                var answer = await ReceiveTypedAsync<CommandResponse<object?>>(next, Timeout);
                Assert.Equal("client-1", answer.RequestId);
                Assert.Equal("ran:x", answer.Result);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AClaimMadeWhileTheCommandIsStillOnItsWayReceivesTheOutcomeWhenItComes()
        {
            using var engine = NewEngine();
            try
            {
                Tick(engine, 0.0);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendCommandAsync(first, "client-2");
                await ReceiveTypedAsync<CommandAccepted>(first, Timeout);
                await first.DisposeAsync();
                await WaitForAsync(() => engine.SessionCountForTests == 0);

                await using var next = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await next.SendAsync(Claim("client-2"));
                await WaitForAsync(() => engine.ClaimsHandledForTests >= 1);
                await next.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(100));

                Tick(engine, 10.0);

                var answer = await ReceiveTypedAsync<CommandResponse<object?>>(next, Timeout);
                Assert.Equal("client-2", answer.RequestId);
                Assert.Equal("ran:x", answer.Result);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnOutcomeIsNotSentToAConnectionThatDidNotClaimIt()
        {
            using var engine = NewEngine();
            try
            {
                Tick(engine, 0.0);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendCommandAsync(first, "client-3");
                await ReceiveTypedAsync<CommandAccepted>(first, Timeout);
                await first.DisposeAsync();
                await WaitForAsync(() => engine.SessionCountForTests == 0);

                await using var bystander = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                Tick(engine, 10.0);
                await bystander.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(200));

                await using var later = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await later.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(200));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnOutcomeIsSentOnceAndForgottenWhenClaimed()
        {
            using var engine = NewEngine();
            try
            {
                Tick(engine, 0.0);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendCommandAsync(first, "client-4");
                await ReceiveTypedAsync<CommandAccepted>(first, Timeout);
                await first.DisposeAsync();
                await WaitForAsync(() => engine.SessionCountForTests == 0);
                Tick(engine, 10.0);

                await using var next = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await next.SendAsync(Claim("client-4"));
                await ReceiveTypedAsync<CommandResponse<object?>>(next, Timeout);

                await next.SendAsync(Claim("client-4"));
                var again = await ReceiveTypedAsync<ErrorMsg>(next, Timeout);
                Assert.Equal("client-4", again.RequestId);
                Assert.Equal(FaultCode.ReplyNotReceived, again.Code);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AClaimForAnIdTheGameNeverSawIsAnsweredWithAnError()
        {
            using var engine = NewEngine();
            try
            {
                Tick(engine, 0.0);
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendCommandAsync(client, "sent");
                await ReceiveTypedAsync<CommandAccepted>(client, Timeout);
                await client.SendAsync(Claim("never-sent"));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("never-sent", error.RequestId);
                Assert.Equal(FaultCode.ReplyNotReceived, error.Code);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnOutcomeIsKeptOnlyUntilItsCommandExpires()
        {
            using var engine = NewEngine();
            try
            {
                Tick(engine, 0.0);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendCommandAsync(first, "client-5");
                await ReceiveTypedAsync<CommandAccepted>(first, Timeout);
                await first.DisposeAsync();
                await WaitForAsync(() => engine.SessionCountForTests == 0);
                Tick(engine, 10.0);

                Tick(engine, 10.0 + 2 * Sitrep.Core.StoreAndForward.DeliveryNetwork.CommandLifetimeSeconds);

                await using var next = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await next.SendAsync(Claim("client-5"));
                var error = await ReceiveTypedAsync<ErrorMsg>(next, Timeout);
                Assert.Equal(FaultCode.ReplyNotReceived, error.Code);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheOldestOutcomesGoFirstWhenMoreAreKeptThanTheBoundAllows()
        {
            using var engine = NewEngine();
            try
            {
                Tick(engine, 0.0);
                var cap = ChannelEngine.StoredOutcomeCapForTests;
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var ids = new List<string>();
                for (var i = 0; i < cap + 2; i++)
                {
                    ids.Add("bulk-" + i);
                    await SendCommandAsync(first, ids[i]);
                }
                await WaitForAsync(() => engine.ReplyRouteCountForTests >= cap + 2);
                await first.DisposeAsync();
                await WaitForAsync(() => engine.SessionCountForTests == 0);
                Tick(engine, 10.0);

                await using var next = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await next.SendAsync(Claim(ids.ToArray()));
                var gone = new List<string>();
                var delivered = new List<string>();
                for (var i = 0; i < ids.Count; i++)
                {
                    var frame = EnvelopeCodec.ParseServerMessage(await next.ReceiveAsync(Timeout));
                    switch (frame)
                    {
                        case CommandResponse<object?> response:
                            delivered.Add(response.RequestId);
                            break;
                        case ErrorMsg error when error.Code == FaultCode.ReplyNotReceived:
                            gone.Add(error.RequestId);
                            break;
                        default:
                            i--;
                            break;
                    }
                }

                Assert.Equal(cap, delivered.Count);
                Assert.Equal(new[] { "bulk-0", "bulk-1" }, gone);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine NewEngine()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LiveCommandTestUplink());
            engine.Start();
            return engine;
        }

        private static string Claim(params string[] ids) =>
            EnvelopeCodec.WriteClaim(new ClaimRequest { RequestIds = new List<string>(ids) });

        private static Task SendCommandAsync(TestClient client, string requestId) =>
            client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = LiveCommandTestUplink.Command,
                Args = "x",
                SentAt = 0.0,
            }));

        private static async Task WaitForAsync(Func<bool> condition)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (!condition())
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException("The engine did not reach the awaited state within " + Timeout + ".");
                }
                await Task.Delay(10);
            }
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, LiveCommandTestUplink.Snapshot(ut), Timeout);

        /// <summary>One delayed command addressed to no craft, so it travels the live path.</summary>
        private sealed class LiveCommandTestUplink : ISitrepUplink
        {
            public const string Command = "claim-test.run";
            private const string Topic = "claim-test.state";

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "claim-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    { Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, _ => null);
                host.AddCommandHandler<string, string>(Command, args => "ran:" + args);
                host.SetConnectivitySource(_ => true);
                host.SetSignalDelaySource(_ => new CommsDelay
                {
                    OneWaySeconds = Delay,
                    Source = CommsDelaySource.SignalDelay,
                });
            }

            public static KspSnapshot Snapshot(double ut) =>
                new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() };
        }
    }
}
