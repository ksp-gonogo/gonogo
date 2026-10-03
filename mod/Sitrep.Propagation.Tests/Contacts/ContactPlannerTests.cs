using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Propagation.Tests.Contacts
{
    public class ContactPlannerTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;
        private const double MunMu = 6.5138398e10;
        private const double MunRadius = 200_000.0;
        private const double MunSma = 12_000_000.0;
        private const double SunMu = 1.1723328e18;
        private const double KerbinSma = 13_599_840_256.0;
        private const int Sun = 0, Kerbin = 1, Mun = 2;

        private readonly ITestOutputHelper _output;

        public ContactPlannerTests(ITestOutputHelper output) => _output = output;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
            new SystemBody(Kerbin, new OrbitElements(MunSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu)),
        };

        private static IPropagationProvider Propagator() => new KeplerProvider(System());

        private static OrbitElements KerbinOrbit(double altitude, double meanAnomaly, double inclination = 0.0, double lan = 0.0) =>
            new OrbitElements(KerbinRadius + altitude, 0.0, inclination, lan, 0.0, meanAnomaly, 0.0, KerbinMu);

        private static RotatingGroundStation Station(double longitudeDeg) =>
            RotatingGroundStation.FromLatitudeLongitude(0.0, longitudeDeg, 0.0, KerbinSiderealDay, KerbinRadius, 0.0);

        private static PlanNode Craft(string id, OrbitElements orbit, int parent = Kerbin) =>
            PlanNode.Orbiting(id, PropagationTarget.Vessel(id, parent, orbit));

        private static OccludingBody[] KerbinOnly() => new[] { new OccludingBody(Kerbin, KerbinRadius) };

        [Fact]
        public void APlanForOneStationAndOneCraftMatchesTheSingleStationSweep()
        {
            var orbit = KerbinOrbit(100_000.0, 0.3);
            var nodes = new[] { Craft("vessel:a", orbit), PlanNode.OnSurface("ground:ksc", Kerbin, Station(10.0)) };
            var pairs = new[] { new PlanPair("vessel:a", "ground:ksc", KerbinOnly(), null) };
            const double horizon = 6 * 3600.0;
            const double step = 10.0;

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, horizon, step, 0.05);

            var single = VisibilitySweep.Run(
                new OrbitToRemoteStationGeometry(
                    PropagationTarget.Vessel("vessel:a", Kerbin, orbit),
                    PropagationFrame.CentredOn(Kerbin),
                    new OccludingBody[0],
                    Station(10.0),
                    KerbinRadius,
                    Propagator()),
                0.0,
                plan.Pairs[0].HorizonUt,
                step,
                0.05);
            var expected = single.Changes.Select(c => c.Ut).ToArray();
            var actual = plan.Pairs[0].Windows
                .SelectMany(w => new[] { w.OpenUt, w.CloseUt })
                .Where(t => t != null)
                .Select(t => t!.Value)
                .ToArray();

            Assert.NotEmpty(expected);
            Assert.Equal(expected.Length, actual.Length);
            for (var i = 0; i < expected.Length; i++)
            {
                Assert.InRange(actual[i], expected[i] - 0.1, expected[i] + 0.1);
            }
        }

        [Fact]
        public void TwoCraftOnOpposideSidesOfTheirPlanetNeverTalk()
        {
            var nodes = new[]
            {
                Craft("vessel:a", KerbinOrbit(100_000.0, 0.0)),
                Craft("vessel:b", KerbinOrbit(100_000.0, Math.PI)),
            };
            var pairs = new[] { new PlanPair("vessel:a", "vessel:b", KerbinOnly(), null) };

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            Assert.Empty(plan.Pairs[0].Windows);
        }

        [Fact]
        public void TwoCraftCloseTogetherOnOneOrbitTalkThroughout()
        {
            var nodes = new[]
            {
                Craft("vessel:a", KerbinOrbit(700_000.0, 0.0)),
                Craft("vessel:b", KerbinOrbit(700_000.0, 0.5)),
            };
            var pairs = new[] { new PlanPair("vessel:a", "vessel:b", KerbinOnly(), null) };

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            var window = Assert.Single(plan.Pairs[0].Windows);
            Assert.Null(window.OpenUt);
            Assert.Null(window.CloseUt);
        }

        [Fact]
        public void TwoCraftOnDifferentOrbitsMeetAndPartInTurn()
        {
            var nodes = new[]
            {
                Craft("vessel:low", KerbinOrbit(80_000.0, 0.0)),
                Craft("vessel:high", KerbinOrbit(2_000_000.0, 0.0)),
            };
            var pairs = new[] { new PlanPair("vessel:low", "vessel:high", KerbinOnly(), null) };

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            var windows = plan.Pairs[0].Windows;
            Assert.True(windows.Count >= 3, "the low craft laps the high one, so contact must come and go repeatedly");
            for (var i = 1; i < windows.Count; i++)
            {
                Assert.True(windows[i].OpenUt > windows[i - 1].CloseUt, "windows are in time order and do not overlap");
            }
        }

        [Fact]
        public void ALinkBeyondItsReachIsNeverInContact()
        {
            var nodes = new[]
            {
                Craft("vessel:a", KerbinOrbit(700_000.0, 0.0)),
                Craft("vessel:b", KerbinOrbit(700_000.0, 0.5)),
            };
            var pairs = new[] { new PlanPair("vessel:a", "vessel:b", KerbinOnly(), 1_000.0) };

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            Assert.Empty(plan.Pairs[0].Windows);
        }

        [Fact]
        public void AMoonBlocksACraftBehindItFromTheStations()
        {
            var behindMun = PlanNode.Orbiting(
                "vessel:lander",
                PropagationTarget.Vessel("vessel:lander", Mun, new OrbitElements(MunRadius + 20_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, MunMu)));
            var nodes = new[] { behindMun, PlanNode.OnSurface("ground:ksc", Kerbin, Station(0.0)) };
            var pairs = new[]
            {
                new PlanPair("vessel:lander", "ground:ksc", new[] { new OccludingBody(Kerbin, KerbinRadius), new OccludingBody(Mun, MunRadius) }, null),
            };

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            Assert.True(plan.Pairs[0].Windows.Count >= 2, "the lander's own orbit takes it behind the Mun and back out");
        }

        [Fact]
        public void ACraftOnAnEscapeTrajectoryIsLeftOutWithoutSinkingTheOtherPairs()
        {
            var escaping = new OrbitElements(-2_000_000.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);
            var nodes = new[]
            {
                Craft("vessel:a", KerbinOrbit(700_000.0, 0.0)),
                Craft("vessel:b", KerbinOrbit(700_000.0, 0.5)),
                Craft("vessel:away", escaping),
            };
            var pairs = new[]
            {
                new PlanPair("vessel:a", "vessel:b", KerbinOnly(), null),
                new PlanPair("vessel:a", "vessel:away", KerbinOnly(), null),
            };

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, 3600.0, 10.0, 0.05);

            var only = Assert.Single(plan.Pairs);
            Assert.Equal("vessel:b", only.B);
        }

        [Fact]
        public void ACraftDriftingAtItsOwnMeanMotionAloneIsPlannedAsItsConic()
        {
            var orbit = KerbinOrbit(100_000.0, 0.3);
            var meanMotion = Math.Sqrt(KerbinMu / Math.Pow(orbit.Sma, 3));
            var seed = new SecularOrbit(orbit, 0.0, 0.0, meanMotion, null, SecularBasis.J2Estimate);
            var target = PropagationTarget.Vessel("vessel:a", Kerbin, orbit);
            var station = PlanNode.OnSurface("ground:ksc", Kerbin, Station(10.0));
            var pairs = new[] { new PlanPair("vessel:a", "ground:ksc", KerbinOnly(), null) };

            var conic = ContactPlanner.Plan(new[] { PlanNode.Orbiting("vessel:a", target), station }, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);
            var drifting = ContactPlanner.Plan(new[] { PlanNode.Drifting("vessel:a", target, seed), station }, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            Assert.Equal(conic.Pairs[0].Windows.Count, drifting.Pairs[0].Windows.Count);
            for (var i = 0; i < conic.Pairs[0].Windows.Count; i++)
            {
                Assert.Equal(conic.Pairs[0].Windows[i].OpenUt ?? 0.0, drifting.Pairs[0].Windows[i].OpenUt ?? 0.0, 3);
                Assert.Equal(conic.Pairs[0].Windows[i].CloseUt ?? 0.0, drifting.Pairs[0].Windows[i].CloseUt ?? 0.0, 3);
            }
        }

        [Fact]
        public void ANodeThatPrecessesMovesItsWindowsAndASeedsSpanBoundsThePair()
        {
            var orbit = KerbinOrbit(100_000.0, 0.3, inclination: 0.9);
            var meanMotion = Math.Sqrt(KerbinMu / Math.Pow(orbit.Sma, 3));
            var target = PropagationTarget.Vessel("vessel:a", Kerbin, orbit);
            var station = PlanNode.OnSurface("ground:ksc", Kerbin, Station(10.0));
            var pairs = new[] { new PlanPair("vessel:a", "ground:ksc", KerbinOnly(), null) };
            var still = new SecularOrbit(orbit, 0.0, 0.0, meanMotion, 5_000.0, SecularBasis.Analysis);
            var turning = new SecularOrbit(orbit, 1e-4, 0.0, meanMotion, 5_000.0, SecularBasis.Analysis);

            var a = ContactPlanner.Plan(new[] { PlanNode.Drifting("vessel:a", target, still), station }, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);
            var b = ContactPlanner.Plan(new[] { PlanNode.Drifting("vessel:a", target, turning), station }, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            Assert.InRange(a.Pairs[0].HorizonUt, 4_990.0, 5_000.0);
            var edgesA = a.Pairs[0].Windows.Select(w => w.CloseUt ?? w.OpenUt ?? 0.0).ToArray();
            var edgesB = b.Pairs[0].Windows.Select(w => w.CloseUt ?? w.OpenUt ?? 0.0).ToArray();
            Assert.NotEqual(edgesA, edgesB);
        }

        /// <summary>A dish on the first end, aimed at a node, seeing the second end only inside its beam.</summary>
        private sealed class Dish : IContactLinkModel
        {
            private readonly string _aim;
            private readonly double _beamwidth;

            public Dish(string aim, double beamwidth)
            {
                _aim = aim;
                _beamwidth = beamwidth;
            }

            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions)
            {
                var toward = positions.NodeAt(_aim, ut)!.Value - from;
                var peer = to - from;
                var cos = Vector3d.Dot(toward, peer) / (toward.Magnitude() * peer.Magnitude());
                return _beamwidth - Math.Acos(Math.Max(-1.0, Math.Min(1.0, cos)));
            }
        }

        [Fact]
        public void ADishAimedElsewhereIsNeverAContactAndOneAimedAtThePeerIs()
        {
            var nodes = new[]
            {
                Craft("vessel:a", KerbinOrbit(700_000.0, 0.0)),
                Craft("vessel:b", KerbinOrbit(700_000.0, 0.5)),
                Craft("vessel:c", KerbinOrbit(700_000.0, 3.0)),
            };
            var aimedAway = new[] { new PlanPair("vessel:a", "vessel:b", KerbinOnly(), null, new Dish("vessel:c", 0.05)) };
            var aimedAt = new[] { new PlanPair("vessel:a", "vessel:b", KerbinOnly(), null, new Dish("vessel:b", 0.05)) };

            var away = ContactPlanner.Plan(nodes, aimedAway, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);
            var at = ContactPlanner.Plan(nodes, aimedAt, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            Assert.Empty(away.Pairs[0].Windows);
            var window = Assert.Single(at.Pairs[0].Windows);
            Assert.Null(window.OpenUt);
            Assert.Null(window.CloseUt);
        }

        private sealed class Broken : IContactLinkModel
        {
            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) =>
                throw new InvalidOperationException("a backend's own state is broken");
        }

        [Fact]
        public void ALinkModelThatThrowsLeavesItsPairOnGeometry()
        {
            var nodes = new[]
            {
                Craft("vessel:a", KerbinOrbit(700_000.0, 0.0)),
                Craft("vessel:b", KerbinOrbit(700_000.0, 0.5)),
            };
            var pairs = new[] { new PlanPair("vessel:a", "vessel:b", KerbinOnly(), null, new Broken()) };

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, 6 * 3600.0, 10.0, 0.05);

            var window = Assert.Single(plan.Pairs[0].Windows);
            Assert.Null(window.OpenUt);
            Assert.Null(window.CloseUt);
        }

        [Fact]
        public void ANodeIsSolvedOncePerGridPointWhateverNumberOfPairsItIsIn()
        {
            var nodes = Enumerable.Range(0, 6)
                .Select(i => Craft("vessel:" + i, KerbinOrbit(500_000.0 + (i * 100_000.0), i)))
                .ToArray();
            var pairs = new List<PlanPair>();
            for (var i = 0; i < nodes.Length; i++)
            {
                for (var j = i + 1; j < nodes.Length; j++)
                {
                    pairs.Add(new PlanPair(nodes[i].Id, nodes[j].Id, KerbinOnly(), null));
                }
            }
            const double horizon = 3600.0;
            const double step = 10.0;

            var plan = ContactPlanner.Plan(nodes, pairs, Propagator(), Kerbin, 0.0, horizon, step, 0.05);

            var gridPoints = (long)(horizon / step) + 1;
            var onGrid = (nodes.Length + 1) * gridPoints;
            Assert.True(
                plan.PositionSolves < onGrid * 2,
                "fifteen pairs over six craft must not solve each craft once per pair (" + plan.PositionSolves + " solves, grid alone is " + onGrid + ")");
        }

        /// <summary>
        /// The cost a busy stock save asks of one plan, measured rather than
        /// assumed: twenty craft, ten ground stations, six hours. The figure is
        /// printed for the record rather than asserted, since wall time on a shared
        /// machine is not a fact about the code.
        /// </summary>
        [Fact]
        public void TheCostOfABusySavesPlanIsMeasured()
        {
            var nodes = new List<PlanNode>();
            var random = new Random(782);
            for (var i = 0; i < 20; i++)
            {
                var altitude = 80_000.0 + (random.NextDouble() * 3_000_000.0);
                nodes.Add(Craft("vessel:" + i, KerbinOrbit(altitude, random.NextDouble() * 2 * Math.PI, random.NextDouble() * 0.5, random.NextDouble() * 6.0)));
            }
            for (var s = 0; s < 10; s++)
            {
                nodes.Add(PlanNode.OnSurface("ground:" + s, Kerbin, Station(s * 36.0)));
            }
            var pairs = new List<PlanPair>();
            for (var i = 0; i < nodes.Count; i++)
            {
                for (var j = i + 1; j < nodes.Count; j++)
                {
                    if (nodes[i].Surface != null && nodes[j].Surface != null)
                    {
                        continue;
                    }
                    pairs.Add(new PlanPair(nodes[i].Id, nodes[j].Id, new[] { new OccludingBody(Kerbin, KerbinRadius), new OccludingBody(Mun, MunRadius) }, null));
                }
            }
            const double horizon = 6 * 3600.0;
            var propagator = Propagator();
            var step = ContactPlanner.StepFor(nodes, propagator, horizon);

            var clock = Stopwatch.StartNew();
            var plan = ContactPlanner.Plan(nodes, pairs, propagator, Kerbin, 0.0, horizon, step, 0.5);
            clock.Stop();

            var windows = plan.Pairs.Sum(p => p.Windows.Count);
            _output.WriteLine(
                "busy-save plan: " + nodes.Count + " nodes, " + pairs.Count + " pairs, step " + step.ToString("F1")
                + " s, " + plan.PositionSolves + " solves, " + plan.MarginEvaluations + " margin evaluations, "
                + windows + " windows, " + clock.ElapsedMilliseconds + " ms");

            Assert.Equal(pairs.Count, plan.Pairs.Count);
        }
    }
}
