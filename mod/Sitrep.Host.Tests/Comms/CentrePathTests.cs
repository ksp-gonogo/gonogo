using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CentrePathTests
    {
        private const double Step = 10.0;
        private const double Horizon = 3600.0;
        private const string Probe = "vessel:probe";
        private const string Relay = "vessel:relay";
        private const string Crewed = "vessel:crewed";
        private const string Ksc = "ground:ksc";
        private const string Forward = "ground:forward";

        private static PairPlan Pair(string a, string b, double lightSeconds, params ContactWindow[] windows) =>
            new PairPlan(
                a, b, Horizon, windows, 0.0, Step,
                Enumerable.Repeat(lightSeconds * PairPlan.SpeedOfLight, (int)(Horizon / Step) + 1).ToArray());

        private static ContactWindow Always() => new ContactWindow(null, null);

        private static ContactPlan Plan(params PairPlan[] pairs) => new ContactPlan(0.0, Horizon, Step, pairs, 0, 0);

        private static readonly ContactGameNode[] Stations =
        {
            Station(Ksc, "Kerbal Space Center"),
            Station(Forward, "Forward Station"),
        };

        private static ContactGameNode Station(string id, string name) =>
            ContactGameNode.GroundStation(
                id, 1, RotatingGroundStation.FromLatitudeLongitude(0.0, 0.0, 0.0, 21_549.425, 600_000.0, 0.0), null, name);

        private static string? Name(string id) => id == Relay ? "Relay One" : id == Probe ? "Probe" : id == Crewed ? "Crewed" : null;

        [Fact]
        public void TheHomeCentreIsShownThePathToWhicheverStationThePlanReachesFirst()
        {
            var plan = Plan(
                Pair(Probe, Relay, 1.0, Always()),
                Pair(Relay, Ksc, 5.0, Always()),
                Pair(Relay, Forward, 2.0, Always()));

            var view = CentrePath.For(plan, Probe, Ksc, true, Stations, Name, 10.0);

            Assert.Equal(2, view.Path.Hops.Count);
            var first = view.Path.Hops[0];
            Assert.Equal("probe", first.From);
            Assert.Equal("relay", first.To);
            Assert.False(first.FromIsHome);
            Assert.False(first.ToIsHome);
            Assert.Equal(CommsHopKind.Relay, first.Kind);
            Assert.Equal(PairPlan.SpeedOfLight, first.DistanceMeters!.Value, 3);
            var last = view.Path.Hops[1];
            Assert.Equal("relay", last.From);
            Assert.Equal("Forward Station", last.To);
            Assert.True(last.ToIsHome);
            Assert.Equal(CommsHopKind.Home, last.Kind);
            Assert.Equal(2.0 * PairPlan.SpeedOfLight, last.DistanceMeters!.Value, 3);

            Assert.Equal(new[] { "probe", "relay", "Forward Station" }, view.Network.Nodes.Select(n => n.Id).ToArray());
            Assert.Equal(new[] { "Probe", "Relay One", "Forward Station" }, view.Network.Nodes.Select(n => n.DisplayName).ToArray());
            Assert.Equal(new[] { CommsHopKind.Relay, CommsHopKind.Relay, CommsHopKind.Home }, view.Network.Nodes.Select(n => n.Kind).ToArray());
            Assert.All(view.Network.Edges, e => Assert.True(e.Active));
            Assert.Equal(new[] { ("probe", "relay"), ("relay", "Forward Station") }, view.Network.Edges.Select(e => (e.A, e.B)).ToArray());
            Assert.Equal(Probe, view.Network.Meta.Source);

            Assert.Equal(Forward, view.CommandCentre.Id);
            Assert.Equal("Forward Station", view.CommandCentre.DisplayName);
            Assert.Equal("GroundStation", view.CommandCentre.Kind);
            Assert.Equal(1, view.CommandCentre.BodyIndex);
        }

        [Fact]
        public void AGroundStationThatIsNotHomeIsShownOnlyThePathToItself()
        {
            var plan = Plan(
                Pair(Probe, Relay, 1.0, Always()),
                Pair(Relay, Ksc, 5.0, Always()),
                Pair(Relay, Forward, 2.0, Always()));

            var view = CentrePath.For(plan, Probe, Ksc, false, Stations, Name, 10.0);

            Assert.Equal("Kerbal Space Center", view.Path.Hops[1].To);
            Assert.Equal(Ksc, view.CommandCentre.Id);
            Assert.Empty(CentrePath.For(Plan(Pair(Probe, Forward, 1.0, Always())), Probe, Ksc, false, Stations, Name, 10.0).Path.Hops);
        }

        [Fact]
        public void ACrewedCentreIsShownThePathToItselfAndNotToTheGround()
        {
            var plan = Plan(
                Pair(Probe, Ksc, 1.0, Always()),
                Pair(Probe, Relay, 1.0, Always()),
                Pair(Relay, Crewed, 4.0, Always()));

            var view = CentrePath.For(plan, Probe, Crewed, false, Stations, Name, 10.0);

            Assert.Equal(new[] { "relay", "crewed" }, view.Path.Hops.Select(h => h.To).ToArray());
            Assert.All(view.Path.Hops, h => Assert.Equal(CommsHopKind.Relay, h.Kind));
            Assert.Equal(Crewed, view.CommandCentre.Id);
            Assert.Equal("Crewed", view.CommandCentre.DisplayName);
            Assert.Equal("CrewedVessel", view.CommandCentre.Kind);
            Assert.Null(view.CommandCentre.BodyIndex);
        }

        [Fact]
        public void TheCentreThatIsTheActiveCraftIsShownItsOwnPathToTheGround()
        {
            var plan = Plan(Pair(Crewed, Ksc, 1.0, Always()));

            var view = CentrePath.For(plan, Crewed, Crewed, false, Stations, Name, 10.0);

            Assert.Equal("Kerbal Space Center", Assert.Single(view.Path.Hops).To);
            Assert.Equal(Ksc, view.CommandCentre.Id);
        }

        [Fact]
        public void APathThatWouldWaitAtANodeIsNoPath()
        {
            var plan = Plan(
                Pair(Probe, Relay, 1.0, Always()),
                Pair(Relay, Ksc, 1.0, new ContactWindow(1000.0, null)));

            var view = CentrePath.For(plan, Probe, Ksc, true, Stations, Name, 10.0);

            Assert.Empty(view.Path.Hops);
            Assert.Empty(view.Network.Nodes);
            Assert.Empty(view.Network.Edges);
            Assert.Null(view.CommandCentre.Id);
            Assert.Null(view.CommandCentre.DisplayName);
            Assert.Null(view.CommandCentre.Kind);
        }

        [Fact]
        public void ACraftTheCentreHasNotHeardOfHasNoPathAndNeitherHasNoCraftAtAll()
        {
            var plan = Plan(Pair(Relay, Ksc, 1.0, Always()));

            Assert.Empty(CentrePath.For(plan, Probe, Ksc, true, Stations, Name, 10.0).Path.Hops);
            var none = CentrePath.For(plan, null, Ksc, true, Stations, Name, 10.0);
            Assert.Empty(none.Path.Hops);
            Assert.Equal("game", none.Network.Meta.Source);
            Assert.Empty(CentrePath.For(null, Probe, Ksc, true, Stations, Name, 10.0).Path.Hops);
        }

        [Fact]
        public void TheShapeMovesWithTheNodesAndNotWithTheirDistances()
        {
            var near = CentrePath.For(Plan(Pair(Probe, Ksc, 1.0, Always())), Probe, Ksc, true, Stations, Name, 10.0);
            var further = CentrePath.For(Plan(Pair(Probe, Ksc, 2.0, Always())), Probe, Ksc, true, Stations, Name, 10.0);
            var elsewhere = CentrePath.For(Plan(Pair(Probe, Forward, 1.0, Always())), Probe, Ksc, true, Stations, Name, 10.0);

            Assert.Equal(near.Shape, further.Shape);
            Assert.NotEqual(near.Shape, elsewhere.Shape);
        }
    }
}
