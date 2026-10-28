using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A delay comes from the thing a reading or command is about, as seen from
    /// the centre that hears it. A centre with no row of its own reads it as
    /// unknown: nothing is delivered to it and nothing it sends is timed. Only the
    /// home centre, and a connection standing at no centre, read the figures the
    /// engine holds from home's side.
    /// </summary>
    public class NoRowIsUnknownTests
    {
        private const string Home = "ground:Cape";
        private const string Pilot = "vessel:P";
        private const string Gone = "vessel:Q";
        private const double HomeDelay = 240.0;

        private static void Tick(ChannelEngine engine, double ut, double craft) =>
            engine.TickAndWait(ut, HomeLedgerTestUplink.Snapshot(ut, craft: craft, delay: HomeDelay, connected: true), TestBudgets.Op);

        private static ChannelEngine StartWithCentres(params string[] centres)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new Centres(centres));
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            return engine;
        }

        [Fact]
        public async Task ASecondCentreWithNoRowOfItsOwnIsSentNothingOfTheActiveCraft()
        {
            using var engine = StartWithCentres(Home, Pilot);
            try
            {
                await using var client = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await WsTestHarness.SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                Tick(engine, 0.0, craft: 1.0);
                Tick(engine, 10.0, craft: 2.0);
                Tick(engine, 10.0 + HomeDelay + 1.0, craft: 3.0);

                Assert.Equal(Home, engine.HomeCentre());
                Assert.Equal(HomeDelay, engine.LedgerDelayFor(Home, ChannelEngine.NodeId));
                Assert.True(double.IsPositiveInfinity(engine.LedgerDelayFor(Pilot, ChannelEngine.NodeId)));
                Assert.Null(engine.ReadTopicAtVantage(HomeLedgerTestUplink.CraftTopic, Pilot, 10.0 + HomeDelay + 1.0));
                Assert.Equal(2.0, System.Convert.ToDouble(engine.ReadTopicAtVantage(HomeLedgerTestUplink.CraftTopic, Home, 10.0 + HomeDelay + 1.0)));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACraftsDownlinkDelayIsHomesAndNoOtherCentresUntilThatCentreHasARow()
        {
            using var engine = StartWithCentres(Home, Pilot);
            try
            {
                await using var client = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await WsTestHarness.SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                Tick(engine, 0.0, craft: 1.0);
                engine.SetVesselDelay("G", 5.0);
                Tick(engine, 1.0, craft: 1.0);

                Assert.Equal(5.0, engine.LedgerDelayFor(Home, "fleet.G"));
                Assert.True(double.IsPositiveInfinity(engine.LedgerDelayFor(Pilot, "fleet.G")));
                Assert.False(engine.DelayKnown(Pilot, "fleet.G"));

                engine.SetAuthorityDelays(new[] { (Pilot, "G", 9.0) });
                Assert.Equal(9.0, engine.LedgerDelayFor(Pilot, "fleet.G"));
                Assert.True(engine.DelayKnown(Pilot, "fleet.G"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACentreWithNoLedgerRowIsNotToldTheLedgerLive()
        {
            using var engine = StartWithCentres(Home, Pilot);
            try
            {
                await using var client = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await WsTestHarness.SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                Tick(engine, 0.0, craft: 1.0);
                engine.SetHomeCommandDelays(new Dictionary<string, double> { [Home] = 0.0 });
                Tick(engine, 1.0, craft: 1.0);

                Assert.Equal(0.0, engine.LedgerDelayFor(Home, ChannelEngine.HomeCommandNode));
                Assert.True(double.IsPositiveInfinity(engine.LedgerDelayFor(Pilot, ChannelEngine.HomeCommandNode)));
                Assert.True(double.IsPositiveInfinity(engine.LedgerDelayFor(Gone, ChannelEngine.HomeCommandNode)));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACentresOwnSiteIsNoDistanceAndMetaIsInstantOnEveryNode()
        {
            using var engine = StartWithCentres(Home, Pilot);
            try
            {
                await using var client = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await WsTestHarness.SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                Tick(engine, 0.0, craft: 1.0);
                engine.SetVesselDelay("P", 7.0);
                Tick(engine, 1.0, craft: 1.0);

                Assert.Equal(0.0, engine.LedgerDelayFor(Home, ChannelEngine.CentreNodePrefix + Home));
                Assert.Equal(0.0, engine.LedgerDelayFor(Pilot, "fleet.P"));
                Assert.Equal(0.0, engine.LedgerDelayFor(ChannelEngine.MetaVantage, "fleet.P"));
                Assert.Equal(0.0, engine.LedgerDelayFor(ChannelEngine.MetaVantage, ChannelEngine.NodeId));
                Assert.True(double.IsPositiveInfinity(engine.LedgerDelayFor(Home, ChannelEngine.AddressedNode)));
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class Centres : ICommandCentreSource
        {
            private readonly List<string> _ids;

            public Centres(params string[] ids) => _ids = new List<string>(ids);

            public string ProviderId => "no-row-is-unknown-test";

            public IEnumerable<ICommandCentre> Enumerate() => _ids.ConvertAll(id => (ICommandCentre)new Centre(id));

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id) => Id = id;

                public string Id { get; }

                public string DisplayName => Id;

                public CommandCentreKind Kind =>
                    Id.StartsWith("vessel:", System.StringComparison.Ordinal) ? CommandCentreKind.CrewedVessel : CommandCentreKind.GroundStation;

                public int? BodyIndex => null;

                public double? Latitude => null;

                public double? Longitude => null;

                public bool IsActiveNow() => true;
            }
        }
    }
}
