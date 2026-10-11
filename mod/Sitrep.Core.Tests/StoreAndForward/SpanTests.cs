using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// A craft's history travels hop by hop like any other message and waits at a
    /// relay between contacts, never dropped on the way, and a node that is
    /// holding it never starts a dish turn for it.
    /// </summary>
    public class SpanTests
    {
        private const string Ksc = "ground:ksc";
        private const string Lander = "vessel:lander";
        private const string Relay = "vessel:relay";

        private sealed class Links : IDeliveryLinks
        {
            private readonly Dictionary<(string, string), double> _links = new Dictionary<(string, string), double>();

            public void Up(string a, string b, double light)
            {
                _links[(a, b)] = light;
                _links[(b, a)] = light;
            }

            public void Down(string a, string b)
            {
                _links.Remove((a, b));
                _links.Remove((b, a));
            }

            public int Asked { get; private set; }

            public double? LiveLink(string from, string to)
            {
                Asked++;
                return _links.TryGetValue((from, to), out var light) ? light : (double?)null;
            }

            public double? LivePath(string from, string to) => LiveLink(from, to);
        }

        /// <summary>The lander reaches the relay at once and the relay reaches the centre from UT 100.</summary>
        private sealed class Plan : IDeliveryRoutes, ISenderPlans
        {
            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => this;

            public int Asked { get; private set; }

            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false)
            {
                Asked++;
                if (from == Lander)
                {
                    return new[] { new PlannedHop(Relay, readyUt, readyUt + 5), new PlannedHop(Ksc, Math.Max(readyUt + 5, 100), Math.Max(readyUt + 5, 100) + 10) };
                }
                return from == Relay ? new[] { new PlannedHop(Ksc, Math.Max(readyUt, 100), Math.Max(readyUt, 100) + 10) } : null;
            }
        }

        private sealed class Rig
        {
            public readonly Links Links = new Links();
            public readonly ManualClock Clock = new ManualClock();
            public readonly List<(SpanMessage Span, double AtUt)> Delivered = new List<(SpanMessage, double)>();
            public readonly DeliveryNetwork Network;
            public readonly Plan Plan = new Plan();

            public Rig(ISenderPlans? beliefs = null)
            {
                var plan = Plan;
                Network = new DeliveryNetwork(
                    Clock, Links, plan, (c, ut) => null, r => { }, beliefs: beliefs ?? plan,
                    deliverSpan: (span, at) => Delivered.Add((span, at)));
            }

            public void Tick(double ut)
            {
                Clock.AdvanceTo(ut);
                Network.Tick(ut);
            }

            public SpanMessage Add(params double[] uts) => AddTo("vessel.flight", uts);

            public SpanMessage AddTo(string topic, params double[] uts)
            {
                var span = new SpanMessage { Craft = Lander, Centre = Ksc, Topic = topic };
                foreach (var ut in uts)
                {
                    span.Samples.Add(new SpanSample(ut, new SpanPayload { Bytes = 100, ReleaseCost = 10, Carriers = 1, Held = ut }));
                }
                Network.AddSpan(Lander, span);
                return span;
            }
        }

        [Fact]
        public void HoldingManySpansAsksTheLinksAboutEachPairOnceAndNotOncePerSpan()
        {
            var rig = new Rig();
            rig.Tick(1.0);

            var before = rig.Links.Asked;
            for (var i = 0; i < 200; i++)
            {
                rig.AddTo("topic." + i, 1.0 + i);
            }
            var addingAsked = rig.Links.Asked - before;

            before = rig.Links.Asked;
            var routesBefore = rig.Plan.Asked;
            rig.Tick(2.0);
            var tickAsked = rig.Links.Asked - before;
            var tickRoutes = rig.Plan.Asked - routesBefore;

            Assert.Equal(200, rig.Network.Spans().Count);
            Assert.True(addingAsked <= 200 * 4, "links asked while adding: " + addingAsked);
            Assert.True(tickAsked <= 8, "links asked by one tick over 200 held spans: " + tickAsked);
            Assert.True(tickRoutes <= 2, "routes planned by one tick over 200 held spans: " + tickRoutes);
        }

        /// <summary>The lander's only contact opens at UT 500, straight to the centre.</summary>
        private sealed class WindowPlan : IDeliveryRoutes, ISenderPlans
        {
            public const double OpensUt = 500.0;

            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => this;

            public int Asked { get; private set; }

            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false)
            {
                Asked++;
                var leaves = Math.Max(readyUt, OpensUt);
                return from == Lander ? new[] { new PlannedHop(Ksc, leaves, leaves + 10) } : null;
            }
        }

        [Fact]
        public void AWindowOpeningIsLookedAtOnceHoweverManySpansWereWaitingForIt()
        {
            var plan = new WindowPlan();
            var links = new Links();
            var clock = new ManualClock();
            var network = new DeliveryNetwork(clock, links, plan, (c, ut) => null, r => { }, beliefs: plan, deliverSpan: (span, at) => { });
            clock.AdvanceTo(1.0);
            network.Tick(1.0);
            for (var i = 0; i < 200; i++)
            {
                var span = new SpanMessage { Craft = Lander, Centre = Ksc, Topic = "topic." + i };
                span.Samples.Add(new SpanSample(1.0, new SpanPayload { Bytes = 100, ReleaseCost = 10, Carriers = 1, Held = 1.0 }));
                network.AddSpan(Lander, span);
            }
            network.Tick(2.0);

            // The window opens inside this advance, with the craft's link still down.
            var before = plan.Asked;
            clock.AdvanceTo(WindowPlan.OpensUt + 100.0);
            var asked = plan.Asked - before;

            Assert.Equal(200, network.Spans().Count);
            Assert.True(asked <= 2, "routes planned as one window opened for 200 waiting spans: " + asked);

            // And they still all leave once the link is up.
            links.Up(Lander, Ksc, 10.0);
            network.Tick(WindowPlan.OpensUt + 100.0);
            Assert.All(network.Spans(), held => Assert.True(held.InFlight));
        }

        [Fact]
        public void ASpanWaitingForAWindowLeavesAtTheInstantItOpensInsideOneAdvance()
        {
            var plan = new WindowPlan();
            var links = new Links();
            var clock = new ManualClock();
            var delivered = new List<double>();
            var network = new DeliveryNetwork(clock, links, plan, (c, ut) => null, r => { }, beliefs: plan, deliverSpan: (span, at) => delivered.Add(at));
            clock.AdvanceTo(1.0);
            network.Tick(1.0);
            foreach (var topic in new[] { "vessel.flight", "vessel.orbit" })
            {
                var span = new SpanMessage { Craft = Lander, Centre = Ksc, Topic = topic };
                span.Samples.Add(new SpanSample(1.0, new SpanPayload { Bytes = 100, ReleaseCost = 10, Carriers = 1, Held = 1.0 }));
                network.AddSpan(Lander, span);
            }
            network.Tick(2.0);

            links.Up(Lander, Ksc, 10.0);
            clock.AdvanceTo(WindowPlan.OpensUt + 100.0);

            Assert.Equal(new[] { WindowPlan.OpensUt + 10.0, WindowPlan.OpensUt + 10.0 }, delivered);
        }

        [Fact]
        public void ACraftWithNoWayOnHoldsOneSpanOfATopicHoweverManyTimesItHandsSamplesOver()
        {
            var rig = new Rig();
            rig.Tick(1.0);

            var first = rig.Add(1.0);
            for (var i = 1; i < 500; i++)
            {
                rig.Tick(1.0 + i);
                rig.Add(1.0 + i);
            }

            var held = Assert.Single(rig.Network.Spans());
            Assert.Same(first, held.Span);
            Assert.Equal(Enumerable.Range(1, 500).Select(v => (double)v), held.Span.Samples.Select(s => s.Ut));
            Assert.Equal(500 * 100, rig.Network.HeldSpanBytes());

            // The whole of it leaves as one when the craft's link opens.
            rig.Links.Up(Lander, Relay, 5.0);
            rig.Tick(501.0);
            rig.Tick(507.0);
            Assert.Equal(Relay, Assert.Single(rig.Network.Spans()).Node);
        }

        [Fact]
        public void ARelayWithNoWayOnHoldsOneSpanOfATopicHoweverManyReachIt()
        {
            var rig = new Rig();
            rig.Links.Up(Lander, Relay, 5.0);
            rig.Tick(1.0);

            // The craft sends one span every 10 s, each landing 5 s later, while the relay cannot reach the centre.
            for (var i = 0; i < 8; i++)
            {
                rig.Add(1.0 + (i * 10));
                rig.Tick(8.0 + (i * 10));
                rig.Tick(11.0 + (i * 10));
            }

            var held = Assert.Single(rig.Network.Spans());
            Assert.Equal(Relay, held.Node);
            Assert.Equal(Enumerable.Range(0, 8).Select(i => 1.0 + (i * 10)), held.Span.Samples.Select(s => s.Ut));
            Assert.Equal(8 * 100, rig.Network.HeldSpanBytes());

            // All of it reaches the centre once, as one, when the relay's link opens.
            rig.Links.Up(Relay, Ksc, 10.0);
            rig.Tick(100.0);
            rig.Tick(111.0);
            var (arrived, _) = Assert.Single(rig.Delivered);
            Assert.Equal(8, arrived.Samples.Count);
            Assert.Empty(rig.Network.Spans());
        }

        [Fact]
        public void SamplesHandedOverAfterASpanHasLeftTravelAsTheirOwn()
        {
            var rig = new Rig();
            rig.Links.Up(Lander, Relay, 5.0);
            rig.Tick(1.0);
            var sent = rig.Add(1.0);

            rig.Tick(2.0);
            var later = rig.Add(2.0);

            Assert.Equal(new[] { 1.0 }, sent.Samples.Select(s => s.Ut));
            Assert.Equal(new[] { 2.0 }, later.Samples.Select(s => s.Ut));
        }

        [Fact]
        public void ASpanThatStartsAfterAHoleDoesNotJoinTheOneWaitingBeforeIt()
        {
            var rig = new Rig();
            rig.Tick(1.0);
            var before = rig.Add(1.0);
            var after = new SpanMessage { Craft = Lander, Centre = Ksc, Topic = "vessel.flight", StartsAfterAHole = true };
            after.Samples.Add(new SpanSample(9.0, new SpanPayload { Bytes = 100, ReleaseCost = 10, Carriers = 1, Held = 9.0 }));
            rig.Network.AddSpan(Lander, after);

            // What comes next continues the newer span, on the far side of the hole.
            rig.Add(10.0);

            Assert.Equal(2, rig.Network.Spans().Count);
            Assert.Equal(new[] { 1.0 }, before.Samples.Select(s => s.Ut));
            Assert.Equal(new[] { 9.0, 10.0 }, after.Samples.Select(s => s.Ut));
        }

        [Fact]
        public void ASpanWaitsAtTheRelayUntilItsLinkToTheCentreOpensThenArrivesWhole()
        {
            var rig = new Rig();
            rig.Links.Up(Lander, Relay, 5.0);
            rig.Tick(1.0);
            var span = rig.Add(1.0, 2.0, 3.0);

            rig.Tick(8.0);
            var held = Assert.Single(rig.Network.Spans());
            Assert.Equal(Relay, held.Node);
            Assert.Empty(rig.Delivered);

            rig.Links.Up(Relay, Ksc, 10.0);
            rig.Tick(100.0);
            rig.Tick(111.0);

            var (arrived, at) = Assert.Single(rig.Delivered);
            Assert.Same(span, arrived);
            Assert.Equal(new[] { 1.0, 2.0, 3.0 }, arrived.Samples.Select(s => s.Ut));
            Assert.Equal(110.0, at);
            Assert.Empty(rig.Network.Spans());
        }

        [Fact]
        public void ASpanWithNoLinkWaitsAtTheCraftAndLeavesTheMomentOneOpens()
        {
            var rig = new Rig();
            rig.Tick(1.0);
            rig.Add(1.0);
            rig.Tick(50.0);

            Assert.Equal(Lander, Assert.Single(rig.Network.Spans()).Node);

            rig.Links.Up(Lander, Relay, 5.0);
            rig.Tick(51.0);
            rig.Tick(57.0);
            Assert.Equal(Relay, Assert.Single(rig.Network.Spans()).Node);
        }

        [Fact]
        public void AHopCaughtByABreakLeavesTheSpanWithItsSenderToTryAgain()
        {
            var rig = new Rig();
            rig.Links.Up(Lander, Relay, 5.0);
            rig.Tick(1.0);
            rig.Add(1.0);
            rig.Links.Down(Lander, Relay);
            rig.Tick(6.0);
            Assert.Empty(rig.Network.Spans().Where(s => s.Node == Relay));

            rig.Tick(12.0);
            Assert.Equal(Lander, Assert.Single(rig.Network.Spans()).Node);

            rig.Links.Up(Lander, Relay, 5.0);
            rig.Network.PlanChanged();
            rig.Tick(13.0);
            rig.Tick(19.0);
            Assert.Equal(Relay, Assert.Single(rig.Network.Spans()).Node);
        }

        [Fact]
        public void ASpanIsNotSavedWithTheGame()
        {
            var rig = new Rig();
            rig.Tick(1.0);
            rig.Add(1.0);

            var snapshot = rig.Network.Snapshot();

            Assert.DoesNotContain(snapshot.Held, h => h.Message is SpanMessage);
            Assert.DoesNotContain(snapshot.Flights, f => f.Message is SpanMessage);
        }

        [Fact]
        public void TheBudgetDropsTheOldestHeldSamplesFirstAndMarksTheSpanThatLostThem()
        {
            var rig = new Rig();
            rig.Tick(1.0);
            var older = rig.AddTo("vessel.flight", 1.0, 2.0);
            var newer = rig.AddTo("vessel.orbit", 3.0, 4.0);
            Assert.Equal(400, rig.Network.HeldSpanBytes());

            var shed = rig.Network.ShedSpans(150);

            Assert.Equal(new[] { 1.0, 2.0 }, shed.Select(s => s.Ut));
            Assert.Empty(older.Samples);
            Assert.True(older.StartsAfterAHole);
            Assert.Equal(2, newer.Samples.Count);
            Assert.False(newer.StartsAfterAHole);
            Assert.Equal(200, rig.Network.HeldSpanBytes());
        }

        [Fact]
        public void APayloadTwoSpansCarryIsCountedAndFreedOnce()
        {
            var rig = new Rig();
            rig.Tick(1.0);
            var payload = new SpanPayload { Bytes = 100, Carriers = 2 };
            foreach (var centre in new[] { Ksc, "ground:far" })
            {
                var span = new SpanMessage { Craft = Lander, Centre = centre, Topic = "t" };
                span.Samples.Add(new SpanSample(1.0, payload));
                rig.Network.AddSpan(Lander, span);
            }

            Assert.Equal(100, rig.Network.HeldSpanBytes());
            // Dropping it from the first span frees nothing while the second still
            // carries it, so the budget keeps going until the last carrier lets go.
            var shed = rig.Network.ShedSpans(1);
            Assert.Equal(2, shed.Count);
            Assert.Equal(0, payload.Carriers);
            Assert.Equal(0, rig.Network.HeldSpanBytes());
        }

        /// <summary>A plan the test rewrites: what a centre believes, copied whole into every message that carries it.</summary>
        private sealed class Moving : ISenderPlans
        {
            public Dictionary<string, PlannedHop[]> Routes { get; } = new Dictionary<string, PlannedHop[]>();

            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => new Snapshot(new Dictionary<string, PlannedHop[]>(Routes));

            private sealed class Snapshot : IDeliveryRoutes
            {
                private readonly Dictionary<string, PlannedHop[]> _routes;

                public Snapshot(Dictionary<string, PlannedHop[]> routes) => _routes = routes;

                public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) =>
                    _routes.TryGetValue(from, out var hops) ? hops : null;
            }
        }

        private const string Other = "vessel:other";

        /// <summary>A relay holds a span for a window to the centre that is far off; its link to a second relay is up, and no plan it carries mentions that one.</summary>
        private static (Rig Rig, Moving Plan) RelayHolding()
        {
            var plan = new Moving();
            plan.Routes[Lander] = new[] { new PlannedHop(Relay, 0, 5), new PlannedHop(Ksc, 500, 510) };
            plan.Routes[Relay] = new[] { new PlannedHop(Ksc, 500, 510) };
            var rig = new Rig(plan);
            rig.Links.Up(Lander, Relay, 5.0);
            rig.Links.Up(Relay, Other, 5.0);
            rig.Links.Up(Other, Ksc, 10.0);
            rig.Tick(1.0);
            rig.Add(1.0, 2.0);
            rig.Tick(8.0);
            Assert.Equal(Relay, Assert.Single(rig.Network.Spans()).Node);
            return (rig, plan);
        }

        [Fact]
        public void ARelayHeldSpanTakesAWayThatHasOpenedSinceItWasSent()
        {
            var (rig, plan) = RelayHolding();
            rig.Tick(20.0);
            Assert.Empty(rig.Delivered);

            plan.Routes[Relay] = new[] { new PlannedHop(Other, 20, 25), new PlannedHop(Ksc, 25, 35) };
            rig.Network.PlanChanged();
            rig.Tick(21.0);
            rig.Tick(50.0);

            var (span, at) = Assert.Single(rig.Delivered);
            Assert.Equal(new[] { 1.0, 2.0 }, span.Samples.Select(sample => sample.Ut));
            Assert.Equal(36.0, at);
        }

        [Fact]
        public void ASpanKeepsItsRouteWhenANewPlanIsBarelyBetter()
        {
            var (rig, plan) = RelayHolding();

            // Thirty seconds sooner is not worth leaving the way it was told.
            plan.Routes[Relay] = new[] { new PlannedHop(Other, 20, 25), new PlannedHop(Ksc, 25, 480) };
            rig.Network.PlanChanged();
            rig.Tick(21.0);
            rig.Tick(50.0);

            Assert.Empty(rig.Delivered);
            Assert.Equal(Relay, Assert.Single(rig.Network.Spans()).Node);
        }

        [Fact]
        public void ARelayHeldSpanTakesADirectContactThatOpensAfterItWasToldToGoByAnotherRelay()
        {
            var plan = new Moving();
            plan.Routes[Lander] = new[] { new PlannedHop(Relay, 0, 5), new PlannedHop(Other, 400, 405), new PlannedHop(Ksc, 405, 415) };
            plan.Routes[Relay] = new[] { new PlannedHop(Other, 400, 405), new PlannedHop(Ksc, 405, 415) };
            var rig = new Rig(plan);
            rig.Links.Up(Lander, Relay, 5.0);
            rig.Tick(1.0);
            rig.Add(1.0);
            rig.Tick(8.0);
            Assert.Equal(Relay, Assert.Single(rig.Network.Spans()).Node);

            // The relay's own dish comes to see the centre long before the relay it was told to wait for.
            rig.Links.Up(Relay, Ksc, 10.0);
            plan.Routes[Relay] = new[] { new PlannedHop(Ksc, 20, 30) };
            rig.Network.PlanChanged();
            rig.Tick(21.0);
            rig.Tick(40.0);

            var (_, at) = Assert.Single(rig.Delivered);
            Assert.Equal(31.0, at);
        }
    }
}
