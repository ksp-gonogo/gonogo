using System;
using System.Collections.Generic;
using System.Linq;
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
    /// A connection that sends the reserved follow id stands at the active craft's seat, and
    /// the host moves it whenever the active craft changes. The craft is read and flown at
    /// no delay whether it is crewed, probe-controlled or without an antenna, because the
    /// ledger gives a seat a zero row against its own craft and the seat is the vantage.
    /// </summary>
    public class FollowActiveCraftTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        /// <summary>The ground's signal delay to the probe, which a ground vantage reads it at.</summary>
        private const double GroundDelay = 600.0;

        private const string Probe = "vessel:probe";
        private const string Other = "vessel:other";

        [Fact]
        public async Task AFollower_ReadsAnUncrewedActiveCraftAtZero_WhileTheGroundReadsItAtItsRoute()
        {
            var seat = new SeatSource(Probe);
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                WriteSeatRows(engine, seat);
                await using var follower = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await follower.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = ChannelEngine.ActiveCraftVantage }));
                await using var ground = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                var ack = await SubscribeAsync(follower, HomeLedgerTestUplink.CraftTopic, Timeout);
                await SubscribeAsync(ground, HomeLedgerTestUplink.CraftTopic, Timeout);
                Assert.Equal(Probe, ack.Meta.Vantage);

                Tick(engine, 2.0, craft: 7.0);

                var frame = await ReceiveStreamDataAsync(follower, Timeout);
                Assert.Equal(Probe, frame.Meta.Vantage);
                Assert.Equal(7.0, Convert.ToDouble(frame.Payload));
                await ground.AssertNoMessageArrivesAsync(Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AFollower_FliesAnUncrewedCraftWithNoDelay()
        {
            var seat = new SeatSource(Probe);
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                WriteSeatRows(engine, seat);
                await using var follower = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await follower.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = ChannelEngine.ActiveCraftVantage }));

                var response = await DispatchAsync(follower, "r0");
                Assert.Equal(Probe, response.Meta.Vantage);
                Assert.Equal(0.0, engine.LedgerDelayFor(Probe, ChannelEngine.NodeId));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ASeatWithNoAntenna_IsZeroToItsOwnCraft_AndHasNoRowToAnotherSubject()
        {
            var seat = new SeatSource(Probe);
            var rows = new List<(string Vantage, string Node, double Seconds)>();
            new AuthorityMatrixPass().Populate(
                new ICommandCentre[] { seat.Centre },
                new[] { "probe", "other" },
                (_, __) => null,
                (vantage, node, seconds) => rows.Add((vantage, node, seconds)));

            Assert.Equal(0.0, Assert.Single(rows, r => r.Node == AuthorityMatrixPass.FleetNode("probe")).Seconds);
            Assert.DoesNotContain(rows, r => r.Node == AuthorityMatrixPass.FleetNode("other"));
        }

        [Fact]
        public async Task WhenTheActiveCraftChanges_TheFollowerIsMovedWithNoMessage_AndKeepsItsRateTier()
        {
            var seat = new SeatSource(Probe);
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                WriteSeatRows(engine, seat);
                await using var follower = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await follower.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = ChannelEngine.ActiveCraftVantage }));
                await SubscribeAsync(follower, HomeLedgerTestUplink.CraftTopic, Timeout);
                await follower.SendAsync(EnvelopeCodec.WriteSetRate(new SetRate { Topic = HomeLedgerTestUplink.CraftTopic, Tier = DataRateTierNames.Fast }));
                await WaitForTierAsync(engine, DataRateTierNames.Fast);

                seat.Id = Other;
                Tick(engine, 1.0, craft: 2.0);
                WriteSeatRows(engine, seat);

                var reAck = await ReceiveTypedAsync<EventMsg>(follower, Timeout);
                Assert.Equal("subscribed", reAck.Name);
                Assert.Equal(Other, reAck.Meta.Vantage);
                Assert.Equal(DataRateTierNames.Fast, engine.Cadence.DemandReport().First(r => r.Topic == HomeLedgerTestUplink.CraftTopic).Tier);

                Tick(engine, 2.0, craft: 9.0);
                var frame = await ReceiveStreamDataAsync(follower, Timeout);
                Assert.Equal(Other, frame.Meta.Vantage);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ADispatchNamingTheActiveCraft_ReachesTheHandlerAtThatCraft()
        {
            var seat = new SeatSource(Probe);
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                WriteSeatRows(engine, seat);
                await using var ground = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                while (EchoUplink.Seen.TryDequeue(out _)) { }

                await DispatchAsync(ground, "r0", ChannelEngine.ActiveCraftVantage);

                Assert.Equal(new[] { Probe }, EchoUplink.Seen.ToArray());
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ADispatchNamingTheActiveCraft_IsRefusedWhileThereIsNone()
        {
            var seat = new SeatSource(Probe) { Present = false };
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                await using var ground = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                while (EchoUplink.Seen.TryDequeue(out _)) { }

                await ground.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "r0",
                    Command = EchoUplink.Command,
                    Vantage = ChannelEngine.ActiveCraftVantage,
                    Args = null,
                    SentAt = 0.0,
                }));
                var refused = await ReceiveTypedAsync<ErrorMsg>(ground, Timeout);

                Assert.Equal(FaultCode.UnknownVantage, refused.Code);
                Assert.Empty(EchoUplink.Seen);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task WithNoActiveCraft_TheFollowerReadsFromTheFreshConnectionVantage()
        {
            var seat = new SeatSource(Probe) { Present = false };
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                await using var follower = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await follower.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = ChannelEngine.ActiveCraftVantage }));

                var response = await DispatchAsync(follower, "r0");
                Assert.Equal("ground:gs1", response.Meta.Vantage);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AConnectionThatNeverAskedToFollow_IsNotMovedByAChangeOfCraft()
        {
            var seat = new SeatSource(Probe);
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                WriteSeatRows(engine, seat);
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var ack = await SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, Timeout);
                Assert.Equal("ground:gs1", ack.Meta.Vantage);

                seat.Id = Other;
                Tick(engine, 1.0, craft: 2.0);

                await client.AssertNoMessageArrivesAsync(Quiet);
                Assert.Equal("ground:gs1", (await DispatchAsync(client, "r0")).Meta.Vantage);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ChoosingACentreAfterFollowing_StopsTheFollowing()
        {
            var seat = new SeatSource(Probe);
            using var engine = StartedEngine(seat);
            try
            {
                Tick(engine, 0.0, craft: 1.0);
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = ChannelEngine.ActiveCraftVantage }));
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));

                seat.Id = Other;
                Tick(engine, 1.0, craft: 2.0);

                Assert.Equal("ground:gs1", (await DispatchAsync(client, "r0")).Meta.Vantage);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine StartedEngine(SeatSource seat)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new GroundSource());
            engine.RegisterCommandCentreSeatSource(seat);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.RegisterUplink(new EchoUplink());
            engine.Start();
            return engine;
        }

        private static void Tick(ChannelEngine engine, double ut, double craft) =>
            engine.TickAndWait(ut, HomeLedgerTestUplink.Snapshot(ut, craft: craft, delay: GroundDelay, connected: true), Timeout);

        /// <summary>The rows the delay Uplink writes for a seat: zero against the craft it stands on.</summary>
        private static void WriteSeatRows(ChannelEngine engine, SeatSource seat)
        {
            var rows = new Dictionary<string, double>();
            new AuthorityMatrixPass().PopulateActiveVessel(
                new ICommandCentre[] { seat.Centre },
                seat.Id.Substring("vessel:".Length),
                "ground:gs1",
                (_, __) => null,
                (id, seconds) => rows[id] = seconds);
            engine.SetActiveVesselDelays(rows);
        }

        private static async Task WaitForTierAsync(ChannelEngine engine, string tier)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (engine.Cadence.DemandReport().FirstOrDefault(r => r.Topic == HomeLedgerTestUplink.CraftTopic)?.Tier == tier)
                {
                    return;
                }
                await Task.Delay(10);
            }
            throw new TimeoutException("demand never became " + tier);
        }

        private static async Task<CommandResponse<object?>> DispatchAsync(TestClient client, string requestId, string? vantage = null)
        {
            await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = EchoUplink.Command,
                Vantage = vantage,
                Args = null,
                SentAt = 0.0,
            }));
            return await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
        }

        private sealed class EchoUplink : ISitrepUplink
        {
            public const string Command = "follow.echo";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-follow-active-craft",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                },
            };

            public static readonly System.Collections.Concurrent.ConcurrentQueue<string> Seen =
                new System.Collections.Concurrent.ConcurrentQueue<string>();

            public void Register(IUplinkHost host) =>
                host.AddVantageCommandHandler<object?, object?>(Command, (_, vantage) =>
                {
                    Seen.Enqueue(vantage);
                    return null;
                });
        }

        private sealed class GroundSource : ICommandCentreSource
        {
            public string ProviderId => "follow-ground";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return new Centre("ground:gs1", CommandCentreKind.GroundStation);
            }
        }

        /// <summary>The active craft's seat, which the test moves or removes between ticks.</summary>
        private sealed class SeatSource : ICommandCentreSource
        {
            public SeatSource(string id) => Id = id;

            public string Id { get; set; }

            public bool Present { get; set; } = true;

            public ICommandCentre Centre => new Centre(Id, CommandCentreKind.CrewedVessel);

            public string ProviderId => "follow-seat";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                if (Present)
                {
                    yield return Centre;
                }
            }
        }

        private sealed class Centre : ICommandCentre
        {
            public Centre(string id, CommandCentreKind kind)
            {
                Id = id;
                Kind = kind;
            }

            public string Id { get; }
            public string DisplayName => Id;
            public CommandCentreKind Kind { get; }
            public int? BodyIndex => null;
            public double? Latitude => null;
            public double? Longitude => null;
            public bool IsActiveNow() => true;
        }
    }
}
