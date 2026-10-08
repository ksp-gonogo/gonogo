using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Contacts
{
    /// <summary>
    /// A plan names the dish that carries each stretch of contact, finds where an
    /// idle dish could be turned to carry a message, and a route may use such a
    /// stretch for a message held at the node that would turn.
    /// </summary>
    public class RetargetPlanTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;
        private const double MunSma = 12_000_000.0;
        private const double SunMu = 1.1723328e18;
        private const double KerbinSma = 13_599_840_256.0;
        private const int Sun = 0, Kerbin = 1;
        private const string Relay = "vessel:r";
        private const string Ground = "ground:ksc";
        private const string RelayDish = "vessel:r#1/0";

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
            new SystemBody(Kerbin, new OrbitElements(MunSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu)),
        };

        private static IPropagationProvider Propagator() => new KeplerProvider(System());

        private static PlanNode[] Nodes() => new[]
        {
            PlanNode.Orbiting(Relay, PropagationTarget.Vessel(Relay, Kerbin, new OrbitElements(KerbinRadius + 300_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu))),
            PlanNode.OnSurface(Ground, Kerbin, RotatingGroundStation.FromLatitudeLongitude(0.0, 10.0, 0.0, KerbinSiderealDay, KerbinRadius, 0.0)),
        };

        private static OccludingBody[] KerbinOnly() => new[] { new OccludingBody(Kerbin, KerbinRadius) };

        /// <summary>A relay dish aimed away from the station: no contact, except while it is busy with another link.</summary>
        private sealed class AimedAway : IAttributedContactLinkModel
        {
            private readonly double _busyFrom;
            private readonly double _busyTo;

            public AimedAway(double busyFrom = double.NaN, double busyTo = double.NaN)
            {
                _busyFrom = busyFrom;
                _busyTo = busyTo;
            }

            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => Busy(ut) ? 1.0 : -1.0;

            public DishPair DishesAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) =>
                Busy(ut) ? new DishPair(RelayDish, null) : default;

            private bool Busy(double ut) => ut >= _busyFrom && ut < _busyTo;
        }

        private sealed class Turnable : IRetargetModel
        {
            public bool Allowed { get; set; } = true;

            public bool AutoRetargetAllowed(string nodeId) => Allowed;

            public IReadOnlyList<DishAim> DishesOf(string nodeId) =>
                nodeId == Relay ? new[] { new DishAim(RelayDish, "the Sun") } : new DishAim[0];

            public double MarginIfAimedAt(string dishId, string peerId, double ut, Vector3d dish, Vector3d peer, IContactPositions positions) => 1.0;

            public double PeerReceiveMargin(string peerId, string nodeId, double ut, Vector3d peer, Vector3d node, IContactPositions positions) => 1.0;
        }

        private static ContactPlan Plan(IContactLinkModel? link, IRetargetModel? retarget)
        {
            var pairs = new[] { new PlanPair(Relay, Ground, KerbinOnly(), null, link) };
            return ContactPlanner.Plan(Nodes(), pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05, null, retarget);
        }

        [Fact]
        public void AWindowNamesTheDishThatCarriesIt()
        {
            var sight = Plan(null, null).Pairs[0].Windows[0];
            var from = (sight.OpenUt ?? 0.0) + 100.0;
            var plan = Plan(new AimedAway(from, from + 200.0), null);

            var window = Assert.Single(plan.Pairs[0].Windows);
            Assert.Equal(RelayDish, window.FromDish);
            Assert.Null(window.ToDish);
            Assert.InRange(window.OpenUt!.Value, from - 10.0, from + 10.0);
        }

        [Fact]
        public void AnIdleDishCouldBeTurnedWhereverTheStationIsInSightAndTheLinkOnItsOwnAimIsDark()
        {
            var geometry = Plan(null, null);
            var plan = Plan(new AimedAway(), new Turnable());

            Assert.Empty(plan.Pairs[0].Windows);
            Assert.NotEmpty(geometry.Pairs[0].Windows);
            Assert.Equal(geometry.Pairs[0].Windows.Count, plan.Pairs[0].RetargetWindows.Count);
            for (var i = 0; i < geometry.Pairs[0].Windows.Count; i++)
            {
                var sight = geometry.Pairs[0].Windows[i];
                var turn = plan.Pairs[0].RetargetWindows[i];
                Assert.Equal(Relay, turn.NodeId);
                Assert.Equal(RelayDish, turn.DishId);
                Assert.Equal(Ground, turn.PeerId);
                Assert.InRange(turn.OpenUt, sight.OpenUt ?? 0.0, (sight.OpenUt ?? 0.0) + 0.2);
            }
        }

        [Fact]
        public void ADishBusyWithAnotherLinkIsNotOfferedForATurnWhileItIs()
        {
            var geometry = Plan(null, null).Pairs[0].Windows;
            var first = geometry[0];
            var busyFrom = first.OpenUt ?? 0.0;
            var busyTo = (first.CloseUt ?? busyFrom + 1000.0) + 1.0;
            var plan = Plan(new AimedAway(busyFrom, busyTo), new Turnable());

            Assert.DoesNotContain(plan.Pairs[0].RetargetWindows, w => w.OpenUt < busyTo - 1.0 && w.CloseUt > busyFrom + 1.0);
        }

        [Fact]
        public void ADishWhoseCraftHasOptedOutIsNeverOffered()
        {
            var plan = Plan(new AimedAway(), new Turnable { Allowed = false });

            Assert.Empty(plan.Pairs[0].RetargetWindows);
        }

        [Fact]
        public void AMessageHeldAtTheTurningNodeRoutesThroughAnIdleDishAndOneHeldElsewhereDoesNot()
        {
            var plan = Plan(new AimedAway(), new Turnable());
            var window = plan.Pairs[0].RetargetWindows[0];
            var routing = new RetargetRouting(linkUpSeconds: 5.0, awayMarginSeconds: 10.0);

            var without = ContactRouter.EarliestArrival(plan, Relay, Ground, window.OpenUt - 100.0);
            var with = ContactRouter.EarliestArrivalBetween(plan, new[] { Relay }, new[] { Ground }, window.OpenUt - 100.0, null, 1.0, routing);

            Assert.Null(without);
            var hop = Assert.Single(with!.Hops);
            Assert.Equal(RelayDish, hop.RetargetDish);
            Assert.Equal(window.OpenUt, hop.TurnUt, 3);
            Assert.Equal(window.OpenUt + 5.0, hop.DepartUt, 3);

            var other = ContactRouter.EarliestArrivalBetween(plan, new[] { Ground }, new[] { Relay }, window.OpenUt - 100.0, null, 1.0, routing);
            Assert.Null(other);
        }

        [Fact]
        public void AWindowTooShortToTurnSendAndTurnBackIsNotUsed()
        {
            var plan = Plan(new AimedAway(), new Turnable());
            var window = plan.Pairs[0].RetargetWindows[0];
            var longest = plan.Pairs[0].RetargetWindows.Max(w => w.CloseUt - w.OpenUt);
            var routing = new RetargetRouting(linkUpSeconds: 5.0, awayMarginSeconds: longest);

            Assert.Null(ContactRouter.EarliestArrivalBetween(plan, new[] { Relay }, new[] { Ground }, window.OpenUt - 100.0, null, 1.0, routing));
        }
    }
}
