using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command centre with no route to a node is delivered nothing from it.
    /// It used to fall through to the node's default delay, which is the home
    /// centre's light-time, so a centre that could not hear a craft at all was
    /// sent its telemetry on home's clock.
    /// </summary>
    public class NoRouteNoDeliveryTests
    {
        private const string Home = "ground:Cape";
        private const string Pilot = "vessel:P";
        private const double HomeDelay = 240.0;

        private static void Tick(ChannelEngine engine, double ut, double craft) =>
            engine.TickAndWait(ut, HomeLedgerTestUplink.Snapshot(ut, craft: craft, delay: HomeDelay, connected: true), TestBudgets.Op);

        private static object? Read(ChannelEngine engine, string vantage, double nowUt) =>
            engine.ReadTopicAtVantage(HomeLedgerTestUplink.CraftTopic, vantage, nowUt);

        private static Dictionary<string, IReadOnlyCollection<string>> NoRouteFrom(string centre) =>
            new Dictionary<string, IReadOnlyCollection<string>> { [centre] = new[] { ChannelEngine.NodeId } };

        [Fact]
        public async Task ACentreWithNoRouteToTheActiveCraftIsSentNoneOfItsFrames()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await WsTestHarness.SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                engine.SetUnroutable(NoRouteFrom(Pilot));

                Tick(engine, 0.0, craft: 1.0);
                Tick(engine, 10.0, craft: 2.0);
                Tick(engine, 10.0 + HomeDelay + 1.0, craft: 3.0);

                Assert.True(double.IsPositiveInfinity(engine.LedgerDelayFor(Pilot, ChannelEngine.NodeId)));
                Assert.Null(Read(engine, Pilot, 10.0 + HomeDelay + 1.0));
                Assert.Equal(2.0, System.Convert.ToDouble(Read(engine, Home, 10.0 + HomeDelay + 1.0)));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>What was sent while it had no route never arrives; it hears the craft from when the route opened, at its own light-time.</summary>
        [Fact]
        public async Task ACentreThatGainsARouteHearsOnlyWhatWasSentAfterItOpened()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await WsTestHarness.SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                engine.SetUnroutable(NoRouteFrom(Pilot));
                Tick(engine, 0.0, craft: 1.0);
                Tick(engine, 10.0, craft: 2.0);

                engine.SetActiveVesselDelays(new Dictionary<string, double> { [Pilot] = 5.0 });
                engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>>());
                Assert.Equal(5.0, engine.LedgerDelayFor(Pilot, ChannelEngine.NodeId));
                Tick(engine, 20.0, craft: 3.0);
                Tick(engine, 24.0, craft: 3.0);
                Tick(engine, 26.0, craft: 3.0);

                Assert.Equal(3.0, System.Convert.ToDouble(Read(engine, Pilot, 26.0)));

                engine.SetActiveVesselDelays(new Dictionary<string, double>());
                engine.SetUnroutable(NoRouteFrom(Pilot));
                Assert.True(double.IsPositiveInfinity(engine.LedgerDelayFor(Pilot, ChannelEngine.NodeId)));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A crewed craft becomes a command centre after the active craft's
        /// frame has left. It was not listening then, so the frame never
        /// arrives there. It used to read the frame's stamp at its base, the
        /// home centre's light-time, and catch up on it on home's clock. What
        /// is sent once it exists and has a route reaches it at its own
        /// light-time.
        /// </summary>
        [Fact]
        public async Task ACentreBornAfterAFrameWasSentIsNotSentItOnHomesClock()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var centres = new Centres(Home);
            engine.RegisterCommandCentreSource(centres);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                // A source only speaks while someone is subscribed to it.
                await using var listener = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await WsTestHarness.SubscribeAsync(listener, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                Tick(engine, 0.0, craft: 1.0);
                Tick(engine, 10.0, craft: 2.0);

                // The crewed craft becomes a centre, with no route to the active craft yet.
                centres.Add(Pilot);
                engine.SetUnroutable(NoRouteFrom(Pilot));
                Tick(engine, 11.0, craft: 2.0);
                await using var seated = await WsTestHarness.TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await seated.SendAsync(Sitrep.Contract.Serialization.EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Pilot }));
                await WsTestHarness.SubscribeAsync(seated, HomeLedgerTestUplink.CraftTopic, TestBudgets.Op);
                Tick(engine, 10.0 + HomeDelay + 1.0, craft: 2.0);
                Tick(engine, 10.0 + HomeDelay + 2.0, craft: 2.0);

                var before = await WsTestHarness.DrainAllStreamDataAsync(seated, TestBudgets.Quiet);
                Assert.DoesNotContain(before, f => f.Topic == HomeLedgerTestUplink.CraftTopic);
                Assert.Equal(2.0, System.Convert.ToDouble(Read(engine, Home, 10.0 + HomeDelay + 2.0)));

                engine.SetActiveVesselDelays(new Dictionary<string, double> { [Pilot] = 5.0 });
                engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>>());
                Tick(engine, 300.0, craft: 9.0);
                Tick(engine, 304.0, craft: 9.0);
                Tick(engine, 306.0, craft: 9.0);

                var after = await WsTestHarness.DrainAllStreamDataAsync(seated, TestBudgets.Quiet);
                var heard = Assert.Single(after, f => f.Topic == HomeLedgerTestUplink.CraftTopic);
                Assert.Equal(300.0, heard.Meta.ValidAt);
                Assert.Equal(305.0, heard.Meta.DeliveredAt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Command centres a test can add to while the engine runs.</summary>
        private sealed class Centres : ICommandCentreSource
        {
            private readonly List<string> _ids;

            public Centres(params string[] ids) => _ids = new List<string>(ids);

            public string ProviderId => "late-born-centre-test";

            public void Add(string id)
            {
                lock (_ids)
                {
                    _ids.Add(id);
                }
            }

            public IEnumerable<ICommandCentre> Enumerate()
            {
                lock (_ids)
                {
                    return _ids.ConvertAll(id => (ICommandCentre)new Centre(id));
                }
            }

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

        /// <summary>
        /// The far centre cannot reach the relay, so it hears nothing of it and
        /// does not plan it. When a route opens it hears where the relay is one of
        /// its own light-times later, though the relay did nothing in between.
        /// </summary>
        [Fact]
        public async Task ACentreThatGainsARouteToACraftHearsItsStateOneLightTimeLater()
        {
            var game = new ScriptedContactGame { FarRoutedToRelay = false };
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            foreach (var ut in new[] { 1.0, 300.0, 601.0, 900.0 })
            {
                world.Tick(ut);
            }
            Assert.Null(world.Uplink.Heard(ScriptedContactGame.Far, ScriptedContactGame.RelayGuid));
            Assert.NotNull(world.Uplink.Heard(ScriptedContactGame.Home, ScriptedContactGame.RelayGuid));

            game.FarRoutedToRelay = true;
            foreach (var ut in new[] { 1000.0, 1001.0, 1299.0 })
            {
                world.Tick(ut);
            }
            Assert.Null(world.Uplink.Heard(ScriptedContactGame.Far, ScriptedContactGame.RelayGuid));

            world.Tick(1302.0);
            Assert.NotNull(world.Uplink.Heard(ScriptedContactGame.Far, ScriptedContactGame.RelayGuid));
        }
    }
}
