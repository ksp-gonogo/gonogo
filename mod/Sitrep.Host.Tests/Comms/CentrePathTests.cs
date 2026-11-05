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

        private sealed class Flat : IContactLinkStrength
        {
            private readonly double _strength;

            public Flat(double strength) => _strength = strength;

            public ContactHopFacts FactsAt(double ut, double separationMeters) =>
                new ContactHopFacts(_strength, SignalQuantity.RangeFraction, new System.Collections.Generic.Dictionary<string, object?> { ["test"] = _strength });
        }

        private static readonly OrbitElements AnOrbit = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.5316e12);

        private static PathStrengths Heard(params (string Craft, string To, double Strength)[] links) =>
            new PathStrengths(
                links.GroupBy(l => l.Craft).Select(craft => CraftState.Orbiting(
                    craft.Key, 0.0, 1, AnOrbit, null, null, true,
                    craft.ToDictionary(l => l.To, l => new CraftLink(1e12, null, new Flat(l.Strength))))),
                null);

        [Fact]
        public void EachBelievedHopCarriesWhatTheBackendSaysItIsWorthAndThePathTheLeastOfThem()
        {
            var plan = Plan(
                Pair(Probe, Relay, 1.0, Always()),
                Pair(Relay, Forward, 2.0, Always()));

            var view = CentrePath.For(
                plan, Probe, Ksc, true, Stations, Name, 10.0, 1.0,
                Heard((Probe, Relay, 0.9), (Relay, Forward, 0.6)));

            Assert.Equal(new double?[] { 0.9, 0.6 }, view.Path.Hops.Select(h => h.Strength).ToArray());
            Assert.All(view.Path.Hops, h => Assert.Equal(SignalQuantity.RangeFraction, h.Quantity));
            Assert.All(view.Path.Hops, h => Assert.NotNull(h.Extensions));
            Assert.Equal(0.6, view.Strength!.Value, 9);
        }

        [Fact]
        public void WithNoStrengthsTheHopsCarryNoneAndThePathIsWorthNothingStated()
        {
            var plan = Plan(Pair(Probe, Ksc, 2.0, Always()));

            var view = CentrePath.For(plan, Probe, Ksc, true, Stations, Name, 10.0);

            Assert.Null(view.Path.Hops.Single().Strength);
            Assert.Null(view.Path.Hops.Single().Quantity);
            Assert.Null(view.Strength);
        }

        /// <summary>
        /// Two stations a millisecond of light apart are the same arrival as
        /// far as the plan can tell, so the stronger is the believed path, as
        /// it is the game's.
        /// </summary>
        [Fact]
        public void BetweenStationsTheSignalReachesAtTheSameTimeTheHomeCentreBelievesInTheStrongerPath()
        {
            var plan = Plan(
                Pair(Probe, Ksc, 2.0, Always()),
                Pair(Probe, Forward, 2.001, Always()));

            var plain = CentrePath.For(plan, Probe, Ksc, true, Stations, Name, 10.0);
            Assert.Equal("Kerbal Space Center", plain.Path.Hops.Single().To);

            var view = CentrePath.For(
                plan, Probe, Ksc, true, Stations, Name, 10.0, 1.0,
                Heard((Probe, Ksc, 0.3), (Probe, Forward, 0.8)));

            Assert.Equal("Forward Station", view.Path.Hops.Single().To);
            Assert.Equal(0.8, view.Strength!.Value, 9);
        }

        /// <summary>Weighing the other stations is one route search each, and none is made for a centre with only itself to be shown the path to.</summary>
        [Fact]
        public void OneRouteIsSearchedForEachOtherStationAndNoneForACentreShownThePathToItself()
        {
            var plan = Plan(
                Pair(Probe, Ksc, 2.0, Always()),
                Pair(Probe, Forward, 2.001, Always()));
            var strengths = Heard((Probe, Ksc, 0.3), (Probe, Forward, 0.8));

            CentrePath.For(plan, Probe, Ksc, true, Stations, Name, 10.0, 1.0, strengths);
            Assert.Equal(Stations.Length - 1, strengths.RoutesWeighed);

            // A centre shown the path to itself has one destination and nothing to choose between.
            var toItself = Heard((Probe, Ksc, 0.3), (Probe, Forward, 0.8));
            CentrePath.For(plan, Probe, Ksc, false, Stations, Name, 10.0, 1.0, toItself);
            Assert.Equal(0, toItself.RoutesWeighed);
        }

        [Fact]
        public void AStrongerPathThatArrivesLaterThanThePlanCanTellApartIsNotPreferred()
        {
            var plan = Plan(
                Pair(Probe, Ksc, 2.0, Always()),
                Pair(Probe, Forward, 4.0, Always()));

            var view = CentrePath.For(
                plan, Probe, Ksc, true, Stations, Name, 10.0, 1.0,
                Heard((Probe, Ksc, 0.3), (Probe, Forward, 0.8)));

            Assert.Equal("Kerbal Space Center", view.Path.Hops.Single().To);
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
