using System;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// The direct link between a vessel in orbit and a ground station on the body
    /// it orbits, with that same body as the only occluder.
    ///
    /// <para>This is the case the whole occluding-radius question turns on, and it
    /// is the one case where the geometry closes without any ephemeris at all:
    /// both endpoints are already expressed relative to the body's centre, so the
    /// occluder sits at the origin and stays there. A link to a station on a
    /// DIFFERENT body needs that body's position over time and is not what this
    /// type models; it would be a second <see cref="IVisibilityGeometry"/>.</para>
    ///
    /// <para><b>The occluding radius is an input, never derived from the body.</b>
    /// It is exactly the quantity under dispute: stock CommNet shrinks a body
    /// before testing (0.9 airless, 0.75 with atmosphere) and RealAntennas does
    /// not, and for Kerbin those are a 450 km and a 600 km occluder. Taking it as
    /// a parameter is what lets one capture be scored against both candidates
    /// side by side instead of one being assumed.</para>
    /// </summary>
    public sealed class OrbitToGroundStationGeometry : IVisibilityGeometry
    {
        private readonly OrbitElements _orbit;
        private readonly RotatingGroundStation _station;
        private readonly double _occludingRadiusMeters;
        private readonly IPropagationProvider _propagator;

        /// <summary>Both endpoints are already parent-relative, so the occluder never leaves the origin.</summary>
        private static readonly Vector3d BodyCentre = new Vector3d(0.0, 0.0, 0.0);

        public OrbitToGroundStationGeometry(
            OrbitElements orbit,
            RotatingGroundStation station,
            double occludingRadiusMeters,
            IPropagationProvider? propagator = null)
        {
            if (double.IsNaN(occludingRadiusMeters) || double.IsInfinity(occludingRadiusMeters) || occludingRadiusMeters < 0.0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(occludingRadiusMeters),
                    "The occluding radius must be finite and non-negative; got " + occludingRadiusMeters);
            }

            _orbit = orbit;
            _station = station;
            _occludingRadiusMeters = occludingRadiusMeters;
            _propagator = propagator ?? new KeplerProvider();
        }

        /// <summary>The orbital period, seconds, implied by the elements. The natural scale for a sweep step and for a sweep window.</summary>
        public double PeriodSeconds
        {
            get { return 2.0 * Math.PI * Math.Sqrt(_orbit.Sma * _orbit.Sma * _orbit.Sma / _orbit.Mu); }
        }

        /// <summary>The occluding radius this geometry was built with, metres. Echoed so a report can name the assumption it used.</summary>
        public double OccludingRadiusMeters
        {
            get { return _occludingRadiusMeters; }
        }

        public double MarginAt(double ut)
        {
            Vector3d vessel = _propagator.Solve(_orbit, ut).Position;
            Vector3d station = _station.PositionAt(ut);
            return ChordOcclusion.HorizonMargin(vessel, station, BodyCentre, _occludingRadiusMeters);
        }

        /// <summary>
        /// How far the path passes clear of the occluder at <paramref name="ut"/>,
        /// in metres. Not what the sweep searches on (see
        /// <see cref="ChordOcclusion.HorizonMargin"/> for why), but the form worth
        /// putting in a report next to a radius.
        /// </summary>
        public double ChordClearanceMetersAt(double ut)
        {
            Vector3d vessel = _propagator.Solve(_orbit, ut).Position;
            Vector3d station = _station.PositionAt(ut);
            return ChordOcclusion.Clearance(vessel, station, BodyCentre, _occludingRadiusMeters);
        }

        public double SeparationAt(double ut)
        {
            Vector3d vessel = _propagator.Solve(_orbit, ut).Position;
            Vector3d station = _station.PositionAt(ut);
            return (vessel - station).Magnitude();
        }
    }
}
