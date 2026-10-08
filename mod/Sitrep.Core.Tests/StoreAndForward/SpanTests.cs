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

            public double? LiveLink(string from, string to) => _links.TryGetValue((from, to), out var light) ? light : (double?)null;

            public double? LivePath(string from, string to) => LiveLink(from, to);
        }

        /// <summary>The lander reaches the relay at once and the relay reaches the centre from UT 100.</summary>
        private sealed class Plan : IDeliveryRoutes, ISenderPlans
        {
            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => this;

            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt)
            {
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

            public Rig(ISenderPlans? beliefs = null)
            {
                var plan = new Plan();
                Network = new DeliveryNetwork(
                    Clock, Links, plan, (c, ut) => null, r => { }, beliefs: beliefs ?? plan,
                    deliverSpan: (span, at) => Delivered.Add((span, at)));
            }

            public void Tick(double ut)
            {
                Clock.AdvanceTo(ut);
                Network.Tick(ut);
            }

            public SpanMessage Add(params double[] uts)
            {
                var span = new SpanMessage { Craft = Lander, Centre = Ksc, Topic = "vessel.flight" };
                foreach (var ut in uts)
                {
                    span.Samples.Add(new SpanSample(ut, new SpanPayload { Bytes = 100, ReleaseCost = 10, Carriers = 1, Held = ut }));
                }
                Network.AddSpan(Lander, span);
                return span;
            }
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
            var older = rig.Add(1.0, 2.0);
            var newer = rig.Add(3.0, 4.0);
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

                public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt) =>
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
    }
}
