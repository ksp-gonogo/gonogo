using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A handler registered with <c>AddSessionCommandHandler</c> is told which
    /// connection sent the command and the correlation id it gave, and a channel's
    /// viewer filter sees the same session id, so a frame can be kept for the
    /// session that caused it.
    /// </summary>
    public class SessionCommandHandlerTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        [Theory]
        [InlineData(DelayRole.TrueNow)]
        [InlineData(DelayRole.Delayed)]
        public async Task AHandlerIsToldTheSendingSession_AndOnlyThatSessionIsShownWhatItPublished(DelayRole delay)
        {
            var uplink = new EchoSessionUplink(delay);
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new StaticSource("KSC"));
            engine.Start();
            engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0), Timeout);
            try
            {
                await using var sender = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var bystander = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(sender, EchoSessionUplink.Topic, Timeout);
                await SubscribeAsync(bystander, EchoSessionUplink.Topic, Timeout);

                await sender.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "press-1",
                    Command = EchoSessionUplink.Command,
                    Args = new Dictionary<string, object?> { ["x"] = 1.0 },
                    SentAt = 0.0,
                }));
                // The handler runs on a later tick when the command rides the delay, so
                // the clock is advanced until it has run, and then twice more so the
                // frame it caused is published and delivered.
                var deadline = DateTime.UtcNow + Timeout;
                var now = 0.0;
                while (uplink.Seen.IsEmpty && DateTime.UtcNow < deadline)
                {
                    now += 1.0;
                    engine.TickAndWait(now, FreezeGateTestUplink.Snapshot(now, connected: true, delay: 0.0), Timeout);
                    await Task.Delay(20);
                }
                for (var extra = 0; extra < 2; extra++)
                {
                    now += 1.0;
                    engine.TickAndWait(now, FreezeGateTestUplink.Snapshot(now, connected: true, delay: 0.0), Timeout);
                }

                Assert.True(uplink.Seen.TryDequeue(out var origin));
                Assert.NotEmpty(origin!.SessionId);
                Assert.Equal("press-1", origin.RequestId);
                var data = await ReceiveStreamDataAsync(sender, Timeout);
                Assert.Equal(origin.SessionId, data.Payload);
                await bystander.AssertNoMessageArrivesAsync(Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class StaticSource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;

            public StaticSource(string id) => _centre = new Centre(id);

            public string ProviderId => "session-test";

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

        [Fact]
        public async Task TheSessionDirectoryTellsWhoIsConnectedAndWhatTheyAreSubscribedTo()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new EchoSessionUplink(DelayRole.TrueNow));
            engine.Start();
            engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0), Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, EchoSessionUplink.Topic, Timeout);
                var origin = await SendEchoAndReadOriginAsync(engine, client);

                Assert.True(engine.IsSessionConnected(origin.SessionId));
                Assert.True(engine.IsSessionSubscribed(origin.SessionId, EchoSessionUplink.Topic));
                Assert.False(engine.IsSessionSubscribed(origin.SessionId, "some.other.topic"));

                await client.SendAsync(EnvelopeCodec.WriteUnsubscribe(new Unsubscribe { Topic = EchoSessionUplink.Topic }));
                await WaitUntilAsync(() => !engine.IsSessionSubscribed(origin.SessionId, EchoSessionUplink.Topic));

                await client.DisposeAsync();
                await WaitUntilAsync(() => !engine.IsSessionConnected(origin.SessionId));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task<CommandOrigin> SendEchoAndReadOriginAsync(ChannelEngine engine, TestClient client)
        {
            await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = "who-1",
                Command = EchoSessionUplink.Command,
                Args = new Dictionary<string, object?> { ["x"] = 1.0 },
                SentAt = 0.0,
            }));
            var deadline = DateTime.UtcNow + Timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (EchoSessionUplink.SeenOrigins.TryDequeue(out var seen) && seen.RequestId == "who-1")
                {
                    return seen;
                }
                await Task.Delay(10);
            }
            throw new TimeoutException("the command never ran");
        }

        private static async Task WaitUntilAsync(Func<bool> condition)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (condition())
                {
                    return;
                }
                await Task.Delay(10);
            }
            throw new TimeoutException("the condition never held");
        }

        public sealed class EchoArgs
        {
            public double X { get; set; }
        }

        private sealed class EchoSessionUplink : ISitrepUplink
        {
            public const string Topic = "session.echo";
            public const string Command = "session.echo.press";

            public static readonly System.Collections.Concurrent.ConcurrentQueue<CommandOrigin> SeenOrigins =
                new System.Collections.Concurrent.ConcurrentQueue<CommandOrigin>();

            public System.Collections.Concurrent.ConcurrentQueue<CommandOrigin> Seen => SeenOrigins;

            private IChannelPublisher? _publisher;
            private string? _pending;

            public EchoSessionUplink(DelayRole delay)
            {
                Manifest = new UplinkManifest
                {
                Id = "session-echo-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Discrete,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Delay = DelayRole.TrueNow,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                        ViewerFilter = (payload, viewer) => Equals(payload, viewer.SessionId) ? payload : null,
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Subject = Topic, Delay = delay },
                },
                };
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; }

            public void Register(IUplinkHost host)
            {
                _publisher = host.Publisher(Topic);
                host.AddSessionCommandHandler<EchoArgs, CommandResult>(Command, (_, origin) =>
                {
                    SeenOrigins.Enqueue(origin);
                    _pending = origin.SessionId;
                    return CommandResult.Ok();
                });
                host.AddSampledSource(_ => _pending, captured =>
                {
                    if (captured is string session)
                    {
                        _pending = null;
                        _publisher!.Publish(session, 1.0);
                    }
                });
            }
        }
    }
}
