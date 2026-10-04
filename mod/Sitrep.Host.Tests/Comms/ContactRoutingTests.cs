using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class ContactRoutingTests
    {
        private const double Step = 10.0;
        private const double Horizon = 3600.0;

        private static PairPlan Pair(string a, string b, params ContactWindow[] windows) =>
            new PairPlan(a, b, Horizon, windows, 0.0, Step, Enumerable.Repeat(PairPlan.SpeedOfLight, (int)(Horizon / Step) + 1).ToArray());

        private static readonly ContactPlan Plan = new ContactPlan(
            0.0,
            Horizon,
            Step,
            new[]
            {
                Pair("ground:ksc", "vessel:probe", new ContactWindow(null, null)),
                Pair("ground:forward", "vessel:probe", new ContactWindow(1000.0, null)),
            },
            0,
            0);

        [Fact]
        public void EveryCentreGetsARouteEachWayAndTheCraftItselfGetsNone()
        {
            var routes = ContactRouting.RoutesFor(Plan, "vessel:probe", new[] { "ground:ksc", "ground:forward", "vessel:probe" }, 10.0);

            Assert.Equal(4, routes.Routes.Count);
            var up = routes.Routes.Single(r => r.From == "ground:ksc" && r.To == "vessel:probe");
            Assert.True(up.Live);
            Assert.Equal(11.0, up.ArrivalUt!.Value, 9);
            Assert.Empty(up.Holds);
            var down = routes.Routes.Single(r => r.From == "vessel:probe" && r.To == "ground:forward");
            Assert.False(down.Live);
            Assert.Equal(1001.0, down.ArrivalUt!.Value, 9);
            var hold = Assert.Single(down.Holds);
            Assert.Equal("vessel:probe", hold.At);
            Assert.Equal(10.0, hold.ArriveUt, 9);
            Assert.Equal(1000.0, hold.DepartUt, 9);
        }

        [Fact]
        public void TheRowsQuoteTheLightTimesTheGameModels()
        {
            var routes = ContactRouting.RoutesFor(Plan, "vessel:probe", new[] { "ground:ksc" }, 10.0, 60.0);

            Assert.All(routes.Routes, r => Assert.Equal(70.0, r.ArrivalUt!.Value, 9));
        }

        [Fact]
        public void TheSendersRouteIsTheOneThatArrivesFirstUnderTheGamesLightTimes()
        {
            var plan = new ContactPlan(
                0.0,
                Horizon,
                Step,
                new[]
                {
                    Scaled("ground:ksc", "vessel:probe", 0.01, new ContactWindow(100.0, null)),
                    Scaled("ground:ksc", "vessel:relay", 0.1, new ContactWindow(null, null)),
                    Scaled("vessel:relay", "vessel:probe", 0.1, new ContactWindow(null, null)),
                },
                0,
                0);

            var route = new PlanRoutes(plan, 1000.0).Route("ground:ksc", "vessel:probe", 0.0, double.PositiveInfinity)!;

            var hop = Assert.Single(route);
            Assert.Equal("vessel:probe", hop.To);
            Assert.Equal(100.0, hop.DepartUt, 9);
            Assert.Equal(110.0, hop.ArriveUt, 9);
        }

        private static PairPlan Scaled(string a, string b, double lightSeconds, params ContactWindow[] windows) =>
            new PairPlan(
                a, b, Horizon, windows, 0.0, Step,
                Enumerable.Repeat(lightSeconds * PairPlan.SpeedOfLight, (int)(Horizon / Step) + 1).ToArray());

        [Fact]
        public void ACentreWithNoPredictedRouteHasNoArrivalAndIsNotLive()
        {
            var routes = ContactRouting.RoutesFor(Plan, "vessel:probe", new[] { "ground:island" }, 10.0);

            Assert.All(routes.Routes, r =>
            {
                Assert.Null(r.ArrivalUt);
                Assert.False(r.Live);
            });
        }
    }
}
