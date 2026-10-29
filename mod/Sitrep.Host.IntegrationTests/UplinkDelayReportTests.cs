using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>system.uplink.delays</c> says where each delayed command goes and, for one
    /// that does not go to the active craft, the delay from each centre to its own
    /// target as that centre knows it: a figure only once it has had its own delay
    /// to arrive.
    /// </summary>
    public class UplinkDelayReportTests
    {
        private const double PathHomeSeconds = 5.0;
        private const string Ground = "ground:Crater Rim Station";
        private const string Pilot = "vessel:G";

        [Fact]
        public void AnOrderToTheActiveCraftIsListedAsGoingThere()
        {
            using var engine = Started(out _);
            try
            {
                Tick(engine, 0.0);
                Assert.Contains(ReportTestUplink.CraftCommand, Report(engine).ActiveVessel);
                Assert.DoesNotContain(ReportTestUplink.CareerCommand, Report(engine).ActiveVessel);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACareerOrderTakesEachCentresDelayHomeOnceThatDelayHasHadTimeToArrive()
        {
            using var engine = Started(out _);
            try
            {
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);
                Assert.Equal(0.0, CareerDelayFrom(engine, Ground));
                Assert.Null(CareerDelayFrom(engine, Pilot));

                Tick(engine, 1.0 + PathHomeSeconds - 0.5);
                Assert.Null(CareerDelayFrom(engine, Pilot));

                Tick(engine, 1.0 + PathHomeSeconds);
                Assert.Equal(PathHomeSeconds, CareerDelayFrom(engine, Pilot));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ANewFigureReplacesTheOldOnlyOnceItHasArrived()
        {
            using var engine = Started(out _);
            try
            {
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);
                Tick(engine, 10.0);
                Assert.Equal(PathHomeSeconds, CareerDelayFrom(engine, Pilot));

                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = 8.0 });
                Tick(engine, 11.0);
                Assert.Equal(PathHomeSeconds, CareerDelayFrom(engine, Pilot));

                Tick(engine, 19.0);
                Assert.Equal(8.0, CareerDelayFrom(engine, Pilot));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ARouteThatBreaksIsNotSeenBreakingAndOneThatReturnsIsSeenOnlyOnceItsFigureHasArrived()
        {
            using var engine = Started(out _);
            try
            {
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);
                Tick(engine, 10.0);
                Assert.Equal(PathHomeSeconds, CareerDelayFrom(engine, Pilot));

                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0 });
                Tick(engine, 11.0);
                Tick(engine, 50.0);
                Assert.Equal(PathHomeSeconds, CareerDelayFrom(engine, Pilot));

                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = 8.0 });
                Tick(engine, 60.0);
                Tick(engine, 67.9);
                Assert.Equal(PathHomeSeconds, CareerDelayFrom(engine, Pilot));

                Tick(engine, 68.0);
                Assert.Equal(8.0, CareerDelayFrom(engine, Pilot));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AFigureTakenBeforeTheRouteBrokeStillArrivesAfterItsOwnDelay()
        {
            using var engine = Started(out _);
            try
            {
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0 });
                Tick(engine, 2.0);
                Assert.Null(CareerDelayFrom(engine, Pilot));

                Tick(engine, 1.0 + PathHomeSeconds);
                Assert.Equal(PathHomeSeconds, CareerDelayFrom(engine, Pilot));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void WhichOrdersGoToTheActiveCraftDoesNotMoveWithAnyDelayOrRoute()
        {
            using var engine = Started(out _);
            try
            {
                Tick(engine, 0.0);
                var before = Report(engine).ActiveVessel.ToList();

                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);
                Assert.Equal(before, Report(engine).ActiveVessel);

                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0 });
                Tick(engine, 2.0);
                Assert.Equal(before, Report(engine).ActiveVessel);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AnOrderWhoseTargetIsNamedByAnArgumentHasNoFigure()
        {
            using var engine = Started(out _);
            try
            {
                Tick(engine, 0.0);
                Tick(engine, 100.0);
                var rows = Report(engine).Elsewhere.Where(r => r.Command == ReportTestUplink.OtherCraftCommand).ToList();
                Assert.NotEmpty(rows);
                Assert.All(rows, row => Assert.Null(row.OneWaySeconds));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASessionIsSentTheDelaysFromItsOwnCentreOnly()
        {
            using var engine = Started(out _);
            try
            {
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Pilot }));
                await SubscribeAsync(client, ChannelEngine.UplinkDelaysTopic, TestBudgets.Op);
                Tick(engine, 1.0 + PathHomeSeconds);
                Tick(engine, 2.0 + PathHomeSeconds);

                var frame = await DrainToLatestStreamDataAsync(client, TestBudgets.Quiet);

                var payload = Assert.IsType<Dictionary<string, object?>>(frame?.Payload);
                var rows = Assert.IsAssignableFrom<System.Collections.IEnumerable>(payload["elsewhere"])
                    .Cast<Dictionary<string, object?>>()
                    .Where(row => (string?)row["command"] == ReportTestUplink.CareerCommand)
                    .ToList();
                var row = Assert.Single(rows);
                Assert.Equal(Pilot, row["centre"]);
                Assert.Equal(PathHomeSeconds, Convert.ToDouble(row["oneWaySeconds"], System.Globalization.CultureInfo.InvariantCulture));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASessionThatHasChosenNoVantageIsSentTheRowsOfTheCentreItStartsAtOnly()
        {
            using var engine = Started(out _);
            try
            {
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Ground] = 0.0, [Pilot] = PathHomeSeconds });
                Tick(engine, 1.0);
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await SubscribeAsync(client, ChannelEngine.UplinkDelaysTopic, TestBudgets.Op);
                Tick(engine, 1.0 + PathHomeSeconds);
                Tick(engine, 2.0 + PathHomeSeconds);

                var frame = await DrainToLatestStreamDataAsync(client, TestBudgets.Quiet);

                var payload = Assert.IsType<Dictionary<string, object?>>(frame?.Payload);
                var rows = Assert.IsAssignableFrom<System.Collections.IEnumerable>(payload["elsewhere"])
                    .Cast<Dictionary<string, object?>>()
                    .ToList();
                Assert.NotEmpty(rows);
                Assert.All(rows, row => Assert.Equal(Ground, row["centre"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine Started(out ReportTestUplink uplink)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            uplink = new ReportTestUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new Centres(Ground, Pilot));
            engine.Start();
            return engine;
        }

        private static UplinkDelayReport Report(ChannelEngine engine) =>
            Assert.IsType<UplinkDelayReport>(engine.PayloadOf(ChannelEngine.UplinkDelaysTopic));

        private static double? CareerDelayFrom(ChannelEngine engine, string centre) =>
            Assert.Single(Report(engine).Elsewhere, r => r.Command == ReportTestUplink.CareerCommand && r.Centre == centre).OneWaySeconds;

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, TestBudgets.Op);

        private sealed class Centres : ICommandCentreSource
        {
            private readonly string[] _ids;

            public Centres(params string[] ids) => _ids = ids;

            public string ProviderId => "uplink-delay-report-test";

            public IEnumerable<ICommandCentre> Enumerate() => _ids.Select(id => (ICommandCentre)new Centre(id));

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

        private sealed class ReportTestUplink : ISitrepUplink
        {
            public const string CareerCommand = "uplinkdelays.career.order";
            public const string CraftCommand = "uplinkdelays.craft.order";
            public const string OtherCraftCommand = "uplinkdelays.fleet.order";
            private const string CareerTopic = "uplinkdelays.ledger";
            private const string CraftTopic = "uplinkdelays.craft";
            private const string FleetPrefix = "uplinkdelays.fleet.";

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "uplink-delay-report-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Channel(CareerTopic, heldAtHome: true),
                    Channel(CraftTopic, heldAtHome: false),
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = CareerCommand, Delay = DelayRole.Delayed, Subject = CareerTopic },
                    new CommandDeclaration { Command = CraftCommand, Delay = DelayRole.Delayed, Subject = CraftTopic },
                    new CommandDeclaration { Command = OtherCraftCommand, Delay = DelayRole.Delayed, Subject = FleetPrefix + "{args.VesselId}.state" },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(CareerTopic, _ => null);
                host.AddChannelSource(CraftTopic, _ => null);
                host.RegisterDynamicNamespace(FleetPrefix, new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                    PerVesselNode = true,
                });
                foreach (var command in new[] { CareerCommand, CraftCommand, OtherCraftCommand })
                {
                    host.AddCommandHandler<Dictionary<string, object?>, string>(command, _ => "done");
                }
                host.SetConnectivitySource(_ => true);
            }

            private static ChannelDeclaration Channel(string topic, bool heldAtHome) => new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
                HeldAtHome = heldAtHome,
            };
        }
    }
}
