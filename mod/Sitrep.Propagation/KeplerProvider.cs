using System;

namespace Sitrep.Propagation
{
    /// <summary>
    /// Analytic two-body (Keplerian) propagator: solves Kepler's equation
    /// for the eccentric anomaly via Newton-Raphson, then reconstructs the
    /// parent-body-relative state vector by rotating the perifocal-frame
    /// position/velocity into the inertial frame using the standard 3-1-3
    /// Euler rotation (argument of periapsis, then inclination, then
    /// longitude of ascending node -- the Vallado/AIAA convention).
    ///
    /// Deterministic and side-effect-free: no wall-clock, no RNG. Only
    /// elliptical orbits (0 &lt;= ecc &lt; 1) are supported -- this is the
    /// dead-reckoning foundation for bound orbits, not an escape-trajectory
    /// solver.
    /// </summary>
    public class KeplerProvider : IPropagationProvider
    {
        private const int MaxNewtonIterations = 50;
        private const double NewtonTolerance = 1e-12;

        public StateVector Solve(OrbitElements orbit, double ut)
        {
            if (orbit.Ecc < 0.0 || orbit.Ecc >= 1.0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(orbit),
                    "KeplerProvider only supports elliptical orbits (0 <= ecc < 1); got ecc=" + orbit.Ecc);
            }

            double n = Math.Sqrt(orbit.Mu / (orbit.Sma * orbit.Sma * orbit.Sma));
            double meanAnomaly = WrapTwoPi(orbit.MeanAnomalyAtEpoch + n * (ut - orbit.Epoch));

            double eccentricAnomaly = SolveEccentricAnomaly(meanAnomaly, orbit.Ecc);

            double trueAnomaly = 2.0 * Math.Atan2(
                Math.Sqrt(1.0 + orbit.Ecc) * Math.Sin(eccentricAnomaly / 2.0),
                Math.Sqrt(1.0 - orbit.Ecc) * Math.Cos(eccentricAnomaly / 2.0));

            double radius = orbit.Sma * (1.0 - orbit.Ecc * Math.Cos(eccentricAnomaly));

            // Specific angular momentum magnitude; for ecc=0 this reduces to
            // sqrt(mu*sma), giving the expected circular speed sqrt(mu/sma)
            // below.
            double h = Math.Sqrt(orbit.Mu * orbit.Sma * (1.0 - orbit.Ecc * orbit.Ecc));

            double cosNu = Math.Cos(trueAnomaly);
            double sinNu = Math.Sin(trueAnomaly);

            double xPerifocal = radius * cosNu;
            double yPerifocal = radius * sinNu;

            double muOverH = orbit.Mu / h;
            double vxPerifocal = -muOverH * sinNu;
            double vyPerifocal = muOverH * (orbit.Ecc + cosNu);

            Vector3d position = RotatePerifocalToInertial(xPerifocal, yPerifocal, orbit.Inc, orbit.Lan, orbit.ArgPe);
            Vector3d velocity = RotatePerifocalToInertial(vxPerifocal, vyPerifocal, orbit.Inc, orbit.Lan, orbit.ArgPe);

            return new StateVector(position, velocity);
        }

        /// <summary>
        /// Newton-Raphson solve of Kepler's equation M = E - e*sin(E) for E.
        /// Converges in ~5 iterations for typical (e &lt; 0.9) orbits; the
        /// iteration cap and tolerance below are a guard against pathological
        /// inputs near e -&gt; 1, not the expected case.
        /// </summary>
        private static double SolveEccentricAnomaly(double meanAnomaly, double ecc)
        {
            if (ecc < 1e-12)
            {
                // Circular orbit: E = M exactly, and the Newton step below
                // would converge to this immediately anyway -- short-circuit
                // to avoid doing pointless work (and to be explicit that the
                // e~=0 case is intentionally handled, not accidentally fine).
                return meanAnomaly;
            }

            // Standard high-eccentricity-aware initial guess (Vallado):
            // starting at M works for low/moderate e, but biases the guess
            // toward periapsis for higher e so Newton-Raphson doesn't
            // overshoot near e -> 1.
            double eccentricAnomaly = ecc < 0.8 ? meanAnomaly : Math.PI;

            for (int i = 0; i < MaxNewtonIterations; i++)
            {
                double f = eccentricAnomaly - ecc * Math.Sin(eccentricAnomaly) - meanAnomaly;
                double fPrime = 1.0 - ecc * Math.Cos(eccentricAnomaly);
                double delta = f / fPrime;
                eccentricAnomaly -= delta;

                if (Math.Abs(delta) < NewtonTolerance)
                {
                    break;
                }
            }

            return eccentricAnomaly;
        }

        /// <summary>
        /// Rotates a planar perifocal-frame vector (z=0) into the
        /// parent-body-relative inertial frame using the 3-1-3 Euler
        /// rotation R3(-lan) * R1(-inc) * R3(-argPe) (Vallado/AIAA
        /// convention). Applies identically to position and velocity
        /// components.
        /// </summary>
        private static Vector3d RotatePerifocalToInertial(double xPf, double yPf, double inc, double lan, double argPe)
        {
            double cosLan = Math.Cos(lan);
            double sinLan = Math.Sin(lan);
            double cosArgPe = Math.Cos(argPe);
            double sinArgPe = Math.Sin(argPe);
            double cosInc = Math.Cos(inc);
            double sinInc = Math.Sin(inc);

            double r11 = cosLan * cosArgPe - sinLan * sinArgPe * cosInc;
            double r12 = -cosLan * sinArgPe - sinLan * cosArgPe * cosInc;
            double r21 = sinLan * cosArgPe + cosLan * sinArgPe * cosInc;
            double r22 = -sinLan * sinArgPe + cosLan * cosArgPe * cosInc;
            double r31 = sinArgPe * sinInc;
            double r32 = cosArgPe * sinInc;

            double x = r11 * xPf + r12 * yPf;
            double y = r21 * xPf + r22 * yPf;
            double z = r31 * xPf + r32 * yPf;

            return new Vector3d(x, y, z);
        }

        private static double WrapTwoPi(double angle)
        {
            double twoPi = 2.0 * Math.PI;
            double wrapped = angle % twoPi;
            if (wrapped < 0)
            {
                wrapped += twoPi;
            }

            return wrapped;
        }
    }
}
