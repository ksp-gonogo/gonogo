using System;
using Xunit;
using Sitrep.Propagation;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// <see cref="KeplerProvider"/> is documented (and coded) to only
    /// support elliptical orbits (0 &lt;= ecc &lt; 1); parabolic/hyperbolic
    /// (ecc &gt;= 1) and negative eccentricities must throw rather than
    /// silently return a nonsense state vector. No existing test in this
    /// project pins that guard.
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

        [Fact]
        public void ParabolicEccentricityThrows()
        {
            var provider = new KeplerProvider();
            var orbit = OrbitWithEcc(1.0);

            Assert.Throws<ArgumentOutOfRangeException>(() => provider.Solve(orbit, 0.0));
        }

        [Fact]
        public void NegativeEccentricityThrows()
        {
            var provider = new KeplerProvider();
            var orbit = OrbitWithEcc(-0.1);

            Assert.Throws<ArgumentOutOfRangeException>(() => provider.Solve(orbit, 0.0));
        }
    }
}
