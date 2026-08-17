using System;
using Xunit;
using Sitrep.Propagation;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// <see cref="KeplerProvider"/> is documented (and coded) to only
    /// support elliptical orbits (0 &lt;= ecc &lt; 1); parabolic/hyperbolic
    /// (ecc &gt;= 1) and negative eccentricities must be refused rather than
    /// silently returning a nonsense state vector.
    ///
    /// <para>What that refusal LOOKS like changed when the element-keyed door was
    /// closed. It used to be an <c>ArgumentOutOfRangeException</c> from deep in the
    /// solver; it is now a <see cref="NotSupportedException"/> from the seam, because
    /// <see cref="IPropagationProvider.CanPropagate"/> declines an unbound orbit before
    /// the solver ever sees it. The refusal is the same answer every other caller gets,
    /// and asking first is what a caller on a hot path is meant to do, so both halves
    /// are pinned here.</para>
    /// </summary>
    public class InvalidEccentricityTests
    {
        private static OrbitElements OrbitWithEcc(double ecc)
        {
            return new OrbitElements(
                sma: 1.0,
                ecc: ecc,
                inc: 0.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: 0.0,
                epoch: 0.0,
                mu: 1.0);
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(1.4)]
        [InlineData(-0.1)]
        public void AnUnboundOrEccentricallyImpossibleOrbitIsDeclinedRatherThanSolved(double ecc)
        {
            IPropagationProvider provider = new KeplerProvider();
            var orbit = OrbitWithEcc(ecc);

            Assert.False(provider.CanPropagate(ThroughTheSeam.Craft(orbit), 0.0, 0.0));
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(-0.1)]
        public void SolvingOneAnywayThrowsRatherThanReturningANonsenseVector(double ecc)
        {
            IPropagationProvider provider = new KeplerProvider();
            var orbit = OrbitWithEcc(ecc);

            Assert.Throws<NotSupportedException>(() => provider.SolveConic(orbit, 0.0));
        }
    }
}
