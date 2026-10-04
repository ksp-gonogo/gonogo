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
    public class ReckonedPlanTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const int Kerbin = 1;

        private static readonly SystemBody[] Bodies =
        {
            new SystemBody(-1, null),
            new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)),
        };

        private static readonly PlanNode Ksc = PlanNode.OnSurface(
            "ground:ksc", Kerbin, RotatingGroundStation.FromLatitudeLongitude(0.0, 0.0, 0.0, 21_549.425, KerbinRadius, 0.0));

        private static PlanGround Ground(params PlanNode[] stations) =>
            new PlanGround(stations, Bodies, Kerbin, index => index == Kerbin ? KerbinRadius : 0.0);

        private static OrbitElements Orbit(double sma) => new OrbitElements(sma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static Dictionary<string, CraftLink> Links(params (string To, double? Range)[] links) =>
            links.ToDictionary(l => l.To, l => new CraftLink(l.Range, null));

        private static CraftState Craft(string guid, double capturedUt, double sma, Dictionary<string, CraftLink> links, bool plannable = true) =>
            CraftState.Orbiting("vessel:" + guid, capturedUt, Kerbin, Orbit(sma), null, null, plannable, links);

        [Fact]
        public void ACentreThatHasHeardNothingPlansOnlyItsStations()
        {
            var request = ReckonedPlan.Request(new CraftState[0], Ground(Ksc), 100.0, 3600.0);

            Assert.Equal("ground:ksc", Assert.Single(request.Nodes).Id);
            Assert.Empty(request.Pairs);
            Assert.Equal(100.0, request.FromUt);
        }

        [Fact]
        public void EachHeardCraftIsReckonedOnTheOrbitItReportedAndRememberedByWhereItIsGoing()
        {
            var a = Craft("a", 0.0, 1_300_000.0, Links(("ground:ksc", null)));

            var request = ReckonedPlan.Request(new[] { a }, Ground(Ksc), 100.0, 3600.0);

            var node = request.Nodes.Single(n => n.Id == "vessel:a");
            Assert.Equal(1_300_000.0, node.Orbit!.Value.Osculating!.Value.Sma);
            Assert.Same(a.Motion, node.Remembered);
            var pair = Assert.Single(request.Pairs);
            Assert.Equal("vessel:a", pair.A);
            Assert.Equal("ground:ksc", pair.B);
            Assert.Equal(Kerbin, Assert.Single(pair.Occluders).BodyIndex);
        }

        [Fact]
        public void ACraftHeardToBeGoneOrThatCannotBeReckonedIsLeftOut()
        {
            var gone = CraftState.Gone("vessel:a", 5.0);
            var unreckonable = Craft("b", 0.0, 1_400_000.0, Links(("ground:ksc", null)), plannable: false);

            var request = ReckonedPlan.Request(new[] { gone, unreckonable }, Ground(Ksc), 100.0, 3600.0);

            Assert.Equal("ground:ksc", Assert.Single(request.Nodes).Id);
            Assert.Empty(request.Pairs);
        }

        /// <summary>
        /// The pair's link holds nothing newer than the centre has heard from
        /// both ends, so it is the one read with the older of the two states.
        /// </summary>
        [Fact]
        public void APairOfCraftTakesItsLinkFromTheOlderOfTheirTwoStates()
        {
            var a = Craft("a", 50.0, 1_300_000.0, Links(("vessel:b", 111.0)));
            var b = Craft("b", 20.0, 1_400_000.0, Links(("vessel:a", 222.0)));

            var request = ReckonedPlan.Request(new[] { a, b }, Ground(), 100.0, 3600.0);

            var pair = Assert.Single(request.Pairs);
            Assert.Equal("vessel:a", pair.A);
            Assert.Equal("vessel:b", pair.B);
            Assert.Equal(222.0, pair.MaxRangeMeters);
        }

        /// <summary>A link model is made for its own craft as the first end.</summary>
        [Fact]
        public void APairWithALinkModelKeepsTheCraftItWasReadFromFirst()
        {
            var model = new FixedMargin();
            var a = Craft("a", 50.0, 1_300_000.0, Links(("vessel:b", 111.0)));
            var b = CraftState.Orbiting(
                "vessel:b", 20.0, Kerbin, Orbit(1_400_000.0), null, null, true,
                new Dictionary<string, CraftLink> { ["vessel:a"] = new CraftLink(222.0, model) });

            var pair = Assert.Single(ReckonedPlan.Request(new[] { a, b }, Ground(), 100.0, 3600.0).Pairs);

            Assert.Equal("vessel:b", pair.A);
            Assert.Equal("vessel:a", pair.B);
            Assert.Same(model, pair.Link);
        }

        [Fact]
        public void WhichOfTwoCraftWasReadLastDoesNotShowInAPlanWithoutLinkModels()
        {
            var a = Craft("a", 0.0, 1_300_000.0, Links(("vessel:b", 1.0)));
            var b = Craft("b", 0.0, 1_400_000.0, Links(("vessel:a", 1.0)));
            var aAgain = a.ReadAgain(600.0, null, true, a.Links);

            var before = ReckonedPlan.Request(new[] { a, b }, Ground(), 100.0, 3600.0);
            var after = ReckonedPlan.Request(new[] { aAgain, b }, Ground(), 100.0, 3600.0);

            Assert.True(after.Matches(before));
        }

        [Fact]
        public void ACraftGoingSomewhereNewIsADifferentRequest()
        {
            var a = Craft("a", 0.0, 1_300_000.0, Links(("ground:ksc", null)));
            var burned = Craft("a", 60.0, 1_900_000.0, Links(("ground:ksc", null)));

            var before = ReckonedPlan.Request(new[] { a }, Ground(Ksc), 100.0, 3600.0);

            Assert.False(ReckonedPlan.Request(new[] { burned }, Ground(Ksc), 100.0, 3600.0).Matches(before));
            Assert.False(ReckonedPlan.Request(new CraftState[0], Ground(Ksc), 100.0, 3600.0).Matches(before));
        }

        [Fact]
        public void APairWithAnUnsettledEndIsMarkedLowConfidenceOnTheWire()
        {
            var steady = Craft("a", 0.0, 1_300_000.0, Links(("ground:ksc", null), ("vessel:b", null)));
            var burning = Craft("b", 0.0, 1_400_000.0, Links(("ground:ksc", null), ("vessel:a", null))).Unsettled();

            var request = ReckonedPlan.Request(new[] { steady, burning }, Ground(Ksc), 0.0, 3600.0);
            var wire = ContactPlanWire.ToPayload(request.Run(), request.Unsettled);

            Assert.Equal(new[] { "vessel:b" }, request.Unsettled);
            Assert.False(wire.Pairs.Single(p => p.A == "vessel:a" && p.B == "ground:ksc").LowConfidence);
            Assert.True(wire.Pairs.Single(p => p.A == "vessel:b" && p.B == "ground:ksc").LowConfidence);
            Assert.True(wire.Pairs.Single(p => p.A == "vessel:a" && p.B == "vessel:b").LowConfidence);
        }

        [Fact]
        public void ACraftSettlingIsADifferentRequest()
        {
            var burning = Craft("a", 0.0, 1_300_000.0, Links(("ground:ksc", null))).Unsettled();
            var settled = burning.ReadAgain(20.0, null, true, burning.Links);

            var before = ReckonedPlan.Request(new[] { burning }, Ground(Ksc), 100.0, 3600.0);

            Assert.False(ReckonedPlan.Request(new[] { settled }, Ground(Ksc), 100.0, 3600.0).Matches(before));
        }

        private sealed class FixedMargin : IContactLinkModel
        {
            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => 1.0;
        }

        [Fact]
        public void APairWhoseOlderStateKnowsNoLinkToTheOtherEndIsLeftOut()
        {
            var old = Craft("a", 20.0, 1_300_000.0, Links());
            var launchedSince = Craft("b", 50.0, 1_400_000.0, Links(("vessel:a", 222.0)));

            var request = ReckonedPlan.Request(new[] { old, launchedSince }, Ground(), 100.0, 3600.0);

            Assert.Equal(2, request.Nodes.Count);
            Assert.Empty(request.Pairs);
        }

        [Fact]
        public void ACraftAndAStationItHadNoLinkToWhenReadAreLeftOut()
        {
            var a = Craft("a", 0.0, 1_300_000.0, Links());

            var request = ReckonedPlan.Request(new[] { a }, Ground(Ksc), 100.0, 3600.0);

            Assert.Empty(request.Pairs);
        }

        [Fact]
        public void TheSameNewsMakesTheSameRequestInWhateverOrderItWasHeard()
        {
            var a = Craft("a", 0.0, 1_300_000.0, Links(("vessel:b", 1.0), ("ground:ksc", null)));
            var b = Craft("b", 0.0, 1_400_000.0, Links(("vessel:a", 1.0), ("ground:ksc", null)));

            var one = ReckonedPlan.Request(new[] { a, b }, Ground(Ksc), 100.0, 3600.0);
            var other = ReckonedPlan.Request(new[] { b, a }, Ground(Ksc), 100.0, 3600.0);

            Assert.Equal(one.Nodes.Select(n => n.Id), other.Nodes.Select(n => n.Id));
            Assert.Equal(one.Pairs.Select(p => p.A + ">" + p.B), other.Pairs.Select(p => p.A + ">" + p.B));
        }

        [Fact]
        public void TheRequestRunsToAPlanOverEveryPair()
        {
            var a = Craft("a", 0.0, 1_300_000.0, Links(("ground:ksc", null)));

            var plan = ReckonedPlan.Request(new[] { a }, Ground(Ksc), 0.0, 3600.0).Run();

            var pair = Assert.Single(plan.Pairs);
            Assert.NotEmpty(pair.Windows);
        }
    }
}
