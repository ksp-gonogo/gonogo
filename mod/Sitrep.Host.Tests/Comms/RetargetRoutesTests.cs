using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A centre predicts a relay on a command's way turning an idle dish to send
    /// it on, in the routes it sends by and in its <c>comms.route</c> rows, and
    /// predicts no such turn for a reply, which only its own craft turns a dish
    /// for.
    /// </summary>
    public class RetargetRoutesTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const int Kerbin = 1;
        private const string Ground = "ground:ksc";
        private const string Relay = "vessel:r";
        private const string Craft = "vessel:c";
        private const string RelayDish = "vessel:r#1/0";
        private const double LinkUp = 5.0;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)),
            new SystemBody(Kerbin, new OrbitElements(12_000_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu)),
        };

        private sealed class Dark : IContactLinkModel
        {
            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => -1.0;
        }

        /// <summary>The relay's dish, aimed away from the craft, which has only an omni.</summary>
        private sealed class AimedAway : IAttributedContactLinkModel
        {
            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => -1.0;

            public DishPair DishesAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => default;
        }

        private sealed class Turnable : IRetargetModel
        {
            public bool AutoRetargetAllowed(string nodeId) => true;

            public IReadOnlyList<DishAim> DishesOf(string nodeId) =>
                nodeId == Relay ? new[] { new DishAim(RelayDish, "the Sun") } : new DishAim[0];

            public double MarginIfAimedAt(string dishId, string peerId, double ut, Vector3d dish, Vector3d peer, IContactPositions positions) => 1.0;

            public double PeerReceiveMargin(string peerId, string nodeId, double ut, Vector3d peer, Vector3d node, IContactPositions positions) => 1.0;
        }

        /// <summary>The station reaches the relay whenever it is in sight; the relay reaches the craft just behind it only by turning its dish; the station never reaches the craft.</summary>
        private static ContactPlan Plan()
        {
            var occluders = new[] { new OccludingBody(Kerbin, KerbinRadius) };
            var nodes = new[]
            {
                PlanNode.Orbiting(Relay, PropagationTarget.Vessel(Relay, Kerbin, new OrbitElements(KerbinRadius + 300_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu))),
                PlanNode.Orbiting(Craft, PropagationTarget.Vessel(Craft, Kerbin, new OrbitElements(KerbinRadius + 300_000.0, 0.0, 0.0, 0.0, 0.0, -0.05, 0.0, KerbinMu))),
                PlanNode.OnSurface(Ground, Kerbin, RotatingGroundStation.FromLatitudeLongitude(0.0, 10.0, 0.0, 21_549.425, KerbinRadius, 0.0)),
            };
            var pairs = new[]
            {
                new PlanPair(Ground, Relay, occluders, null),
                new PlanPair(Relay, Craft, occluders, null, new AimedAway()),
                new PlanPair(Ground, Craft, occluders, null, new Dark()),
            };
            return ContactPlanner.Plan(nodes, pairs, new KeplerProvider(System()), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05, null, new Turnable());
        }

        /// <summary>A moment well inside the station's first sight of the relay.</summary>
        private static double InSight(ContactPlan plan)
        {
            var window = plan.Pairs.Single(p => p.A == Ground && p.B == Relay).Windows[0];
            return (window.OpenUt ?? 0.0) + 60.0;
        }

        [Fact]
        public void ACommandsRouteHasTheRelayTurnItsDishOnTheWayAndOtherMessagesDoNot()
        {
            var plan = Plan();
            var sent = InSight(plan);
            var routes = new PlanRoutes(plan, retarget: new RetargetRouting(LinkUp, 10.0));

            var command = routes.Route(Ground, Craft, sent, double.PositiveInfinity, turnsOnTheWay: true);
            var other = routes.Route(Ground, Craft, sent, double.PositiveInfinity);

            Assert.Null(other);
            Assert.NotNull(command);
            Assert.Equal(new[] { Relay, Craft }, command!.Select(h => h.To));
            Assert.Null(command[0].RetargetDish);
            Assert.Equal(RelayDish, command[1].RetargetDish);
            Assert.Equal(command[0].ArriveUt, command[1].TurnUt, 6);
            Assert.Equal(command[1].TurnUt + LinkUp, command[1].DepartUt, 6);
        }

        [Fact]
        public void TheRouteToTheCraftShowsTheWaitForTheTurnAtTheRelay()
        {
            var plan = Plan();
            var sent = InSight(plan);

            var rows = ContactRouting.RoutesFor(plan, Craft, new[] { Ground }, sent, retarget: new RetargetRouting(LinkUp, 10.0));
            var without = ContactRouting.RoutesFor(plan, Craft, new[] { Ground }, sent);

            var toCraft = rows.Routes.Single(r => r.From == Ground && r.To == Craft);
            var hold = Assert.Single(toCraft.Holds);
            Assert.Equal(Relay, hold.At);
            Assert.Equal(hold.ArriveUt + LinkUp, hold.DepartUt, 6);
            Assert.NotNull(toCraft.ArrivalUt);
            Assert.False(toCraft.Live);
            Assert.Null(without.Routes.Single(r => r.From == Ground && r.To == Craft).ArrivalUt);
        }

        [Fact]
        public void ARelayThatOptedOutBeforeTheSendIsNotCountedAsTurningItsDish()
        {
            var plan = Plan();
            var sent = InSight(plan);
            var routing = new RetargetRouting(LinkUp, 10.0, mayTurn: node => node != Relay);

            var route = new PlanRoutes(plan, retarget: routing).Route(Ground, Craft, sent, double.PositiveInfinity, turnsOnTheWay: true);
            var rows = ContactRouting.RoutesFor(plan, Craft, new[] { Ground }, sent, retarget: routing);

            Assert.Null(route);
            Assert.Null(rows.Routes.Single(r => r.From == Ground && r.To == Craft).ArrivalUt);
        }

        [Fact]
        public void AMessageAlreadyPlannedThroughARelayReroutesWhenThatRelayOptsOut()
        {
            var plan = Plan();
            var sent = InSight(plan);
            var optedOut = false;
            var routes = new PlanRoutes(plan, retarget: new RetargetRouting(LinkUp, 10.0, mayTurn: node => !(optedOut && node == Relay)));

            var before = routes.Route(Ground, Craft, sent, double.PositiveInfinity, turnsOnTheWay: true);
            optedOut = true;
            var after = routes.Route(Ground, Craft, sent, double.PositiveInfinity, turnsOnTheWay: true);

            Assert.NotNull(before);
            Assert.Null(after);
        }
    }
}
