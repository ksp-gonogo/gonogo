using System;
using System.Collections.Generic;
using Sitrep.Contract;

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
    ///
    /// <para><b>Reaching another body's frame is done here, by summing conics up and
    /// down the body tree.</b> That sum used to be the visibility geometry's, which
    /// left it outside the seam entirely: the caller held a list of conics and a
    /// direction flag per link, so swapping the propagator swapped only part of the
    /// arithmetic. Under a provider that already knows where everything is, the walk
    /// is REDUNDANT rather than broken, which is why it belongs to the one
    /// implementation that has no other way to get there.</para>
    ///
    /// <para>Constructed without a system table it can still answer in a target's
    /// OWN parent frame, which is what the overwhelming majority of callers want and
    /// what the elements alone describe. Asked for any other frame it refuses.</para>
    /// </summary>
    public class KeplerProvider : IPropagationProvider
    {
        private const int MaxNewtonIterations = 50;
        private const double NewtonTolerance = 1e-12;

        private readonly Func<IReadOnlyList<SystemBody>>? _bodies;

        /// <summary>A provider with no map of the system: parent frames only.</summary>
        public KeplerProvider()
            : this((Func<IReadOnlyList<SystemBody>>?)null)
        {
        }

        /// <summary>A provider over a fixed body table.</summary>
        public KeplerProvider(IReadOnlyList<SystemBody>? bodies)
            : this(bodies == null ? (Func<IReadOnlyList<SystemBody>>?)null : () => bodies)
        {
        }

        /// <param name="bodies">
        /// The body table, read on demand. A callback rather than a list because the
        /// provider is elected at bootstrap, before the game has a body list to hand
        /// over; the source is free to build it on first ask and hold it after.
        /// </param>
        public KeplerProvider(Func<IReadOnlyList<SystemBody>>? bodies)
        {
            _bodies = bodies;
        }

        /// <summary>
        /// The stock analytic solver's id, as a constant so the wire can state it
        /// rather than a second literal drifting from this one (see
        /// <c>PropagationHorizon.ProviderId</c>).
        /// </summary>
        public const string ProviderIdValue = "kepler";

        public string ProviderId => ProviderIdValue;

        public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut)
        {
            if (!CanPropagate(target, frame, ut, ut))
            {
                throw new NotSupportedException(
                    "KeplerProvider cannot propagate this target in the requested frame: it solves "
                    + "bound two-body conics, and reaching a frame centred on index "
                    + frame.CentreBodyIndex + " from index "
                    + (target.Kind == PropagationTargetKind.Body ? target.BodyIndex : target.ParentBodyIndex)
                    + " needs a body table in which every link on the path is one.");
            }

            var origin = target.Kind == PropagationTargetKind.Body
                ? target.BodyIndex
                : target.ParentBodyIndex;
            var state = OffsetTo(frame.CentreBodyIndex, origin, ut);

            if (target.Kind == PropagationTargetKind.Body)
            {
                return state;
            }

            var own = Solve(target.Osculating!.Value, ut);
            return new StateVector(state.Position + own.Position, state.Velocity + own.Velocity);
        }

        /// <summary>
        /// Where <paramref name="bodyIndex"/> is relative to
        /// <paramref name="centreIndex"/>, by summing each body's own conic along
        /// the path between them.
        ///
        /// <para>A climb SUBTRACTS: the frame sits on the far side of the body being
        /// climbed past, so its orbit is walked backwards. Getting that sign wrong is
        /// wrong by twice an orbital radius and still looks like a position.</para>
        /// </summary>
        private StateVector OffsetTo(int centreIndex, int bodyIndex, double ut)
        {
            var position = new Vector3d(0.0, 0.0, 0.0);
            var velocity = new Vector3d(0.0, 0.0, 0.0);
            if (centreIndex == bodyIndex)
            {
                return new StateVector(position, velocity);
            }

            // CanPropagate has already established that the table exists and that
            // every link on the path is a bound conic, so the walk below does not
            // re-check either.
            var bodies = _bodies!();
            List<int> climb, descend;
            BodyHierarchy.TryPathBetween(centreIndex, bodyIndex, bodies, out climb, out descend);

            foreach (var index in climb)
            {
                var step = Solve(bodies[index].Orbit!.Value, ut);
                position = position - step.Position;
                velocity = velocity - step.Velocity;
            }
            foreach (var index in descend)
            {
                var step = Solve(bodies[index].Orbit!.Value, ut);
                position = position + step.Position;
                velocity = velocity + step.Velocity;
            }

            return new StateVector(position, velocity);
        }

        public void SolveMany(
            PropagationTarget target,
            PropagationFrame frame,
            IReadOnlyList<double> uts,
            StateVector[] into)
        {
            if (uts == null) throw new ArgumentNullException(nameof(uts));
            if (into == null) throw new ArgumentNullException(nameof(into));
            if (into.Length < uts.Count)
            {
                // Filling only part of the caller's buffer would leave stale samples
                // in the tail, which a sweep reads as extra crossings rather than as
                // an error.
                throw new ArgumentException(
                    "The destination holds " + into.Length + " slots for " + uts.Count + " sample times.",
                    nameof(into));
            }

            for (var i = 0; i < uts.Count; i++)
            {
                into[i] = Solve(target, frame, uts[i]);
            }
        }

        /// <summary>
        /// The orbital period implied by the elements, or null when they do not
        /// imply one. Every inline <c>2*pi*sqrt(a^3/mu)</c> in this codebase is a
        /// call to this.
        /// </summary>
        public double? CharacteristicCycleSeconds(PropagationTarget target)
        {
            var elements = target.Kind == PropagationTargetKind.Body
                ? OrbitOfBody(target.BodyIndex)
                : target.Osculating;
            if (!IsBoundConic(elements))
            {
                return null;
            }

            var orbit = elements!.Value;
            return 2.0 * Math.PI * Math.Sqrt(orbit.Sma * orbit.Sma * orbit.Sma / orbit.Mu);
        }

        /// <summary>
        /// The analytic solution has no horizon, so the window is ignored: a
        /// two-body conic is as valid a year out as a second out. What this does
        /// check is that the target can be described at all, and that the requested
        /// frame can be reached from it, which for anything but the target's own
        /// parent frame means walking the body table and finding a bound conic at
        /// every link.
        /// </summary>
        public bool CanPropagate(PropagationTarget target, PropagationFrame frame, double fromUt, double toUt)
        {
            if (target.Kind == PropagationTargetKind.Vessel && !IsBoundConic(target.Osculating))
            {
                return false;
            }

            var origin = target.Kind == PropagationTargetKind.Body
                ? target.BodyIndex
                : target.ParentBodyIndex;
            if (frame.CentreBodyIndex == origin)
            {
                // The elements already describe the answer, and a body sits on its
                // own centre. Neither needs a map of the system, which is why a
                // provider constructed with nothing still serves the common case.
                return target.Kind == PropagationTargetKind.Vessel || _bodies != null;
            }

            var bodies = _bodies == null ? null : _bodies();
            List<int> climb, descend;
            if (!BodyHierarchy.TryPathBetween(frame.CentreBodyIndex, origin, bodies, out climb, out descend))
            {
                return false;
            }

            foreach (var index in climb)
            {
                if (!IsBoundConic(bodies[index].Orbit)) return false;
            }
            foreach (var index in descend)
            {
                if (!IsBoundConic(bodies[index].Orbit)) return false;
            }
            return true;
        }

        /// <summary>
        /// Periapsis and apoapsis, which for a bound conic are exactly
        /// <c>sma * (1 -/+ ecc)</c>. Answered in closed form rather than by flying the
        /// orbit and taking extremes, because a sampled answer would put a resolution
        /// error into a number a report prints as a fact.
        /// </summary>
        public RadiusExtremes? RadiusExtremesOf(PropagationTarget target)
        {
            var elements = target.Kind == PropagationTargetKind.Body
                ? OrbitOfBody(target.BodyIndex)
                : target.Osculating;
            if (!IsBoundConic(elements))
            {
                return null;
            }

            var orbit = elements!.Value;
            return new RadiusExtremes(
                orbit.Sma * (1.0 - orbit.Ecc),
                orbit.Sma * (1.0 + orbit.Ecc));
        }

        private OrbitElements? OrbitOfBody(int bodyIndex)
        {
            var bodies = _bodies == null ? null : _bodies();
            if (bodies == null || bodyIndex < 0 || bodyIndex >= bodies.Count)
            {
                return null;
            }
            return bodies[bodyIndex].Orbit;
        }

        private static bool IsBoundConic(OrbitElements? elements)
        {
            if (elements == null)
            {
                return false;
            }

            var orbit = elements.Value;
            return orbit.Ecc >= 0.0
                && orbit.Ecc < 1.0
                && orbit.Sma > 0.0
                && orbit.Mu > 0.0;
        }

        /// <summary>
        /// One conic, solved. PRIVATE, and that is the whole of what makes "orbits are
        /// conics is assumed in exactly one place" literally true rather than nearly true.
        ///
        /// <para>While it was public it was a door beside the seam: a caller could take a
        /// position straight out of the two-body solver without a target, a frame or an
        /// election being involved, and sixteen tests across six files did. The class
        /// holding the arithmetic is not the same thing as the arithmetic being reachable
        /// only one way.</para>
        ///
        /// <para>The <see cref="ArgumentOutOfRangeException"/> below is now an internal
        /// invariant rather than a contract: every path in reaches this through
        /// <see cref="CanPropagate"/>, which declines an unbound orbit first.</para>
        /// </summary>
        private StateVector Solve(OrbitElements orbit, double ut)
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

            // If the loop above never satisfies the tolerance (e.g. some
            // future caller passes ecc arbitrarily close to the ecc<1
            // boundary, where convergence slows sharply), this simply
            // returns the last iterate rather than throwing or flagging
            // non-convergence. Fine today -- callers only ever pass
            // well-behaved elliptical elements -- but a guard point to
            // revisit if this solver is ever exposed to untrusted/arbitrary
            // input.
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
