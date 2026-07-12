using System;
using Xunit;
using Sitrep.Propagation;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Known-vector tests for an eccentric (ecc=0.5) equatorial orbit,
    /// mu=1, sma=1, so mean motion n = 1 -- periapsis/apoapsis land at
    /// clean UTs (0 and pi respectively), and their radii have simple
    /// closed forms: r_periapsis = sma*(1-e), r_apoapsis = sma*(1+e).
    /// </summary>
    public class EccentricOrbitTests
    {
        private const double Tolerance = 1e-9;

        private static OrbitElements EccentricOrbit()
        {
            return new OrbitElements(
                sma: 1.0,
                ecc: 0.5,
                inc: 0.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: 0.0,
                epoch: 0.0,
                mu: 1.0);
        }

        [Fact]
        public void RadiusAtPeriapsisEqualsSmaTimesOneMinusEcc()
        {
            var provider = new KeplerProvider();
            var orbit = EccentricOrbit();

            // M(ut=0) = 0 => E = 0 (periapsis, by construction of
            // meanAnomalyAtEpoch = 0 at epoch = 0).
            StateVector state = provider.Solve(orbit, 0.0);

            double expectedRadius = orbit.Sma * (1.0 - orbit.Ecc); // 0.5
            Assert.Equal(expectedRadius, state.Position.Magnitude(), Tolerance);
        }

        [Fact]
        public void RadiusAtApoapsisEqualsSmaTimesOnePlusEcc()
        {
            var provider = new KeplerProvider();
            var orbit = EccentricOrbit();

            // n = sqrt(mu/sma^3) = 1, so M = pi at ut = pi. For M = pi,
            // E = pi exactly regardless of e (sin(pi) = 0 satisfies
            // Kepler's equation trivially), which is the orbit's apoapsis.
            StateVector state = provider.Solve(orbit, Math.PI);

            double expectedRadius = orbit.Sma * (1.0 + orbit.Ecc); // 1.5
            Assert.Equal(expectedRadius, state.Position.Magnitude(), Tolerance);
        }

        [Fact]
        public void VisVivaHoldsAtSeveralUts()
        {
            var provider = new KeplerProvider();
            var orbit = EccentricOrbit();

            foreach (double ut in new[] { 0.0, 0.3, 1.0, 2.0, Math.PI, 4.0, 5.0, 6.2 })
            {
                StateVector state = provider.Solve(orbit, ut);
                double r = state.Position.Magnitude();
                double v = state.Velocity.Magnitude();

                double expectedVSquared = orbit.Mu * (2.0 / r - 1.0 / orbit.Sma);

                Assert.True(
                    Math.Abs(v * v - expectedVSquared) < 1e-6,
                    $"vis-viva violated at ut={ut}: v^2={v * v}, expected={expectedVSquared}");
            }
        }

        [Fact]
        public void ApoapsisAndPeriapsisRadiiAreOrbitExtremes()
        {
            var provider = new KeplerProvider();
            var orbit = EccentricOrbit();

            double periapsis = orbit.Sma * (1.0 - orbit.Ecc);
            double apoapsis = orbit.Sma * (1.0 + orbit.Ecc);

            // Sample densely across one full period (period = 2*pi since
            // n=1) and confirm no sampled radius escapes [periapsis, apoapsis].
            for (double ut = 0.0; ut < 2.0 * Math.PI; ut += 0.05)
            {
                StateVector state = provider.Solve(orbit, ut);
                double r = state.Position.Magnitude();

                Assert.True(r >= periapsis - 1e-9, $"radius {r} below periapsis at ut={ut}");
                Assert.True(r <= apoapsis + 1e-9, $"radius {r} above apoapsis at ut={ut}");
            }
        }
    }
}
