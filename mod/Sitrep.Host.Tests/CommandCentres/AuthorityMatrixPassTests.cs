using System.Collections.Generic;
using System.Linq;
using Sitrep.Host.CommandCentres;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests.CommandCentres
{
    public class AuthorityMatrixPassTests
    {
        private static (List<(string vantage, string node, double s)> calls, System.Action<string, string, double> sink) Recorder()
        {
            var calls = new List<(string, string, double)>();
            return (calls, (v, n, s) => calls.Add((v, n, s)));
        }

        /// <summary>
        /// The zero is for the craft's OWN row and nothing else, which is the only
        /// reading under which it is honest. Every assertion here is paired: an
        /// over-broad zero (dropping the kind/id test, or zeroing the routed value)
        /// fails on the second half of each pair even though the first half passes.
        /// </summary>
        [Fact]
        public void Populate_PricesACrewedCentresOwnCraftAtZero_AndEveryOtherPairAtFullRoute()
        {
            var (calls, sink) = Recorder();
            var centres = new ICommandCentre[]
            {
                new FakeCommandCentre("vessel:G", CommandCentreKind.CrewedVessel),
                new FakeCommandCentre("ksc"),
            };

            new AuthorityMatrixPass().Populate(centres, new[] { "G", "H" }, (_, __) => 5.0, sink);

            // The craft observing itself: no distance from itself.
            Assert.Contains(calls, x => x.vantage == "vessel:G" && x.node == "fleet.G" && x.s == 0.0);
            // The same craft observing a DIFFERENT subject: still the full routed delay.
            Assert.Contains(calls, x => x.vantage == "vessel:G" && x.node == "fleet.H" && x.s == 5.0);
            // The ground observing that craft: still the full routed delay, the zero
            // belongs to one row and does not leak along either axis.
            Assert.Contains(calls, x => x.vantage == "ksc" && x.node == "fleet.G" && x.s == 5.0);
            Assert.Contains(calls, x => x.vantage == "ksc" && x.node == "fleet.H" && x.s == 5.0);
            Assert.Equal(4, calls.Count);
        }

        [Fact]
        public void Populate_DoesNotPriceAGroundCentreAtZeroForALikeNamedSubject()
        {
            var (calls, sink) = Recorder();
            // A GroundStation whose id happens to spell a vessel subject. The
            // self-row is a statement about a craft being its own vantage, so the
            // kind is half of the test and not decoration.
            var centres = new ICommandCentre[] { new FakeCommandCentre("vessel:G", CommandCentreKind.GroundStation) };

            new AuthorityMatrixPass().Populate(centres, new[] { "G" }, (_, __) => 5.0, sink);

            var only = Assert.Single(calls);
            Assert.Equal(("vessel:G", "fleet.G", 5.0), only);
        }

        [Fact]
        public void Populate_WritesPerAuthorityRows_NoMinCollapse()
        {
            var (calls, sink) = Recorder();
            var centres = new ICommandCentre[]
            {
                new FakeCommandCentre("ksc"),
                new FakeCommandCentre("ground:gs1"),
            };

            // Different delays per authority; both rows must survive (no min-over-authorities).
            new AuthorityMatrixPass().Populate(
                centres,
                new[] { "G" },
                (c, _) => c.Id == "ksc" ? 300.0 : 2.0,
                sink);

            Assert.Contains(calls, x => x.vantage == "ksc" && x.node == "fleet.G" && x.s == 300.0);
            Assert.Contains(calls, x => x.vantage == "ground:gs1" && x.node == "fleet.G" && x.s == 2.0);
            Assert.Equal(2, calls.Count);
        }

        [Fact]
        public void Populate_SkipsUnreachablePairs()
        {
            var (calls, sink) = Recorder();

            new AuthorityMatrixPass().Populate(
                new ICommandCentre[] { new FakeCommandCentre("ksc") },
                new[] { "G" },
                (_, __) => null, // unreachable
                sink);

            Assert.Empty(calls);
        }

        private static Dictionary<string, double> ActiveVesselRows(
            IReadOnlyList<ICommandCentre> centres,
            string? activeGuid,
            string? homeId,
            System.Func<ICommandCentre, string, double?> route)
        {
            var rows = new Dictionary<string, double>();
            new AuthorityMatrixPass().PopulateActiveVessel(centres, activeGuid, homeId, route, (id, s) => rows[id] = s);
            return rows;
        }

        /// <summary>
        /// Paired like the fleet test above: the active craft's own centre reads zero, and
        /// a crewed centre that is NOT the active craft, the ground, and a station whose id
        /// spells the active craft all keep their routed number.
        /// </summary>
        [Fact]
        public void PopulateActiveVessel_PricesOnlyTheActiveCraftsOwnCentreAtZero()
        {
            var routes = new Dictionary<string, double> { ["vessel:H"] = 7.0, ["ground:gs1"] = 3.0 };
            var rows = ActiveVesselRows(
                new ICommandCentre[]
                {
                    new FakeCommandCentre("vessel:G", CommandCentreKind.CrewedVessel),
                    new FakeCommandCentre("vessel:H", CommandCentreKind.CrewedVessel),
                    new FakeCommandCentre("ground:gs1"),
                },
                "G",
                null,
                (centre, guid) => routes[centre.Id]);

            Assert.Equal(0.0, rows["vessel:G"]);
            Assert.Equal(7.0, rows["vessel:H"]);
            Assert.Equal(3.0, rows["ground:gs1"]);
            Assert.Equal(3, rows.Count);

            var likeNamed = ActiveVesselRows(
                new ICommandCentre[] { new FakeCommandCentre("vessel:G", CommandCentreKind.GroundStation) },
                "G",
                null,
                (_, __) => 5.0);
            Assert.Equal(5.0, likeNamed["vessel:G"]);
        }

        [Fact]
        public void PopulateActiveVessel_RoutesEachCentreToTheActiveGuid()
        {
            var asked = new List<string>();
            ActiveVesselRows(
                new ICommandCentre[] { new FakeCommandCentre("ground:gs1") },
                "G",
                null,
                (_, guid) => { asked.Add(guid); return 1.0; });

            Assert.Equal(new[] { "G" }, asked);
        }

        /// <summary>
        /// The home centre's row is the whole-network default already, so it is left to
        /// read that; the craft named home is still its own vantage and reads zero.
        /// </summary>
        [Fact]
        public void PopulateActiveVessel_LeavesTheHomeCentreOnTheDefault()
        {
            var rows = ActiveVesselRows(
                new ICommandCentre[] { new FakeCommandCentre("ksc"), new FakeCommandCentre("ground:gs1") },
                "G",
                "ksc",
                (_, __) => 5.0);
            Assert.False(rows.ContainsKey("ksc"));
            Assert.Equal(5.0, rows["ground:gs1"]);

            var craftHome = ActiveVesselRows(
                new ICommandCentre[] { new FakeCommandCentre("vessel:G", CommandCentreKind.CrewedVessel) },
                "G",
                "vessel:G",
                (_, __) => 5.0);
            Assert.Equal(0.0, craftHome["vessel:G"]);
        }

        [Fact]
        public void PopulateActiveVessel_WritesNothingForAnUnroutableCentreOrWithNoActiveCraft()
        {
            var centres = new ICommandCentre[]
            {
                new FakeCommandCentre("vessel:G", CommandCentreKind.CrewedVessel),
                new FakeCommandCentre("ground:gs1"),
            };

            var unroutable = ActiveVesselRows(centres, "G", null, (_, __) => null);
            Assert.Equal(("vessel:G", 0.0), (Assert.Single(unroutable).Key, unroutable["vessel:G"]));

            Assert.Empty(ActiveVesselRows(centres, null, null, (_, __) => 5.0));
        }

        [Fact]
        public void FleetNode_MatchesPlan2FleetNamespace()
        {
            Assert.Equal(ChannelEngine.FleetNodePrefix + "G", AuthorityMatrixPass.FleetNode("G"));
            Assert.Equal("fleet.G", AuthorityMatrixPass.FleetNode("G"));
        }

        [Fact]
        public void CentreNode_MirrorsTheFleetNamespace()
        {
            Assert.Equal(ChannelEngine.CentreNodePrefix + "ksc", AuthorityMatrixPass.CentreNode("ksc"));
            Assert.Equal("centre.ksc", AuthorityMatrixPass.CentreNode("ksc"));
        }

        [Fact]
        public void PopulateCentrePairs_WritesBothDirections_Independently()
        {
            var (calls, sink) = Recorder();
            var centres = new ICommandCentre[]
            {
                new FakeCommandCentre("ksc"),
                new FakeCommandCentre("ground:gs1"),
            };

            new AuthorityMatrixPass().PopulateCentrePairs(
                centres,
                (from, to) => from.Id == "ksc" ? 12.0 : 34.0,
                sink);

            Assert.Contains(calls, x => x.vantage == "ksc" && x.node == "centre.ground:gs1" && x.s == 12.0);
            Assert.Contains(calls, x => x.vantage == "ground:gs1" && x.node == "centre.ksc" && x.s == 34.0);
        }

        [Fact]
        public void PopulateCentrePairs_ACentreIsZeroDistanceFromItself()
        {
            var (calls, sink) = Recorder();

            new AuthorityMatrixPass().PopulateCentrePairs(
                new ICommandCentre[] { new FakeCommandCentre("ksc") },
                // A self-path is not a route, so routing reports nothing; the
                // pass still has to state the zero itself, or the pair would
                // fall through to the whole-network default.
                (_, __) => null,
                sink);

            var self = Assert.Single(calls);
            Assert.Equal(("ksc", "centre.ksc", 0.0), self);
        }

        [Fact]
        public void PopulateCentrePairs_SkipsUnroutablePairs_WithoutQuotingZero()
        {
            var (calls, sink) = Recorder();
            var centres = new ICommandCentre[]
            {
                new FakeCommandCentre("ksc"),
                new FakeCommandCentre("vessel:G", CommandCentreKind.CrewedVessel),
            };

            new AuthorityMatrixPass().PopulateCentrePairs(centres, (_, __) => null, sink);

            // Only the two self-rows; neither cross pair invents a delay.
            Assert.Equal(2, calls.Count);
            Assert.All(calls, x => Assert.Equal(0.0, x.s));
            Assert.DoesNotContain(calls, x => x.vantage == "ksc" && x.node == "centre.vessel:G");
            Assert.DoesNotContain(calls, x => x.vantage == "vessel:G" && x.node == "centre.ksc");
        }

    }
}
