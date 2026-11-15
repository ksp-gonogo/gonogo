using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
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
    /// What a tick costs the Courier with a network the size of a career relay
    /// save: thirteen ground stations that are each a command centre, a fleet of
    /// relays and probes in orbit of Kerbin, and two sessions seated at two of
    /// the stations. Ticked once a game second as the game ticks at 1x, every
    /// tick taking a look, then across rails-warp steps.
    ///
    /// <para>The ceilings are about ten times what a development machine
    /// measures, so they hold on a loaded CI runner and still fail on a cost
    /// that grows by an order of magnitude. The figures each run measured are
    /// written to the test output.</para>
    /// </summary>
    public class ContactPlanFleetCostTests
    {
        /// <summary>The most a 1x tick may take on average, in real milliseconds.</summary>
        private const double SteadyTickCeilingMs = 50;

        /// <summary>The most a tick across a 500 s warp step may take on average, in real milliseconds.</summary>
        private const double WarpTickCeilingMs = 150;

        private const int SteadyTicks = 600;

        private readonly ITestOutputHelper _output;

        public ContactPlanFleetCostTests(ITestOutputHelper output) => _output = output;

        [Fact]
        public async Task ATickOfALargeRelayNetworkCostsTheCourierFarLessThanAFrame()
        {
            var game = new FleetGame(stations: 13, craft: 24);
            var (engine, uplink) = Start(game);
            try
            {
                await using var host = await SitAtAsync(engine, FleetGame.StationId(0));
                await using var station = await SitAtAsync(engine, FleetGame.StationId(5));

                // The first plans and the first look at every craft.
                for (var ut = 1; ut <= 30; ut++)
                {
                    engine.TickAndWait(ut, game.Snapshot(ut), TestBudgets.Op);
                }

                var steady = new List<double>();
                for (var ut = 31; ut < 31 + SteadyTicks; ut++)
                {
                    steady.Add(TimedTick(engine, game, ut));
                }
                var warped = new List<double>();
                var at = 30.0 + SteadyTicks;
                for (var i = 0; i < 20; i++)
                {
                    at += 500;
                    warped.Add(TimedTick(engine, game, at));
                }

                _output.WriteLine("1x tick: mean " + Ms(steady.Average()) + " ms, max " + Ms(steady.Max()) + " ms over " + steady.Count);
                _output.WriteLine("500 s warp tick: mean " + Ms(warped.Average()) + " ms, max " + Ms(warped.Max()) + " ms over " + warped.Count);
                _output.WriteLine(uplink.Census);
                Assert.True(steady.Average() < SteadyTickCeilingMs, "a 1x tick took " + Ms(steady.Average()) + " ms on average");
                Assert.True(warped.Average() < WarpTickCeilingMs, "a warp tick took " + Ms(warped.Average()) + " ms on average");
            }
            finally
            {
                engine.Stop();
                engine.Dispose();
            }
        }

        /// <summary>
        /// A centre that has never had a craft in view measures no delay to it,
        /// and what it keeps of each look at that pair is one sample, not one
        /// per look for as long as the game runs.
        /// </summary>
        [Fact]
        public async Task WhatACentreKeepsOfLooksAtACraftItHasNeverSeenDoesNotGrowWithTheSession()
        {
            var game = new FleetGame(stations: 13, craft: 24);
            var (engine, uplink) = Start(game);
            try
            {
                await using var host = await SitAtAsync(engine, FleetGame.StationId(0));
                for (var ut = 1; ut <= 200; ut++)
                {
                    engine.TickAndWait(ut, game.Snapshot(ut), TestBudgets.Op);
                }
                var early = KnowledgeSamples(uplink.Census);
                for (var ut = 201; ut <= 800; ut++)
                {
                    engine.TickAndWait(ut, game.Snapshot(ut), TestBudgets.Op);
                }
                var late = KnowledgeSamples(uplink.Census);

                _output.WriteLine("knowledge samples at UT 200: " + early + ", at UT 800: " + late);
                Assert.True(late < early * 2, "the samples kept grew from " + early + " to " + late + " over 600 looks");
            }
            finally
            {
                engine.Stop();
                engine.Dispose();
            }
        }

        private static double TimedTick(ChannelEngine engine, FleetGame game, double ut)
        {
            var started = System.Diagnostics.Stopwatch.GetTimestamp();
            engine.TickAndWait(ut, game.Snapshot(ut), TestBudgets.Op);
            return (System.Diagnostics.Stopwatch.GetTimestamp() - started) * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
        }

        private static string Ms(double ms) => ms.ToString("F1", CultureInfo.InvariantCulture);

        private static long KnowledgeSamples(string census)
        {
            var match = System.Text.RegularExpressions.Regex.Match(census, @"knowledge\.samples=(\d+)");
            Assert.True(match.Success, census);
            return long.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        }

        private static (ChannelEngine Engine, FleetUplink Uplink) Start(FleetGame game)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var wall = 0.0;
            engine.SetReleaseClockForTests(() => wall += 0.05);
            engine.RegisterCommandCentreSource(new Stations(game));
            var uplink = new FleetUplink(game, engine);
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.TickAndWait(0.0, game.Snapshot(0.0), TestBudgets.Op);
            return (engine, uplink);
        }

        private static async Task<TestClient> SitAtAsync(ChannelEngine engine, string centre)
        {
            var client = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
            await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
            foreach (var topic in new[]
            {
                ContactPlanSource.ContactsTopic,
                ContactPlanSource.RouteTopic,
                ContactPlanSource.PathTopic,
                ContactPlanSource.NetworkTopic,
                ContactPlanSource.CommandCentreTopic,
                ContactPlanSource.RosterTopic,
            })
            {
                Assert.Equal("subscribed", (await SubscribeAsync(client, topic, TestBudgets.Op)).Name);
            }
            return client;
        }

        /// <summary>A career relay network: ground stations spread round Kerbin's equator and a fleet in orbit above them.</summary>
        internal sealed class FleetGame : IContactGame
        {
            private const double KerbinMu = 3.5316e12;
            private const double KerbinRadius = 600_000.0;
            private const double KerbinSiderealDay = 21_549.425;
            private const int Kerbin = 1;
            private const double SpeedOfLight = 299_792_458.0;

            private static readonly IReadOnlyList<SystemBody> Bodies = new[]
            {
                new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
                new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)),
            };

            private readonly int _stations;
            private readonly List<(string Guid, OrbitElements Orbit)> _craft = new List<(string, OrbitElements)>();

            public FleetGame(int stations, int craft)
            {
                _stations = stations;
                for (var i = 0; i < craft; i++)
                {
                    // Low probes, mid relays and a few high relays, spread in phase and inclination.
                    var radius = KerbinRadius + (i % 3 == 0 ? 80_000.0 : i % 3 == 1 ? 750_000.0 : 2_800_000.0);
                    var orbit = new OrbitElements(radius, 0.0, (i % 4) * 0.3, i * 0.7, 0.0, i * 2.0 * Math.PI / craft, 0.0, KerbinMu);
                    _craft.Add(("c" + i.ToString("D2", CultureInfo.InvariantCulture), orbit));
                }
            }

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
                    nodes.Add(ContactGameNode.OrbitingCraft("vessel:" + guid, Kerbin, orbit, null, "Craft " + guid));
                }
                var roster = new List<CommandCentreEntry>();
                for (var i = 0; i < _stations; i++)
                {
                    nodes.Add(ContactGameNode.GroundStation(StationId(i), Kerbin, Surface(i * 360.0 / _stations), null, StationId(i)));
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
                return new ContactGameLook(nodes, Bodies, Kerbin, (_, index) => index == Kerbin ? KerbinRadius : 0.0)
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

        /// <summary>The production contact plan over <see cref="FleetGame"/>, looking on every tick as the game's one-second cadence does.</summary>
        private sealed class FleetUplink : ISitrepUplink
        {
            private readonly ContactPlanSource _source;
            private readonly FleetGame _game;
            private readonly ChannelEngine _engine;
            private readonly DeliveryInputs _inputs = new DeliveryInputs();
            private float _wall;

            public FleetUplink(FleetGame game, ChannelEngine engine)
            {
                _game = game;
                _engine = engine;
                _source = new ContactPlanSource(game, () => _wall += 1f);
                _inputs.SetLightFactor(1.0);
                engine.SetDeliveryInputs(_inputs);
                Manifest = new UplinkManifest
                {
                    Id = "fleet-cost-test",
                    Version = "1.0.0",
                    Channels = ContactPlanSource.Channels(),
                    Commands = ContactPlanSource.Commands(),
                };
            }

            public UplinkManifest Manifest { get; }

            public string Census => _source.CensusDescribe();

            public UplinkHealth Health() => _source.Health();

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

        private sealed class Stations : ICommandCentreSource
        {
            private readonly FleetGame _game;

            public Stations(FleetGame game) => _game = game;

            public string ProviderId => "fleet-cost-test";

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
