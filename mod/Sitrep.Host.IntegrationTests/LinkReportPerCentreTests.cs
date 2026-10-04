using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.CommandCentres;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A report of the active craft's link reaches each command centre one of
    /// that centre's own light-times after the instant it describes. It used
    /// to be held for the home centre's light-time and then shown to every
    /// centre at once, so a centre beside the craft learned of an outage late
    /// and one further out than home learned of it early.
    /// </summary>
    public class LinkReportPerCentreTests
    {
        private const string Home = "ground:Cape";
        private const string Near = "vessel:Near";
        private const string Far = "vessel:Far";
        private const string Deaf = "vessel:Deaf";
        private const double HomeDelay = 240.0;
        private const double NearDelay = 5.0;
        private const double FarDelay = 600.0;
        private const double CutUt = 1000.0;

        private const string Link = ConnectivityHorizonTestUplink.LinkTopic;

        private static void Tick(ChannelEngine engine, double ut, bool connected) =>
            engine.TickAndWait(
                ut,
                ConnectivityHorizonTestUplink.Snapshot(ut, connected: connected, delay: connected ? HomeDelay : 0.0),
                TestBudgets.Op);

        private static bool? ConnectedAsSeenFrom(ChannelEngine engine, string vantage, double nowUt) =>
            (engine.ReadTopicAtVantage(Link, vantage, nowUt) as CommsLink)?.Connected;

        /// <summary>The rows the centre passes write while the craft can be heard, and what they leave once it cannot.</summary>
        private static void WriteRows(ChannelEngine engine, bool craftHeard)
        {
            var deaf = new[] { ChannelEngine.NodeId };
            if (craftHeard)
            {
                engine.SetActiveVesselDelays(new Dictionary<string, double> { [Near] = NearDelay, [Far] = FarDelay });
                engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>> { [Deaf] = deaf });
                return;
            }
            engine.SetActiveVesselDelays(new Dictionary<string, double>());
            engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>> { [Near] = deaf, [Far] = deaf, [Deaf] = deaf });
        }

        [Fact]
        public async Task TwoCentresAtDifferentDelaysEachSeeTheSameLinkReportAtTheirOwnTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await SubscribeAsync(client, Link, TestBudgets.Op);

                WriteRows(engine, craftHeard: true);
                Tick(engine, 0.0, connected: true);
                Tick(engine, 1.0, connected: true);
                Tick(engine, CutUt - 1.0, connected: true);

                // The link is up, and each centre has known it since its own
                // light-time after the first report.
                Assert.Null(ConnectedAsSeenFrom(engine, Near, NearDelay - 1.0));
                Assert.True(ConnectedAsSeenFrom(engine, Near, NearDelay + 1.0));
                Assert.Null(ConnectedAsSeenFrom(engine, Home, HomeDelay - 1.0));
                Assert.True(ConnectedAsSeenFrom(engine, Home, HomeDelay + 1.0));
                Assert.Null(ConnectedAsSeenFrom(engine, Far, FarDelay - 1.0));
                Assert.True(ConnectedAsSeenFrom(engine, Far, FarDelay + 1.0));

                // The cut. The centre rows go the same tick, as they do when a
                // craft has no path left to measure.
                WriteRows(engine, craftHeard: false);
                Tick(engine, CutUt, connected: false);
                Tick(engine, CutUt + FarDelay + 2.0, connected: false);

                Assert.True(ConnectedAsSeenFrom(engine, Near, CutUt + NearDelay - 1.0));
                Assert.False(ConnectedAsSeenFrom(engine, Near, CutUt + NearDelay + 1.0));

                Assert.True(ConnectedAsSeenFrom(engine, Home, CutUt + NearDelay + 1.0));
                Assert.True(ConnectedAsSeenFrom(engine, Home, CutUt + HomeDelay - 1.0));
                Assert.False(ConnectedAsSeenFrom(engine, Home, CutUt + HomeDelay + 1.0));

                Assert.True(ConnectedAsSeenFrom(engine, Far, CutUt + HomeDelay + 1.0));
                Assert.True(ConnectedAsSeenFrom(engine, Far, CutUt + FarDelay - 1.0));
                Assert.False(ConnectedAsSeenFrom(engine, Far, CutUt + FarDelay + 1.0));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>A centre that could not hear the craft while its link was up is not told when it went down.</summary>
        [Fact]
        public async Task ACentreWithNoRouteToTheCraftIsToldNothingOfItsLink()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await SubscribeAsync(client, Link, TestBudgets.Op);

                WriteRows(engine, craftHeard: true);
                Tick(engine, 0.0, connected: true);
                Tick(engine, CutUt - 1.0, connected: true);
                WriteRows(engine, craftHeard: false);
                Tick(engine, CutUt, connected: false);
                Tick(engine, CutUt + FarDelay + 2.0, connected: false);

                Assert.Null(ConnectedAsSeenFrom(engine, Deaf, CutUt - 1.0));
                Assert.Null(ConnectedAsSeenFrom(engine, Deaf, CutUt + FarDelay + 2.0));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The same on the wire: two sockets seated at two centres, one beside
        /// the craft and one further out than home, each sent the outage one of
        /// its own light-times after it began.
        /// </summary>
        [Fact]
        public async Task TwoSeatedClientsAreEachSentTheOutageAtTheirOwnCentresLightTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new SeatSource(Near));
            engine.RegisterCommandCentreSource(new SeatSource(Far));
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                Tick(engine, 0.0, connected: true);
                await using var near = await SeatAsync(engine, Near);
                await using var far = await SeatAsync(engine, Far);
                WriteRows(engine, craftHeard: true);

                Tick(engine, 1.0, connected: true);
                Tick(engine, 1.0 + NearDelay - 1.0, connected: true);
                Assert.Empty(await LinkFramesAsync(near));
                Tick(engine, 1.0 + NearDelay + 1.0, connected: true);
                Assert.Equal(new[] { true }, await LinkFramesAsync(near));
                Assert.Empty(await LinkFramesAsync(far));
                Tick(engine, 1.0 + FarDelay + 1.0, connected: true);
                Assert.Equal(new[] { true }, await LinkFramesAsync(far));

                WriteRows(engine, craftHeard: false);
                Tick(engine, CutUt, connected: false);
                Tick(engine, CutUt + NearDelay - 1.0, connected: false);
                Assert.DoesNotContain(false, await LinkFramesAsync(near));
                Tick(engine, CutUt + NearDelay + 1.0, connected: false);
                Assert.Contains(false, await LinkFramesAsync(near));

                Tick(engine, CutUt + HomeDelay + 1.0, connected: false);
                Tick(engine, CutUt + FarDelay - 1.0, connected: false);
                Assert.DoesNotContain(false, await LinkFramesAsync(far));
                Tick(engine, CutUt + FarDelay + 1.0, connected: false);
                Assert.Contains(false, await LinkFramesAsync(far));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task<TestClient> SeatAsync(ChannelEngine engine, string centre)
        {
            var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
            await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
            Assert.Equal("subscribed", (await SubscribeAsync(client, Link, TestBudgets.Op)).Name);
            return client;
        }

        private static async Task<bool[]> LinkFramesAsync(TestClient client)
        {
            var frames = await DrainAllStreamDataAsync(client, TestBudgets.Quiet);
            return frames
                .Where(f => f.Topic == Link)
                .Select(f => (bool)((IDictionary<string, object?>)f.Payload!)["connected"]!)
                .ToArray();
        }

        private sealed class SeatSource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;

            public SeatSource(string id) => _centre = new Seat(id);

            public string ProviderId => "seat-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return _centre;
            }

            private sealed class Seat : ICommandCentre
            {
                public Seat(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
