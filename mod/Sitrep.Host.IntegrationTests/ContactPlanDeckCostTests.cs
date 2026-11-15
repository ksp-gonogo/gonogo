using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;
using Xunit.Abstractions;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What the contact plan costs the Courier on each tick of a save the size of
    /// a career relay network: thirteen ground stations that are each a command
    /// centre, seventeen craft in orbit of Kerbin, a comms backend that states link
    /// strengths, no route of the game's own for the active craft, and two sessions
    /// subscribed to every topic the plan publishes. Ticked once a game second, as
    /// the game ticks at 1x, with every tick taking a look.
    ///
    /// <para>The subscriptions are what make it cost: the next-loss figure and the
    /// two tables of delays between centres are worked out only while someone is
    /// subscribed to them, and they are the figures that search the whole plan.</para>
    ///
    /// <para><c>DECK_COST_TICKS</c>, <c>DECK_COST_STATIONS</c>, <c>DECK_COST_CRAFT</c>
    /// and <c>DECK_COST_BACKEND</c> (<c>none</c>, <c>range</c> or <c>budget</c>) size
    /// a run by hand; the output names each timed phase.</para>
    /// </summary>
    public class ContactPlanDeckCostTests
    {
        /// <summary>
        /// The most the plan's handles may cost on a tick, averaged over the run, in
        /// milliseconds. A next-loss figure found by asking every window of every pair
        /// at every boundary costs 110 to 210 on a machine where the sweep costs 7 to
        /// 12, so the ceiling sits between the two with room for a loaded runner.
        /// </summary>
        private const double MeanHandlesCeilingMs = 50.0;

        private readonly ITestOutputHelper _output;

        public ContactPlanDeckCostTests(ITestOutputHelper output) => _output = output;

        private static int Setting(string name, int otherwise) =>
            int.Parse(Environment.GetEnvironmentVariable(name) ?? otherwise.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);

        [Fact]
        public async Task TheContactPlanCostsTheCourierLittleOnEachTickOfALargeNetworkEveryTopicSubscribed()
        {
            var game = new DeckGame(
                stations: Setting("DECK_COST_STATIONS", 13),
                craft: Setting("DECK_COST_CRAFT", 17),
                backend: Environment.GetEnvironmentVariable("DECK_COST_BACKEND") ?? "range");
            var (engine, uplink) = Start(game);
            try
            {
                var seats = new[] { DeckGame.StationId(0), DeckGame.StationId(5) };
                await using var host = await SitAtAsync(engine, seats[0]);
                await using var station = await SitAtAsync(engine, seats[1]);

                // Warm-up: the first look at every craft, and then the plan made of them, which is worked out off the Courier and takes real time.
                var warm = 0;
                var waited = System.Diagnostics.Stopwatch.StartNew();
                while (warm < 30 || seats.Any(seat => (uplink.PlanOf(seat)?.Pairs.Count ?? 0) == 0))
                {
                    Assert.True(waited.Elapsed < TestBudgets.Op, "no plan of the craft after " + warm + " ticks");
                    warm++;
                    engine.TickAndWait(warm, game.Snapshot(warm), TestBudgets.Op);
                    if (warm >= 30)
                    {
                        System.Threading.Thread.Sleep(10);
                    }
                }

                PerfTelemetry.Enabled = true;
                try
                {
                    var ticks = warm + Setting("DECK_COST_TICKS", 400);
                    var totalMs = 0.0;
                    var counted = 0;
                    var compared = 0;
                    var allocatedBefore = GC.GetTotalAllocatedBytes(false);
                    for (var ut = warm + 1; ut <= ticks; ut++)
                    {
                        engine.TickAndWait(ut, game.Snapshot(ut), TestBudgets.Op);
                        if (ut % 20 == 0)
                        {
                            // What the comparison itself allocates is taken back out of the figure below.
                            var before = GC.GetTotalAllocatedBytes(false);
                            compared += AssertFiguresAreTheSearchedOnes(uplink, game, seats, ut);
                            allocatedBefore += GC.GetTotalAllocatedBytes(false) - before;
                        }
                        if ((ut - warm) % 100 == 0 || ut == ticks)
                        {
                            var phases = Phases(PerfTelemetry.TakeIntervalJson()!);
                            totalMs += phases["courier.handles"].Total;
                            counted += phases["courier.handles"].Count;
                            _output.WriteLine("UT " + ut + ": " + string.Join(", ", phases
                                .Where(p => p.Key.StartsWith("courier.", StringComparison.Ordinal))
                                .Where(p => p.Value.Total / Math.Max(1, p.Value.Count) >= 0.05)
                                .Select(p => p.Key + " " + (p.Value.Total / Math.Max(1, p.Value.Count)).ToString("F2", CultureInfo.InvariantCulture)
                                    + " (max " + p.Value.Max.ToString("F0", CultureInfo.InvariantCulture) + ")")));
                            _output.WriteLine("  " + uplink.Census);
                        }
                    }
                    var meanMs = totalMs / Math.Max(1, counted);
                    var allocatedKb = (GC.GetTotalAllocatedBytes(false) - allocatedBefore) / 1024.0 / Math.Max(1, ticks - warm);
                    _output.WriteLine("mean handles " + meanMs.ToString("F2", CultureInfo.InvariantCulture) + " ms over " + counted + " ticks, "
                        + allocatedKb.ToString("F0", CultureInfo.InvariantCulture) + " KB allocated a tick by the whole process, " + compared + " figures compared");
                    Assert.True(compared > 0, "no plan was ready to compare a figure against");
                    Assert.True(meanMs < MeanHandlesCeilingMs, "mean handles " + meanMs.ToString("F1", CultureInfo.InvariantCulture) + " ms a tick");
                }
                finally
                {
                    PerfTelemetry.Enabled = false;
                }
            }
            finally
            {
                engine.Stop();
                engine.Dispose();
            }
        }

        /// <summary>
        /// The most the knowledge board may cost on a tick under warp, averaged over
        /// the run, in milliseconds. Solving a craft's line of sight once for each
        /// centre costs 80 to 95 on a machine where solving it once for all of
        /// them costs 20 to 25.
        /// </summary>
        private const double MeanWarpBoardCeilingMs = 40.0;

        /// <summary>
        /// Under rails warp each look is hundreds of game seconds after the last, so every
        /// craft's line of sight to every centre is solved across the gap for the instants
        /// it opened and closed.
        /// </summary>
        [Fact]
        public async Task TheKnowledgeBoardCostsTheCourierLittleOnEachTickUnderWarp()
        {
            var game = new DeckGame(
                stations: Setting("DECK_COST_STATIONS", 13),
                craft: Setting("DECK_COST_CRAFT", 17),
                backend: Environment.GetEnvironmentVariable("DECK_COST_BACKEND") ?? "range");
            var (engine, uplink) = Start(game);
            try
            {
                await using var host = await SitAtAsync(engine, DeckGame.StationId(0));
                await using var station = await SitAtAsync(engine, DeckGame.StationId(5));
                for (var ut = 1; ut <= 30; ut++)
                {
                    engine.TickAndWait(ut, game.Snapshot(ut), TestBudgets.Op);
                }

                PerfTelemetry.Enabled = true;
                try
                {
                    var step = Setting("DECK_COST_WARP_STEP", 500);
                    var ticks = Setting("DECK_COST_WARP_TICKS", 30);
                    PerfTelemetry.TakeIntervalJson();
                    var at = 30.0;
                    for (var i = 0; i < ticks; i++)
                    {
                        at += step;
                        engine.TickAndWait(at, game.Snapshot(at), TestBudgets.Op);
                    }
                    var phases = Phases(PerfTelemetry.TakeIntervalJson()!);
                    var board = phases["courier.knowledgeBoard"];
                    var handles = phases["courier.handles"];
                    var meanMs = board.Total / Math.Max(1, board.Count);
                    _output.WriteLine("warp of " + step + " s a tick: knowledge board " + meanMs.ToString("F2", CultureInfo.InvariantCulture)
                        + " ms a tick (max " + board.Max.ToString("F0", CultureInfo.InvariantCulture) + "), handles "
                        + (handles.Total / Math.Max(1, handles.Count)).ToString("F2", CultureInfo.InvariantCulture)
                        + " (max " + handles.Max.ToString("F0", CultureInfo.InvariantCulture) + ") over " + board.Count + " ticks");
                    _output.WriteLine("  " + uplink.Census);
                    Assert.True(meanMs < MeanWarpBoardCeilingMs, "mean knowledge board " + meanMs.ToString("F1", CultureInfo.InvariantCulture) + " ms a tick under warp");
                }
                finally
                {
                    PerfTelemetry.Enabled = false;
                }
            }
            finally
            {
                engine.Stop();
                engine.Dispose();
            }
        }

        /// <summary>
        /// Holds what each seated centre is told of the next loss and of the delays between
        /// centres to the same figures searched for the plain way, on the plan the centre
        /// holds at this tick. Returns how many figures were compared.
        /// </summary>
        private static int AssertFiguresAreTheSearchedOnes(DeckUplink uplink, DeckGame game, string[] seats, double ut)
        {
            var stations = game.StationIds.ToList();
            var home = DeckGame.StationId(0);
            var roster = stations.Select(id => new CommandCentreEntry { Id = id, DisplayName = id, Active = true }).ToList();
            var compared = 0;
            foreach (var centre in seats)
            {
                var plan = uplink.PlanOf(centre);
                if (plan == null || ut < plan.FromUt)
                {
                    continue;
                }
                var searched = Sitrep.Host.Tests.Comms.ContactLossBySearch.Next(plan, DeckGame.ActiveCraft, centre, home, stations, ut);
                var swept = ContactLoss.Next(plan, DeckGame.ActiveCraft, centre, home, stations, ut);
                Assert.Equal(
                    (searched.Basis, searched.Ut, searched.NextAcquisitionUt, searched.CoveredToUt, searched.LowConfidence),
                    (swept.Basis, swept.Ut, swept.NextAcquisitionUt, swept.CoveredToUt, swept.LowConfidence));
                compared++;

                var table = CentreFigures.Separation(roster, plan, home, stations, ut, 1.0);
                foreach (var from in stations)
                {
                    foreach (var to in stations)
                    {
                        var alone = CentreFigures.Between(from, to, plan, home, stations, ut, 1.0);
                        Assert.Equal(alone, table.Pairs.SingleOrDefault(p => p.From == from && p.To == to)?.OneWaySeconds);
                        compared++;
                    }
                }
            }
            return compared;
        }

        private static Dictionary<string, (double Total, double Max, int Count)> Phases(string json)
        {
            using var doc = JsonDocument.Parse("{" + json + "}");
            var phases = new Dictionary<string, (double, double, int)>();
            foreach (var phase in doc.RootElement.GetProperty("phases").EnumerateObject())
            {
                phases[phase.Name] = (
                    phase.Value.GetProperty("totalMs").GetDouble(),
                    phase.Value.GetProperty("maxMs").GetDouble(),
                    phase.Value.GetProperty("count").GetInt32());
            }
            return phases;
        }

        private static (ChannelEngine Engine, DeckUplink Uplink) Start(DeckGame game)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var wall = 0.0;
            engine.SetReleaseClockForTests(() => wall += 0.05);
            engine.RegisterCommandCentreSource(new Stations(game));
            var uplink = new DeckUplink(game, engine);
            uplink.DeclareCapabilities(engine.Kernel);
            engine.ResolveCapabilities();
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.TickAndWait(0.0, game.Snapshot(0.0), TestBudgets.Op);
            return (engine, uplink);
        }

        private static async Task<TestClient> SitAtAsync(ChannelEngine engine, string centre)
        {
            var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
            await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
            foreach (var topic in ContactPlanSource.Channels().Select(c => c.Topic))
            {
                Assert.Equal("subscribed", (await SubscribeAsync(client, topic, TestBudgets.Op)).Name);
            }
            return client;
        }

        /// <summary>A career relay network: ground stations spread round Kerbin's equator and a fleet in orbit above them.</summary>
        internal sealed class DeckGame : IContactGame
        {
            private const double KerbinMu = 3.5316e12;
            private const double KerbinRadius = 600_000.0;
            private const double KerbinSiderealDay = 21_549.425;
            private const int Kerbin = 1;
            private const double SpeedOfLight = 299_792_458.0;

            private const double SunMu = 1.1723328e18;
            private const double EveMu = 8.1717302e12;
            private const double DunaMu = 3.0136321e11;
            private const double JoolMu = 2.82528e14;

            private static SystemBody Body(int parent, double sma, double ecc, double incDeg, double phase, double parentMu) =>
                new SystemBody(parent, new OrbitElements(sma, ecc, incDeg * Math.PI / 180.0, phase, 0.0, phase * 2.0, 0.0, parentMu));

            /// <summary>
            /// The stock system, all seventeen bodies: a line of sight is tested against every
            /// one of them, so how many there are is most of what a line costs to solve.
            /// </summary>
            private static readonly IReadOnlyList<SystemBody> Bodies = new[]
            {
                new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
                new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
                Body(1, 12_000_000.0, 0.0, 0.0, 1.7, KerbinMu),
                Body(1, 47_000_000.0, 0.0, 6.0, 0.9, KerbinMu),
                Body(0, 5_263_138_304.0, 0.2, 7.0, 3.1, SunMu),
                Body(0, 9_832_684_544.0, 0.01, 2.1, 0.3, SunMu),
                Body(5, 31_500_000.0, 0.55, 12.0, 0.9, EveMu),
                Body(0, 20_726_155_264.0, 0.051, 0.06, 2.4, SunMu),
                Body(7, 3_200_000.0, 0.03, 0.2, 1.1, DunaMu),
                Body(0, 40_839_348_203.0, 0.145, 5.0, 3.1, SunMu),
                Body(0, 68_773_560_320.0, 0.05, 1.3, 0.1, SunMu),
                Body(10, 27_184_000.0, 0.0, 0.0, 3.1, JoolMu),
                Body(10, 43_152_000.0, 0.0, 0.0, 0.9, JoolMu),
                Body(10, 68_500_000.0, 0.0, 0.025, 3.1, JoolMu),
                Body(10, 128_500_000.0, 0.235, 15.0, 0.9, JoolMu),
                Body(10, 179_890_000.0, 0.171, 4.25, 0.9, JoolMu),
                Body(0, 90_118_820_000.0, 0.26, 6.15, 3.1, SunMu),
            };

            /// <summary>Each body's radius, in metres, by its place in <see cref="Bodies"/>.</summary>
            private static readonly double[] Radii =
            {
                261_600_000.0, KerbinRadius, 200_000.0, 60_000.0, 250_000.0, 700_000.0, 13_000.0, 320_000.0, 130_000.0,
                138_000.0, 6_000_000.0, 500_000.0, 300_000.0, 600_000.0, 65_000.0, 44_000.0, 210_000.0,
            };

            private readonly int _stations;
            private readonly List<(string Guid, OrbitElements Orbit)> _craft = new List<(string, OrbitElements)>();

            public DeckGame(int stations, int craft, string backend)
            {
                Backend = backend;
                _stations = stations;
                for (var i = 0; i < craft; i++)
                {
                    // Low probes, mid relays and a few high relays, spread in phase and inclination.
                    var radius = KerbinRadius + (i % 3 == 0 ? 80_000.0 : i % 3 == 1 ? 750_000.0 : 2_800_000.0);
                    var orbit = new OrbitElements(radius, 0.0, (i % 4) * 0.3, i * 0.7, 0.0, i * 2.0 * Math.PI / craft, 0.0, KerbinMu);
                    _craft.Add(("c" + i.ToString("D2", CultureInfo.InvariantCulture), orbit));
                }
            }

            /// <summary>Which comms backend is elected: "none", "range" for stock's range curve, or "budget" for a link budget per antenna pair.</summary>
            public string Backend { get; }

            private CommsNodeHandle? Radio(string id) => Backend == "none" ? null : CommsNodeHandle.Of(id);

            /// <summary>The UT the next look is taken at.</summary>
            public double Ut { get; set; }

            /// <summary>Where a circular orbit puts its craft at <paramref name="ut"/>, in Kerbin's inertial frame.</summary>
            private static (double X, double Y, double Z) PositionOf(OrbitElements orbit, double ut)
            {
                var angle = orbit.MeanAnomalyAtEpoch + (Math.Sqrt(KerbinMu / (orbit.Sma * orbit.Sma * orbit.Sma)) * ut);
                var x = orbit.Sma * Math.Cos(angle);
                var y = orbit.Sma * Math.Sin(angle) * Math.Cos(orbit.Inc);
                var z = orbit.Sma * Math.Sin(angle) * Math.Sin(orbit.Inc);
                return ((x * Math.Cos(orbit.Lan)) - (y * Math.Sin(orbit.Lan)), (x * Math.Sin(orbit.Lan)) + (y * Math.Cos(orbit.Lan)), z);
            }

            /// <summary>The craft the snapshot names as active.</summary>
            public const string ActiveCraft = "vessel:c00";

            public static string StationId(int i) => "ground:S" + i.ToString("D2", CultureInfo.InvariantCulture);

            public IEnumerable<string> StationIds => Enumerable.Range(0, _stations).Select(StationId);

            public IReadOnlyList<string> Centres() => StationIds.ToList();

            private static RotatingGroundStation Surface(double longitudeDeg) =>
                RotatingGroundStation.FromLatitudeLongitude(0.0, longitudeDeg, 0.0, KerbinSiderealDay, KerbinRadius, 0.0);

            private static CommandCentreEntry Station(string id) => new CommandCentreEntry
            {
                Id = id, DisplayName = id, Kind = nameof(CommandCentreKind.GroundStation), BodyIndex = Kerbin, Active = true, DelayQuality = "routed",
            };

            public ContactGameLook? Look()
            {
                var nodes = new List<ContactGameNode>();
                foreach (var (guid, orbit) in _craft)
                {
                    nodes.Add(ContactGameNode.OrbitingCraft("vessel:" + guid, Kerbin, orbit, Radio("vessel:" + guid), "Craft " + guid));
                }
                var roster = new List<CommandCentreEntry>();
                for (var i = 0; i < _stations; i++)
                {
                    nodes.Add(ContactGameNode.GroundStation(StationId(i), Kerbin, Surface(i * 360.0 / _stations), Radio(StationId(i)), StationId(i)));
                    roster.Add(Station(StationId(i)));
                }
                var sight = new Dictionary<string, IReadOnlyDictionary<string, double>>();
                foreach (var (guid, orbit) in _craft)
                {
                    var craftAt = PositionOf(orbit, Ut);
                    var row = new Dictionary<string, double>();
                    for (var i = 0; i < _stations; i++)
                    {
                        var longitude = (i * 2.0 * Math.PI / _stations) + (2.0 * Math.PI * Ut / KerbinSiderealDay);
                        var up = (Math.Cos(longitude), Math.Sin(longitude), 0.0);
                        var line = (craftAt.X - (up.Item1 * KerbinRadius), craftAt.Y - (up.Item2 * KerbinRadius), craftAt.Z);
                        if ((line.Item1 * up.Item1) + (line.Item2 * up.Item2) > 0.0)
                        {
                            var metres = Math.Sqrt((line.Item1 * line.Item1) + (line.Item2 * line.Item2) + (line.Item3 * line.Item3));
                            row[StationId(i)] = metres / SpeedOfLight;
                        }
                    }
                    sight["vessel:" + guid] = row;
                }
                return new ContactGameLook(nodes, Bodies, Kerbin, (_, index) => index >= 0 && index < Radii.Length ? Radii[index] : 0.0)
                {
                    Roster = roster,
                    Sight = sight,
                    Vessels = _craft.Select(c => c.Guid).ToList(),
                };
            }

            public IEnumerable<(string Guid, double Seconds)> CraftDelays() =>
                _craft.Select(c => (c.Guid, (c.Orbit.Sma - KerbinRadius) / SpeedOfLight));

            public KspSnapshot Snapshot(double ut)
            {
                Ut = ut;
                var roster = _craft.Select(c => (object?)new Dictionary<string, object?>
                {
                    ["id"] = c.Guid,
                    ["name"] = "Craft " + c.Guid,
                    ["vesselType"] = "Relay",
                    ["situation"] = "ORBITING",
                    ["commsConnected"] = true,
                    ["sma"] = c.Orbit.Sma,
                    ["ecc"] = c.Orbit.Ecc,
                    ["epoch"] = c.Orbit.Epoch,
                }).ToList();
                return new KspSnapshot
                {
                    Ut = ut,
                    Values = new Dictionary<string, object?>
                    {
                        ["vessel"] = new Dictionary<string, object?> { ["identity"] = new Dictionary<string, object?> { ["id"] = _craft[0].Guid } },
                        ["vessels"] = roster,
                    },
                };
            }
        }

        /// <summary>The production contact plan over <see cref="DeckGame"/>, looking on every tick as the game's one-second cadence does.</summary>
        private sealed class DeckUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            private readonly ContactPlanSource _source;
            private readonly DeckGame _game;
            private readonly ChannelEngine _engine;
            private readonly DeliveryInputs _inputs = new DeliveryInputs();
            private float _wall;

            public DeckUplink(DeckGame game, ChannelEngine engine)
            {
                _game = game;
                _engine = engine;
                _source = new ContactPlanSource(game, () => _wall += 1f, warn: Console.WriteLine);
                _inputs.SetLightFactor(1.0);
                engine.SetDeliveryInputs(_inputs);
                Manifest = new UplinkManifest
                {
                    Id = "deck-cost-test",
                    Version = "1.0.0",
                    Channels = ContactPlanSource.Channels(),
                    Commands = ContactPlanSource.Commands(),
                };
            }

            public UplinkManifest Manifest { get; }

            public string Census => _source.CensusDescribe();

            /// <summary>The plan <paramref name="centre"/> holds. Read between ticks, when the Courier is idle.</summary>
            public Sitrep.Propagation.Contacts.ContactPlan? PlanOf(string centre) => _source.PlanOf(centre);

            public UplinkHealth Health() => _source.Health();

            public void DeclareCapabilities(Kernel kernel)
            {
                if (_game.Backend != "none")
                {
                    CommsElection.RegisterCapability(kernel, _ => new DeckBackend(_game.Backend == "budget"));
                }
            }

            public void Register(IUplinkHost host)
            {
                // Before the plan's own source, as the delay Uplinks are registered before it in the game.
                host.AddSampledSource(_ => _game, _ => WriteLedger());
                _source.Register(host);
            }

            /// <summary>Courier thread: every craft heard at every centre over its own light-time, as the game's delay Uplinks write the ledger.</summary>
            private void WriteLedger()
            {
                var rows = new List<(string, string, double)>();
                var links = new List<(string, string, double)>();
                foreach (var (guid, seconds) in _game.CraftDelays())
                {
                    _engine.SetVesselDelay(guid, seconds);
                    _engine.SetVesselConnectivity(guid, true);
                    foreach (var centre in _game.StationIds)
                    {
                        rows.Add((centre, guid, seconds));
                        links.Add((centre, "vessel:" + guid, seconds));
                    }
                }
                _engine.SetAuthorityDelays(rows);
                _engine.SetActiveVesselDelays(_game.StationIds.ToDictionary(id => id, _ => rows[0].Item3));
                _inputs.SetLinks(new LiveLinkGraph(links));
            }
        }

        /// <summary>
        /// A comms backend that costs what a real one costs to ask: stock's range
        /// curve for each pair, or a link budget worked out over every antenna
        /// pair and data rate with the facts of the best one stated on the hop.
        /// </summary>
        private sealed class DeckBackend : ICommsBackend, ICommsPathStrength, ICommsContactModel
        {
            private readonly bool _budget;

            public DeckBackend(bool budget) => _budget = budget;

            public string ProviderId => "deck-cost";

            public IContactLinkStrength? LinkStrength(CommsNodeHandle? from, CommsNodeHandle? to, double ut) =>
                from == null || to == null ? null
                : _budget ? new LinkBudget(AntennasOf(from), AntennasOf(to))
                : new RangeCurveStrength(60_000_000.0);

            public IContactLinkModel? LinkModel(CommsNodeHandle? from, CommsNodeHandle? to, double ut) =>
                _budget && from != null && to != null ? new LinkBudget(AntennasOf(from), AntennasOf(to)) : null;

            public double Combine(IReadOnlyList<double> hopStrengths) => PathStrengths.Weakest(hopStrengths);

            private static double[] AntennasOf(CommsNodeHandle node) =>
                node.As<string>() is string id && id.StartsWith("ground:", StringComparison.Ordinal) ? new[] { 40.0, 34.0, 26.0 } : new[] { 6.0, 18.0 };

            public CommsConnectivity Connectivity() => new CommsConnectivity { Connected = true, ControlSource = CommsControlSource.Full, HasLocalControl = true };

            public CommsSignal Signal() => new CommsSignal { Strength = 0.87 };

            public CommsControl ControlState() => new CommsControl { Level = CommsControlStateKind.Full };

            public CommsPath Path(object? vessel) => new CommsPath();

            public CommsNetwork Network(object? vessel) => new CommsNetwork { Meta = new PayloadMeta { Source = "game" } };

            public IReadOnlyList<CommsRouteHop>? RouteBetween(CommsNodeHandle? from, CommsNodeHandle? to) => null;

            public bool? StillCarriesTo(object? vessel, string nodeId) => null;

            public ICommsReachModel ReachModel(CommsNodeHandle? from, CommsNodeHandle? to) => CommsReachModels.Unknown;

            public ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;

            public CommsNodeHandle? ControlPathTerminus(object? vessel) => null;

            public ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;

            /// <summary>Received power against the noise floor for every antenna pair at every rate of a ladder, as a radio link budget is worked.</summary>
            private sealed class LinkBudget : IContactLinkStrength, IContactLinkModel
            {
                private static readonly double[] RatesBps = { 8.0, 32.0, 128.0, 512.0, 2048.0, 8192.0, 32768.0, 131072.0, 524288.0, 2097152.0 };
                private readonly double[] _fromGainsDb;
                private readonly double[] _toGainsDb;

                public LinkBudget(double[] fromGainsDb, double[] toGainsDb)
                {
                    _fromGainsDb = fromGainsDb;
                    _toGainsDb = toGainsDb;
                }

                private (double MarginDb, double RateBps, double RxDbm, double NoiseDbm, int From, int To) Best(double separationMeters)
                {
                    var best = (MarginDb: double.NegativeInfinity, RateBps: 0.0, RxDbm: 0.0, NoiseDbm: 0.0, From: 0, To: 0);
                    for (var f = 0; f < _fromGainsDb.Length; f++)
                    {
                        for (var t = 0; t < _toGainsDb.Length; t++)
                        {
                            var pathLossDb = (20.0 * Math.Log10(Math.Max(1.0, separationMeters))) + (20.0 * Math.Log10(2.25e9)) - 147.55;
                            var rxDbm = 40.0 + _fromGainsDb[f] + _toGainsDb[t] - pathLossDb;
                            foreach (var rate in RatesBps)
                            {
                                var noiseDbm = -174.0 + (10.0 * Math.Log10(rate)) + (10.0 * Math.Log10(1.0 + (290.0 / 60.0)));
                                var margin = rxDbm - noiseDbm - 3.0;
                                if (margin >= 0.0 && rate >= best.RateBps)
                                {
                                    best = (margin, rate, rxDbm, noiseDbm, f, t);
                                }
                            }
                            if (best.RateBps == 0.0 && rxDbm + 174.0 > best.MarginDb)
                            {
                                best = (rxDbm + 174.0 - (10.0 * Math.Log10(RatesBps[0])) - 10.0, 0.0, rxDbm, -174.0, f, t);
                            }
                        }
                    }
                    return best;
                }

                public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) =>
                    Best((from - to).Magnitude()).MarginDb;

                public ContactHopFacts FactsAt(double ut, double separationMeters)
                {
                    var best = Best(separationMeters);
                    var strength = Math.Log(1.0 + best.RateBps) / Math.Log(1.0 + RatesBps[RatesBps.Length - 1]);
                    return new ContactHopFacts(strength, SignalQuantity.DataRateHeadroom, new Dictionary<string, object?>
                    {
                        ["deckCost"] = new Dictionary<string, object?>
                        {
                            ["rateBps"] = best.RateBps,
                            ["marginDb"] = best.MarginDb,
                            ["rxDbm"] = best.RxDbm,
                            ["noiseDbm"] = best.NoiseDbm,
                            ["fromAntenna"] = best.From,
                            ["toAntenna"] = best.To,
                        },
                    });
                }
            }
        }

        private sealed class Stations : ICommandCentreSource
        {
            private readonly DeckGame _game;

            public Stations(DeckGame game) => _game = game;

            public string ProviderId => "deck-cost-test";

            public IEnumerable<ICommandCentre> Enumerate() => _game.StationIds.Select(id => (ICommandCentre)new Ground(id));

            private sealed class Ground : ICommandCentre
            {
                public Ground(string id) => Id = id;

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
