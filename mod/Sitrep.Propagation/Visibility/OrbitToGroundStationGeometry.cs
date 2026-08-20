using System;
using Sitrep.Contract;

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
    public sealed class OrbitToGroundStationGeometry : IVisibilityGeometry, IVisibilityCadence
    {
        private readonly PropagationTarget _vessel;
        private readonly RotatingGroundStation _station;
        private readonly double _occludingRadiusMeters;
        private readonly IPropagationProvider _propagator;

        /// <summary>Both endpoints are already parent-relative, so the occluder never leaves the origin.</summary>
        private static readonly Vector3d BodyCentre = new Vector3d(0.0, 0.0, 0.0);

        /// <param name="vessel">
        /// The craft, asked for in its OWN parent frame, which is what "a station on
        /// the body it orbits" means. There is deliberately no frame parameter: any
        /// other frame would put the two endpoints in different places and the
        /// occluder somewhere other than the origin, which is a different geometry.
        /// </param>
        public OrbitToGroundStationGeometry(
            PropagationTarget vessel,
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

            _vessel = vessel;
            _station = station;
            _occludingRadiusMeters = occludingRadiusMeters;
            _propagator = propagator ?? new KeplerProvider();
        }

        /// <summary>
        /// The orbital period, seconds, as the elected propagation provider reports
        /// it, or null when it declines. One of the two terms a sweep step has to
        /// resolve; see <see cref="ShortestCycleSeconds"/> for the other.
        /// </summary>
        public double? PeriodSeconds
        {
            get { return _propagator.CharacteristicCycleSeconds(_vessel); }
        }

        /// <summary>
        /// The faster of the orbit and the station's spin, seconds. A craft
        /// above synchronous altitude is overtaken by the station beneath it,
        /// so the day is what the path opens and closes with.
        /// </summary>
        public double? ShortestCycleSeconds
        {
            get
            {
                var spin = Math.Abs(_station.RotationPeriodSeconds);
                var usableSpin = spin > 0.0 && !double.IsInfinity(spin);
                var period = PeriodSeconds;

                if (!usableSpin)
                {
                    return period;
                }
                if (period == null)
                {
                    return spin;
                }
                return spin < period.Value ? spin : period.Value;
            }
        }

        /// <summary>The occluding radius this geometry was built with, metres. Echoed so a report can name the assumption it used.</summary>
        public double OccludingRadiusMeters
        {
            get { return _occludingRadiusMeters; }
        }

        public double MarginAt(double ut)
        {
            Vector3d vessel = _propagator.Solve(_vessel, ut).Position;
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
            Vector3d vessel = _propagator.Solve(_vessel, ut).Position;
            Vector3d station = _station.PositionAt(ut);
            return ChordOcclusion.Clearance(vessel, station, BodyCentre, _occludingRadiusMeters);
        }

        public double SeparationAt(double ut)
        {
            Vector3d vessel = _propagator.Solve(_vessel, ut).Position;
            Vector3d station = _station.PositionAt(ut);
            return (vessel - station).Magnitude();
        }
    }
}
