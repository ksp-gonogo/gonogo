using System.Linq;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Propagation.Tests.Contacts
{
    public class ContactRouterTests
    {
        private const double Step = 10.0;
        private const double Horizon = 3600.0;
        private const double OneLightSecond = PairPlan.SpeedOfLight;

        /// <summary>A pair at a fixed distance, in contact over the given windows.</summary>
        private static PairPlan Pair(string a, string b, double meters, params ContactWindow[] windows) =>
            new PairPlan(a, b, Horizon, windows, 0.0, Step, Enumerable.Repeat(meters, (int)(Horizon / Step) + 1).ToArray());

        private static ContactWindow Always() => new ContactWindow(null, null);

        private static ContactWindow From(double open, double? close = null) => new ContactWindow(open, close);

        private static ContactPlan Plan(params PairPlan[] pairs) => new ContactPlan(0.0, Horizon, Step, pairs, 0, 0);

        [Fact]
        public void ALiveLinkArrivesOneLightTimeLaterWithNothingWaiting()
        {
            var route = ContactRouter.EarliestArrival(Plan(Pair("ground:a", "vessel:b", OneLightSecond, Always())), "ground:a", "vessel:b", 10.0)!;

            var hop = Assert.Single(route.Hops);
            Assert.Equal(10.0, hop.DepartUt, 9);
            Assert.Equal(11.0, route.ArrivalUt, 9);
            Assert.True(route.Live);
        }

        [Fact]
        public void AMessageWaitsForTheNextWindowAndTheRouteSaysSo()
        {
            var route = ContactRouter.EarliestArrival(Plan(Pair("ground:a", "vessel:b", OneLightSecond, From(100.0))), "ground:a", "vessel:b", 10.0)!;

            Assert.Equal(100.0, route.Hops[0].DepartUt, 9);
            Assert.Equal(101.0, route.ArrivalUt, 9);
            Assert.False(route.Live);
        }

        [Fact]
        public void ARelayInContactNowBeatsWaitingForTheDirectWindow()
        {
            var plan = Plan(
                Pair("ground:a", "vessel:b", OneLightSecond, From(1000.0)),
                Pair("ground:a", "vessel:relay", OneLightSecond, Always()),
                Pair("vessel:relay", "vessel:b", OneLightSecond, Always()));

            var route = ContactRouter.EarliestArrival(plan, "ground:a", "vessel:b", 0.0)!;

            Assert.Equal(new[] { "vessel:relay", "vessel:b" }, route.Hops.Select(h => h.To).ToArray());
            Assert.Equal(2.0, route.ArrivalUt, 9);
            Assert.True(route.Live);
        }

        [Fact]
        public void AMessageAnyOfSeveralNodesCanTakeGoesToTheOneItReachesFirst()
        {
            var plan = Plan(
                Pair("vessel:b", "ground:near", OneLightSecond, From(1000.0)),
                Pair("vessel:b", "vessel:relay", OneLightSecond, Always()),
                Pair("vessel:relay", "ground:far", 3.0 * OneLightSecond, Always()),
                Pair("vessel:relay", "ground:farther", 5.0 * OneLightSecond, Always()));

            var route = ContactRouter.EarliestArrivalAtAny(plan, "vessel:b", new[] { "ground:near", "ground:far", "ground:farther", "ground:unplanned" }, 0.0)!;

            Assert.Equal("ground:far", route.Destination);
            Assert.Equal(new[] { "vessel:relay", "ground:far" }, route.Hops.Select(h => h.To).ToArray());
            Assert.Equal(4.0, route.ArrivalUt, 9);
            Assert.True(route.Live);
        }

        [Fact]
        public void AMessageNoneOfItsDestinationsIsPlannedForHasNoRoute()
        {
            var plan = Plan(Pair("vessel:b", "vessel:relay", OneLightSecond, Always()));

            Assert.Null(ContactRouter.EarliestArrivalAtAny(plan, "vessel:b", new[] { "ground:a", "ground:c" }, 0.0));
            Assert.Null(ContactRouter.EarliestArrivalAtAny(plan, "vessel:b", new string[0], 0.0));
        }

        [Fact]
        public void AHopIsNotAdmittedWhenItsWindowClosesBeforeTheLightLands()
        {
            var plan = Plan(Pair("ground:a", "vessel:b", OneLightSecond, From(0.0, 10.5), From(500.0)));

            var route = ContactRouter.EarliestArrival(plan, "ground:a", "vessel:b", 10.0)!;

            Assert.Equal(500.0, route.Hops[0].DepartUt, 9);
        }

        [Fact]
        public void ARouteThatWouldArriveAfterTheDeadlineIsNoRoute()
        {
            var plan = Plan(Pair("ground:a", "vessel:b", OneLightSecond, From(500.0)));

            Assert.Null(ContactRouter.EarliestArrival(plan, "ground:a", "vessel:b", 0.0, mustArriveByUt: 400.0));
            Assert.NotNull(ContactRouter.EarliestArrival(plan, "ground:a", "vessel:b", 0.0, mustArriveByUt: 600.0));
        }

        [Fact]
        public void NoWindowBeforeTheHorizonIsNoRoute()
        {
            var plan = Plan(Pair("ground:a", "vessel:b", OneLightSecond));

            Assert.Null(ContactRouter.EarliestArrival(plan, "ground:a", "vessel:b", 0.0));
            Assert.Null(ContactRouter.EarliestArrival(plan, "ground:a", "vessel:unknown", 0.0));
        }

        [Fact]
        public void EqualArrivalsGoToFewerHopsThenTheLaterTerminationThenNodeOrder()
        {
            // Direct at 2 light-seconds against two 1-second hops: equal arrival, fewer hops wins.
            var fewer = Plan(
                Pair("ground:a", "vessel:b", 2 * OneLightSecond, Always()),
                Pair("ground:a", "vessel:r", OneLightSecond, Always()),
                Pair("vessel:r", "vessel:b", OneLightSecond, Always()));
            Assert.Single(ContactRouter.EarliestArrival(fewer, "ground:a", "vessel:b", 0.0)!.Hops);

            // Two relays alike but one window closes sooner: the later termination wins.
            var termination = Plan(
                Pair("ground:a", "vessel:r1", OneLightSecond, From(0.0, 100.0)),
                Pair("vessel:r1", "vessel:b", OneLightSecond, Always()),
                Pair("ground:a", "vessel:r2", OneLightSecond, From(0.0, 200.0)),
                Pair("vessel:r2", "vessel:b", OneLightSecond, Always()));
            Assert.Equal("vessel:r2", ContactRouter.EarliestArrival(termination, "ground:a", "vessel:b", 0.0)!.Hops[0].To);

            // Everything equal: node order, so the answer never depends on enumeration order.
            var order = Plan(
                Pair("ground:a", "vessel:r2", OneLightSecond, Always()),
                Pair("vessel:r2", "vessel:b", OneLightSecond, Always()),
                Pair("ground:a", "vessel:r1", OneLightSecond, Always()),
                Pair("vessel:r1", "vessel:b", OneLightSecond, Always()));
            Assert.Equal("vessel:r1", ContactRouter.EarliestArrival(order, "ground:a", "vessel:b", 0.0)!.Hops[0].To);
        }

        [Fact]
        public void AWindowStillOpenAtTheHorizonTakesAHopThatLandsPastIt()
        {
            var plan = Plan(Pair("ground:a", "vessel:b", OneLightSecond, From(Horizon - 0.5)));

            var route = ContactRouter.EarliestArrival(plan, "ground:a", "vessel:b", 0.0)!;

            Assert.Equal(Horizon + 0.5, route.ArrivalUt, 6);
        }

        [Fact]
        public void ASeparationAskedForAtNotANumberIsNone()
        {
            Assert.Null(Pair("ground:a", "vessel:b", OneLightSecond, Always()).SeparationAt(double.NaN));
        }

        [Fact]
        public void TheLightTimeIsToWhereTheReceiverWillBeWhenItLands()
        {
            // Receding at a tenth of light speed from ten light-seconds: the light catches it at 10 / 0.9.
            var separation = Enumerable.Range(0, (int)(Horizon / Step) + 1)
                .Select(g => (10.0 * OneLightSecond) + (0.1 * OneLightSecond * g * Step))
                .ToArray();
            var pair = new PairPlan("ground:a", "vessel:b", Horizon, new[] { Always() }, 0.0, Step, separation);

            var light = ContactRouter.LightTime(pair, 0.0)!.Value;

            Assert.InRange(light, (10.0 / 0.9) - 0.01, (10.0 / 0.9) + 0.01);
        }
    }
}
