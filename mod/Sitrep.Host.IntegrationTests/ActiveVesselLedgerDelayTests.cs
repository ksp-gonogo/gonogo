using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Every ordinary channel records under the engine's single node and describes the
    /// ACTIVE craft, so a pilot pinned to that craft reads it at zero, any other centre at
    /// its own route to the craft, and a centre with no route at the ground's light-time.
    ///
    /// <para>The rows are written by <see cref="AuthorityMatrixPass.PopulateActiveVessel"/>
    /// through <see cref="ChannelEngine.SetActiveVesselDelays"/>, and the ground's
    /// light-time arrives the production way, through the signal-delay source on a
    /// tick.</para>
    /// </summary>
    public class ActiveVesselLedgerDelayTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private const string G = "G";
        private const string H = "H";
        private const string PilotOfG = "vessel:G";
        private const string PilotOfH = "vessel:H";
        private const string Home = "ground:Cape";
        private const string OtherGround = "ground:Goldstone";
        private const string Unroutable = "ground:Dark";

        /// <summary>The active craft's light-time home, which the whole-network default carries.</summary>
        private const double ActiveVesselDelay = 240.0;

        private static readonly ICommandCentre[] Centres =
        {
            new FakeCentre(PilotOfG, CommandCentreKind.CrewedVessel),
            new FakeCentre(PilotOfH, CommandCentreKind.CrewedVessel),
            new FakeCentre(Home, CommandCentreKind.GroundStation),
            new FakeCentre(OtherGround, CommandCentreKind.GroundStation),
            new FakeCentre(Unroutable, CommandCentreKind.GroundStation),
        };

        /// <summary>A distinct route per centre, so a row quoting the wrong centre's number is caught.</summary>
        private static double? Route(ICommandCentre centre, string guid) => centre.Id switch
        {
            PilotOfG => 9.0,
            PilotOfH => 11.0,
            Home => ActiveVesselDelay,
            OtherGround => 3.0,
            _ => null,
        };

        [Fact]
        public void APilotPinnedToTheActiveCraftReadsItsOrdinaryTelemetryAtZero()
        {
            using var engine = StartedEngine();
            try
            {
                WriteRows(engine, G);
                Tick(engine, 1.0, craft: 1.0);

                var node = engine.NodeFor(HomeLedgerTestUplink.CraftTopic);
                Assert.Equal(ChannelEngine.NodeId, node);
                Assert.Equal(0.0, engine.LedgerDelayFor(PilotOfG, node));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The zero belongs to the active craft's own centre. Every other vantage keeps a
        /// number of its own, and the pilot's rows against OTHER subjects are untouched.
        /// </summary>
        [Fact]
        public void EveryOtherCentreReadsTheActiveCraftAtItsOwnRoute()
        {
            using var engine = StartedEngine();
            try
            {
                engine.SetVesselDelay(H, 55.0);
                new AuthorityMatrixPass().Populate(
                    Centres,
                    new[] { G, H },
                    Route,
                    (vantage, node, seconds) => engine.SetAuthorityDelay(vantage, node.Substring(ChannelEngine.FleetNodePrefix.Length), seconds));
                WriteRows(engine, G);
                Tick(engine, 1.0, craft: 1.0);

                Assert.Equal(11.0, engine.LedgerDelayFor(PilotOfH, ChannelEngine.NodeId));
                Assert.Equal(3.0, engine.LedgerDelayFor(OtherGround, ChannelEngine.NodeId));
                Assert.Equal(ActiveVesselDelay, engine.LedgerDelayFor(Home, ChannelEngine.NodeId));
                Assert.Equal(ActiveVesselDelay, engine.LedgerDelayFor(Unroutable, ChannelEngine.NodeId));
                Assert.Equal(ActiveVesselDelay, engine.LedgerDelayFor("unlisted", ChannelEngine.NodeId));

                // The pilot of G observing H: the routed delay between them, as before.
                Assert.Equal(9.0, engine.LedgerDelayFor(PilotOfG, AuthorityMatrixPass.FleetNode(H)));
                Assert.Equal(55.0, engine.LedgerDelayFor("unlisted", AuthorityMatrixPass.FleetNode(H)));
                Assert.Equal(0.0, engine.LedgerDelayFor(ChannelEngine.MetaVantage, ChannelEngine.NodeId));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Switching craft moves the zero with it. The pilot of the craft left behind has
        /// no route to the new one here, so it reads the ground's light-time rather than
        /// keeping the zero it held a pass ago.
        /// </summary>
        [Fact]
        public void SwitchingTheActiveCraftMovesTheZeroOnTheNextPass()
        {
            using var engine = StartedEngine();
            try
            {
                WriteRows(engine, G);
                Tick(engine, 1.0, craft: 1.0);
                Assert.Equal(0.0, engine.LedgerDelayFor(PilotOfG, ChannelEngine.NodeId));

                WriteRows(engine, H, (centre, guid) => centre.Id == PilotOfG ? null : Route(centre, guid));
                Tick(engine, 2.0, craft: 2.0);

                Assert.Equal(0.0, engine.LedgerDelayFor(PilotOfH, ChannelEngine.NodeId));
                Assert.Equal(ActiveVesselDelay, engine.LedgerDelayFor(PilotOfG, ChannelEngine.NodeId));
                Assert.Equal(3.0, engine.LedgerDelayFor(OtherGround, ChannelEngine.NodeId));

                WriteRows(engine, null);
                Tick(engine, 3.0, craft: 3.0);

                Assert.Equal(ActiveVesselDelay, engine.LedgerDelayFor(PilotOfH, ChannelEngine.NodeId));
                Assert.Equal(ActiveVesselDelay, engine.LedgerDelayFor(OtherGround, ChannelEngine.NodeId));
                Assert.Equal(0.0, engine.LedgerDelayFor(ChannelEngine.MetaVantage, ChannelEngine.NodeId));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The operator's case end to end: a readout recorded on the active craft is on the
        /// pilot's screen the moment it is recorded, while the home centre still waits the
        /// craft's light-time for it.
        /// </summary>
        [Fact]
        public async Task ThePilotSeesTheActiveCraftsReadoutAsItIsRecorded()
        {
            using var engine = StartedEngine();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, Timeout);
                WriteRows(engine, G);

                Tick(engine, 0.0, craft: 1.0);
                Tick(engine, 10.0, craft: 2.0);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Equal(2.0, Read(engine, PilotOfG, 10.0));
                Assert.Null(Read(engine, Home, 10.0));
                Assert.Equal(1.0, Read(engine, Home, ActiveVesselDelay));
                Assert.Equal(2.0, Read(engine, Home, 10.0 + ActiveVesselDelay));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine StartedEngine()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            return engine;
        }

        private static void Tick(ChannelEngine engine, double ut, double craft) =>
            engine.TickAndWait(ut, HomeLedgerTestUplink.Snapshot(ut, craft: craft, delay: ActiveVesselDelay, connected: true), Timeout);

        private static void WriteRows(ChannelEngine engine, string? activeGuid, Func<ICommandCentre, string, double?>? route = null)
        {
            var rows = new Dictionary<string, double>();
            new AuthorityMatrixPass().PopulateActiveVessel(Centres, activeGuid, Home, route ?? Route, (id, s) => rows[id] = s);
            engine.SetActiveVesselDelays(rows);
        }

        private static double? Read(ChannelEngine engine, string vantage, double nowUt)
        {
            var value = engine.ReadTopicAtVantage(HomeLedgerTestUplink.CraftTopic, vantage, nowUt);
            return value == null ? (double?)null : Convert.ToDouble(value);
        }

        private sealed class FakeCentre : ICommandCentre
        {
            public FakeCentre(string id, CommandCentreKind kind)
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
