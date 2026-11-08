using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command names the run and timeline its screen last heard from. One whose
    /// target a game load replaced is refused undoneByLoad rather than run against
    /// the new world; one that is about the game rather than the flight goes through.
    /// </summary>
    public class CommandTimelineTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private sealed class CountingUplink : ISitrepUplink
        {
            public const string Scene = FlightOpsCommandProvider.RevertToLaunchCommand;
            public const string Delayed = "test.delayed";
            public const string Meta = "time.setPaused";
            public int Ran;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-timeline",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = "test.timeline",
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Scene, Delay = DelayRole.TrueNow },
                    new CommandDeclaration { Command = Delayed, Delay = DelayRole.Delayed, Subject = "test.timeline" },
                    new CommandDeclaration { Command = Meta, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<object?, object?>(Scene, _ => { Ran++; return null; });
                host.AddCommandHandler<object?, object?>(Delayed, _ => { Ran++; return null; });
                host.AddCommandHandler<object?, object?>(Meta, _ => { Ran++; return null; });
            }
        }

        private static string Frame(string requestId, string command, string bootId, int epoch) =>
            EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = command,
                Args = null,
                SentAt = 0.0,
                SeenBootId = bootId,
                SeenEpoch = epoch,
            });

        private static ChannelEngine StartedAtEpochOne(CountingUplink uplink)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.TickAndWait(100.0, null, Timeout);
            // A tick behind the previous one is the game's own clock going back.
            engine.TickAndWait(50.0, null, Timeout);
            return engine;
        }

        [Fact]
        public async Task ASceneOperationFromTheAbandonedTimelineIsRefusedUndoneByLoad()
        {
            var uplink = new CountingUplink();
            using var engine = StartedAtEpochOne(uplink);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var hello = await client.HelloAsync(Timeout);
                Assert.Equal(1, hello.TimelineEpoch);

                await client.SendRawAsync(Frame("stale", CountingUplink.Scene, engine.BootId, 0));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);

                Assert.Equal("stale", error.RequestId);
                Assert.Equal(FaultCode.UndoneByLoad, error.Code);
                Assert.Equal(0, uplink.Ran);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ADelayedCommandFromAnotherRunIsRefused()
        {
            var uplink = new CountingUplink();
            using var engine = StartedAtEpochOne(uplink);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendRawAsync(Frame("old-run", CountingUplink.Delayed, "some-other-run", 1));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal(FaultCode.UndoneByLoad, error.Code);
                Assert.Equal(0, uplink.Ran);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACommandStatingNoTimelineIsRefused()
        {
            var uplink = new CountingUplink();
            using var engine = StartedAtEpochOne(uplink);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendRawAsync("{\"type\":\"command-request\",\"requestId\":\"bare\",\"command\":\"" + CountingUplink.Scene + "\",\"label\":\"\",\"topic\":\"\",\"args\":null,\"sentAt\":0}");
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal(FaultCode.UndoneByLoad, error.Code);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACommandAboutTheGameIsNotCheckedSoAScreenAMomentBehindCanStillPause()
        {
            var uplink = new CountingUplink();
            using var engine = StartedAtEpochOne(uplink);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendRawAsync(Frame("pause", CountingUplink.Meta, "some-other-run", 0));
                var reply = await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
                Assert.Equal("pause", reply.RequestId);
                Assert.Equal(1, uplink.Ran);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASceneOperationFromTheCurrentTimelineRuns()
        {
            var uplink = new CountingUplink();
            using var engine = StartedAtEpochOne(uplink);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendRawAsync(Frame("now", CountingUplink.Scene, engine.BootId, 1));
                var reply = await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
                Assert.Equal("now", reply.RequestId);
                Assert.Equal(1, uplink.Ran);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AConnectionSubscribedToNothingStillHearsTheNewEpoch()
        {
            var uplink = new CountingUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.TickAndWait(100.0, null, Timeout);
            engine.SetGameState(GamePhase.Ready, "FLIGHT");
            engine.TickAndWait(101.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var greeted = await client.GameStateAsync(Timeout);
                Assert.Equal(0, greeted.TimelineEpoch);
                Assert.Equal(engine.BootId, greeted.BootId);

                engine.TickAndWait(50.0, null, Timeout);

                var after = await client.GameStateAsync(Timeout);
                Assert.Equal(1, after.TimelineEpoch);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
