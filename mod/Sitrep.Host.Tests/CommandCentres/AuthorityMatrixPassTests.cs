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

        [Fact]
        public void Populate_ExcludesCrewedCentreFromItsOwnSubjectRow()
        {
            var (calls, sink) = Recorder();
            var centres = new ICommandCentre[] { new FakeCommandCentre("vessel:G", CommandCentreKind.CrewedVessel) };

            new AuthorityMatrixPass().Populate(centres, new[] { "G", "H" }, (_, __) => 5.0, sink);

            // Self-excluded from its own subject G; present for the other subject H.
            Assert.DoesNotContain(calls, x => x.node == "fleet.G");
            Assert.Contains(calls, x => x.vantage == "vessel:G" && x.node == "fleet.H" && x.s == 5.0);
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
