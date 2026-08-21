using System;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Closest approach answered by the propagation provider, because an encounter
    /// is a consequence of a trajectory rather than a fact beside one.
    ///
    /// <para>It used to be its own capability with its own election, and the
    /// hazard that arrangement carried was not hypothetical: a provider modelling
    /// one physics could win <c>propagation</c> while a two-body solver still won
    /// <c>targetApproach</c>, putting an integrated trajectory and a Kepler
    /// encounter for the same vessel at the same instant on the wire with nothing
    /// to tell them apart. Both now come from one instance, so they cannot
    /// disagree about which physics produced them.</para>
    ///
    /// <para>The geometries below are chosen so the right answer is known without
    /// running the solver: two circular orbits in the same plane at different
    /// radii have their minimum separation at conjunction, exactly
    /// <c>r2 - r1</c>.</para>
    /// </summary>
    public class ClosestApproachIsAPropagationQuestionTests
    {
        private const int Kerbin = 0;
        private const double Mu = 3.5316e12;

        private static OrbitElements Circular(double radius, double meanAnomalyAtEpoch) =>
            new OrbitElements(
                sma: radius,
                ecc: 0.0,
                inc: 0.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: meanAnomalyAtEpoch,
                epoch: 0.0,
                mu: Mu);

        private static PropagationTarget Craft(string id, double radius, double phase) =>
            PropagationTarget.Vessel(id, Kerbin, Circular(radius, phase));

        private static PropagationFrame Frame => PropagationFrame.CentredOn(Kerbin);

        private static double PeriodOf(double radius) =>
            2.0 * Math.PI * Math.Sqrt(radius * radius * radius / Mu);

        [Fact]
        public void TwoCoplanarCirclesMeetAtTheDifferenceOfTheirRadii()
        {
            IPropagationProvider provider = new KeplerProvider();
            var inner = Craft("inner", 700_000.0, 0.0);
            var outer = Craft("outer", 900_000.0, 1.0);

            var approach = provider.SolveClosestApproach(
                inner, outer, Frame, 0.0, 20.0 * PeriodOf(900_000.0));

            Assert.NotNull(approach);
            Assert.Equal(200_000.0, approach!.Distance, 0);
        }

        [Fact]
        public void TheAnswerDoesNotDependOnWhichCraftIsNamedFirst()
        {
            IPropagationProvider provider = new KeplerProvider();
            var inner = Craft("inner", 700_000.0, 0.0);
            var outer = Craft("outer", 900_000.0, 1.0);
            var window = 20.0 * PeriodOf(900_000.0);

            var forward = provider.SolveClosestApproach(inner, outer, Frame, 0.0, window);
            var reversed = provider.SolveClosestApproach(outer, inner, Frame, 0.0, window);

            Assert.NotNull(forward);
            Assert.NotNull(reversed);
            Assert.Equal(forward!.Time, reversed!.Time, 3);
            Assert.Equal(forward.Distance, reversed.Distance, 3);
        }

        /// <summary>
        /// The FIRST turn, not the deepest one in the window. An operator flying a
        /// rendezvous is asking what happens next, and a closer pass three orbits
        /// later is an answer to a different question.
        /// </summary>
        [Fact]
        public void ItReportsTheNextApproachRatherThanTheBestOneInTheWindow()
        {
            IPropagationProvider provider = new KeplerProvider();
            var inner = Craft("inner", 700_000.0, 0.0);
            var outer = Craft("outer", 900_000.0, 1.0);
            var window = 20.0 * PeriodOf(900_000.0);

            var first = provider.SolveClosestApproach(inner, outer, Frame, 0.0, window);
            Assert.NotNull(first);

            var next = provider.SolveClosestApproach(inner, outer, Frame, first!.Time + 1.0, window);
            Assert.NotNull(next);
            Assert.True(
                next!.Time > first.Time,
                "asking again from just after an approach must move forward, not re-report the same one");

            // Two coplanar circles line up once per SYNODIC period, which is far
            // longer than either orbit: T1*T2/(T2-T1), about 6200s for these two
            // against a 2854s outer period. Asserting against an orbital period
            // instead is the mistake that reads as a solver bug.
            var synodic = PeriodOf(700_000.0) * PeriodOf(900_000.0)
                / (PeriodOf(900_000.0) - PeriodOf(700_000.0));
            Assert.True(
                next.Time - first.Time < synodic * 1.01,
                "the next conjunction is one synodic period on, not one orbit");
            Assert.Equal(200_000.0, next.Distance, 0);
        }

        [Fact]
        public void ARepeatedQuestionGetsAnIdenticalAnswer()
        {
            IPropagationProvider provider = new KeplerProvider();
            var inner = Craft("inner", 700_000.0, 0.3);
            var outer = Craft("outer", 1_400_000.0, 2.2);
            var window = 20.0 * PeriodOf(1_400_000.0);

            var once = provider.SolveClosestApproach(inner, outer, Frame, 0.0, window);
            var twice = provider.SolveClosestApproach(inner, outer, Frame, 0.0, window);

            Assert.NotNull(once);
            Assert.NotNull(twice);
            Assert.Equal(once!.Time, twice!.Time);
            Assert.Equal(once.Distance, twice.Distance);
        }

        [Fact]
        public void AWindowWithNoTurnInItIsAnsweredWithNothing()
        {
            IPropagationProvider provider = new KeplerProvider();
            var inner = Craft("inner", 700_000.0, 0.0);
            var outer = Craft("outer", 900_000.0, 1.0);

            // A window far shorter than either orbit cannot contain a turn, and a
            // sentinel zero-distance record here would read as a collision.
            var approach = provider.SolveClosestApproach(inner, outer, Frame, 0.0, 1.0);

            Assert.Null(approach);
        }

        [Fact]
        public void ATargetTheProviderCannotDescribeIsDeclinedRatherThanGuessed()
        {
            IPropagationProvider provider = new KeplerProvider();
            var craft = Craft("craft", 700_000.0, 0.0);
            var noConic = PropagationTarget.Vessel("unknown", Kerbin, null);

            Assert.Null(provider.SolveClosestApproach(
                craft, noConic, Frame, 0.0, 10.0 * PeriodOf(700_000.0)));
        }

        [Fact]
        public void AnEmptyWindowIsNotAnEncounter()
        {
            IPropagationProvider provider = new KeplerProvider();
            var inner = Craft("inner", 700_000.0, 0.0);
            var outer = Craft("outer", 900_000.0, 1.0);

            Assert.Null(provider.SolveClosestApproach(inner, outer, Frame, 500.0, 500.0));
            Assert.Null(provider.SolveClosestApproach(inner, outer, Frame, 500.0, 100.0));
        }
    }
}
