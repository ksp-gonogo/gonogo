using System;
using System.Collections.Generic;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// How close in and how far out a craft gets is the provider's answer, not
    /// <c>sma * (1 +/- ecc)</c> written at the call site.
    ///
    /// <para>It was the last inline conic derivation left in the mod, and it sat
    /// directly beside one that had already been converted: <c>CapturedOrbit.PeriodSeconds</c>
    /// asks the provider and says in a comment that it does so in order to report the
    /// same number the mod would act on, while the two apsis properties next to it
    /// computed their own. Left alone that comment becomes a lie by proximity, and
    /// "orbits are conics is assumed in exactly one place" becomes a sentence that is
    /// true of the solver and quietly false of the tooling reporting on it.</para>
    ///
    /// <para>Named for the closest and furthest RADIUS rather than for periapsis and
    /// apoapsis on purpose. The conic words would carry the conic back into the seam's
    /// vocabulary, which is the mistake the whole exercise exists to undo; a craft under
    /// any physics has a closest and a furthest approach, and only a two-body one has
    /// them at fixed apsides.</para>
    /// </summary>
    public class RadiusExtremesAreAProviderQuestionTests
    {
        private const double KerbinMu = 3.5316e12;

        private static OrbitElements Elliptical(double sma, double ecc) =>
            new OrbitElements(sma, ecc, 0.3, 0.7, 1.1, 0.4, 0.0, KerbinMu);

        [Theory]
        [InlineData(0.0)]
        [InlineData(0.3)]
        [InlineData(0.82)]
        public void TheExtremesOfAnEllipseAreItsApsides(double ecc)
        {
            IPropagationProvider provider = new KeplerProvider();
            var orbit = Elliptical(2_000_000.0, ecc);

            var extremes = provider.RadiusExtremesOf(ThroughTheSeam.Craft(orbit));

            Assert.NotNull(extremes);
            Assert.Equal(2_000_000.0 * (1.0 - ecc), extremes!.Value.ClosestMeters, 6);
            Assert.Equal(2_000_000.0 * (1.0 + ecc), extremes.Value.FurthestMeters, 6);
        }

        /// <summary>
        /// The independent check, and the one that would survive the implementation
        /// being rewritten: fly the orbit through the seam and measure. An assertion
        /// that only restated <c>sma * (1 +/- ecc)</c> would agree with a wrong answer
        /// as readily as with a right one.
        /// </summary>
        [Theory]
        [InlineData(0.0)]
        [InlineData(0.3)]
        [InlineData(0.82)]
        public void TheExtremesMatchWhatTheCraftActuallyReachesWhenFlown(double ecc)
        {
            IPropagationProvider provider = new KeplerProvider();
            var target = ThroughTheSeam.Craft(Elliptical(2_000_000.0, ecc));
            var frame = PropagationFrame.CentredOn(ThroughTheSeam.ItsOwnParent);
            var cycle = provider.CharacteristicCycleSeconds(target)!.Value;

            var uts = new List<double>();
            for (var i = 0; i < 4_000; i++)
            {
                uts.Add(cycle * i / 4_000.0);
            }
            var flown = new StateVector[uts.Count];
            provider.SolveMany(target, frame, uts, flown);

            var closest = double.MaxValue;
            var furthest = 0.0;
            foreach (var state in flown)
            {
                var radius = state.Position.Magnitude();
                if (radius < closest) closest = radius;
                if (radius > furthest) furthest = radius;
            }

            var extremes = provider.RadiusExtremesOf(target)!.Value;

            // Sampling can only ever fall SHORT of a true extreme, never past it, so the
            // useful tolerance is one-sided. The sliver of slack on the tight side is
            // floating point rather than method: at ecc = 0 every sample IS the extreme,
            // and the sampled minimum came out 5e-10 m under the closed-form answer.
            Assert.InRange(extremes.ClosestMeters, closest * 0.999, closest * 1.000000001);
            Assert.InRange(extremes.FurthestMeters, furthest * 0.999999999, furthest * 1.001);
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(2.5)]
        public void AnUnboundTrajectoryHasNoFurthestPoint(double ecc)
        {
            // Same shape of answer as CharacteristicCycleSeconds, and for the same
            // reason: a hyperbolic trajectory recedes forever, so declining is the
            // fact rather than a failure to compute one.
            IPropagationProvider provider = new KeplerProvider();

            Assert.Null(provider.RadiusExtremesOf(ThroughTheSeam.Craft(Elliptical(2_000_000.0, ecc))));
        }

        [Fact]
        public void ATargetCarryingNoElementsIsDeclinedRatherThanGuessedAt()
        {
            IPropagationProvider provider = new KeplerProvider();
            var target = PropagationTarget.Vessel("vessel-guid", 0, null);

            Assert.Null(provider.RadiusExtremesOf(target));
        }

        [Fact]
        public void ABodysExtremesComeFromTheProvidersOwnTable()
        {
            // A body is named, not described, so its extremes cannot come from the
            // caller any more than its position can.
            const int Kerbin = 0, Minmus = 1;
            var minmusOrbit = new OrbitElements(46_400_000.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);
            IPropagationProvider provider = new KeplerProvider(new[]
            {
                new SystemBody(-1, null),
                new SystemBody(Kerbin, minmusOrbit),
            });

            var extremes = provider.RadiusExtremesOf(PropagationTarget.Body(Minmus));

            Assert.NotNull(extremes);
            Assert.Equal(46_400_000.0 * 0.9, extremes!.Value.ClosestMeters, 3);
            Assert.Equal(46_400_000.0 * 1.1, extremes.Value.FurthestMeters, 3);
        }

        [Fact]
        public void WithoutATableABodyHasNoKnownExtremes()
        {
            Assert.Null(new KeplerProvider().RadiusExtremesOf(PropagationTarget.Body(1)));
        }
    }
}
