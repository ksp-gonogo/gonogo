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

        private const int Sun = 0, Duna = 2, Ike = 3;
        private const double DunaMu = 3.0136321197e11;

        private static double Rad(double degrees) => degrees * System.Math.PI / 180.0;

        private static readonly SystemBody[] DunaSystem =
        {
            new SystemBody(-1, null),
            new SystemBody(Sun, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 3.14, 0.0, 1.1723328e18)),
            new SystemBody(Sun, new OrbitElements(20_726_155_264.0, 0.051, Rad(0.06), Rad(135.5), 0.0, 3.14, 0.0, 1.1723328e18)),
            new SystemBody(Duna, new OrbitElements(3_200_000.0, 0.03, Rad(0.2), 0.0, 0.0, 1.7, 0.0, DunaMu)),
        };

        private static double DunaOcclusion(int index) =>
            index == Kerbin ? 450_000.0 : index == Duna ? 240_000.0 : index == Ike ? 117_000.0 : 0.0;

        /// <summary>
        /// A relay in a circular equatorial orbit round Duna, 2000 km up, and a station on Kerbin 3.3e10 m
        /// away: Ike crosses the line between them for about ten minutes, which the game's own network showed
        /// as the relay out of contact from 2772.3 to 3354.3 (the plan's figures follow from the occluding radii it is given).
        /// </summary>
        [Fact]
        public void AMoonOfTheCraftsPlanetCrossingTheLineClosesTheWindow()
        {
            var relay = CraftState.Orbiting(
                "vessel:relay", 2162.7, Duna,
                new OrbitElements(2_320_000.0, 0.0, 0.0, Rad(259.84905039149908), Rad(179.85959125613238), 4.8940949811570373, 73.56, DunaMu),
                null, null, true, Links(("ground:ksc", null)));
            var station = PlanNode.OnSurface(
                "ground:ksc", Kerbin, RotatingGroundStation.FromLatitudeLongitude(0.0, 0.0, 0.0, 21_549.425, KerbinRadius, 0.0));
            var ground = new PlanGround(new[] { station }, DunaSystem, Sun, DunaOcclusion);

            var request = ReckonedPlan.Request(new[] { relay }, ground, 2512.0, 3600.0);
            Assert.Contains(request.Pairs.Single().Occluders, o => o.BodyIndex == Ike);

            var window = request.Run().Pairs.Single().Windows;
            var closes = window.Where(w => w.CloseUt != null).Select(w => w.CloseUt!.Value).ToArray();
            var opens = window.Where(w => w.OpenUt != null).Select(w => w.OpenUt!.Value).ToArray();
            Assert.Contains(closes, c => c > 2740.0 && c < 2800.0);
            Assert.Contains(opens, o => o > 3250.0 && o < 3390.0);
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

        /// <summary>A model that refuses every link, as a backend does for a pair whose dish points away.</summary>
        private sealed class Refuses : IPersistableContactLinkModel
        {
            public string ModelId => "refuses.v1";

            public Dictionary<string, object?> Describe() => new Dictionary<string, object?>();

            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => -1.0;
        }

        private static IContactLinkModel? RestoreRefuses(string model, IReadOnlyDictionary<string, object?> data) =>
            model == "refuses.v1" ? new Refuses() : null;

        /// <summary>
        /// A craft the centre cannot hear keeps the state it was last heard with,
        /// across a load as well. Its pair is planned on the backend's model in
        /// that state, so a pair the model refuses stays shut however far the
        /// bare range would reach.
        /// </summary>
        [Fact]
        public void ARestoredStatePlansItsPairOnItsLinkModelNotOnBareRange()
        {
            var silent = CraftState.Orbiting(
                "vessel:a", 20.0, Kerbin, Orbit(1_300_000.0), null, null, true,
                new Dictionary<string, CraftLink> { ["vessel:b"] = new CraftLink(1e12, new Refuses()) });
            var heard = Craft("b", 50.0, 1_400_000.0, Links(("vessel:a", 1e12)));
            var encoded = HeardSnapshotCodec.Encode(new HeardSnapshot(new[]
            {
                new HeardAtCentre("ground:ksc", new[] { silent, heard }, new Dictionary<string, bool>()),
            }));

            List<CraftState> Restored(System.Func<string, IReadOnlyDictionary<string, object?>, IContactLinkModel?>? restoreLink) =>
                HeardSnapshotCodec.Decode(encoded, null, restoreLink)!.Centres.Single().States.ToList();

            var onModel = Assert.Single(ReckonedPlan.Request(Restored(RestoreRefuses), Ground(), 0.0, 3600.0).Run().Pairs);
            var onRange = Assert.Single(ReckonedPlan.Request(Restored(null), Ground(), 0.0, 3600.0).Run().Pairs);

            Assert.Empty(onModel.Windows);
            Assert.NotEmpty(onRange.Windows);
        }

        [Fact]
        public void TheRequestRunsToAPlanOverEveryPair()
        {
            var a = Craft("a", 0.0, 1_300_000.0, Links(("ground:ksc", null)));

            var plan = ReckonedPlan.Request(new[] { a }, Ground(Ksc), 0.0, 3600.0).Run();

            var pair = Assert.Single(plan.Pairs);
            Assert.NotEmpty(pair.Windows);
        }

        [Fact]
        public void APairThatHasNoReachSaysWhyOnTheWire()
        {
            var links = new Dictionary<string, CraftLink>
            {
                ["ground:ksc"] = new CraftLink(0.0, null, null, CommsNoReachReasons.Unpowered),
            };
            var dark = Craft("a", 0.0, 1_300_000.0, links);
            var lit = Craft("b", 0.0, 1_400_000.0, Links(("ground:ksc", null)));

            var request = ReckonedPlan.Request(new[] { dark, lit }, Ground(Ksc), 0.0, 3600.0);
            var wire = ContactPlanWire.ToPayload(request.Run(), request.Unsettled);

            var darkPair = wire.Pairs.Single(p => p.A == "vessel:a" && p.B == "ground:ksc");
            Assert.Equal("unpowered", darkPair.NoReachReason);
            Assert.Empty(darkPair.Windows);
            Assert.Null(wire.Pairs.Single(p => p.A == "vessel:b" && p.B == "ground:ksc").NoReachReason);
        }

        [Fact]
        public void AChangedReasonIsADifferentRequest()
        {
            var lit = Craft("a", 0.0, 1_300_000.0, Links(("ground:ksc", 0.0)));
            var dark = Craft("a", 0.0, 1_300_000.0, new Dictionary<string, CraftLink>
            {
                ["ground:ksc"] = new CraftLink(0.0, null, null, CommsNoReachReasons.Unpowered),
            });

            var before = ReckonedPlan.Request(new[] { lit }, Ground(Ksc), 0.0, 3600.0);

            Assert.False(ReckonedPlan.Request(new[] { dark }, Ground(Ksc), 0.0, 3600.0).Matches(before));
        }
    }
}
