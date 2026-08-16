using System;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// A vessel orbiting one body, talking to a ground station on ANOTHER: a
    /// craft at Minmus routed to a station on Kerbin, which is the shape most
    /// real deep-ish-space silences take.
    /// <see cref="OrbitToGroundStationGeometry"/> covers the same-body case and
    /// assumes one occluder at the origin, which is wrong here in two ways at
    /// once — the vessel's parent has moved off the origin, and the station's
    /// own body is now an occluder too.
    ///
    /// <para><b>Frame: centred on the STATION's body</b>, Z-up inertial, the
    /// same convention <see cref="KeplerProvider"/> emits. The station is then
    /// a rotating point near the origin, and the vessel is the sum of its
    /// parent's orbit and its own — the patched-conic chain walked properly,
    /// rather than one element set pretending to describe both. Getting this
    /// wrong is worth hundreds of kilometres within minutes.</para>
    ///
    /// <para><b>Two occluders, and the margin is the worse of them.</b> The
    /// vessel can be hidden behind its own parent (the far side of Minmus) or
    /// behind the station's body (the station has rotated onto the far side of
    /// Kerbin). Both are real losses of signal and they interleave, so the
    /// margin is the minimum of the two horizon margins. Taking only the
    /// parent would predict an emergence that the station's own body then
    /// blocks anyway.</para>
    ///
    /// <para>Set <paramref name="parentOrbit"/> to null for a vessel orbiting
    /// the station's body directly; the chain then has one link and the
    /// parent-body occluder collapses onto the station body, which the
    /// duplicate-occluder check below drops rather than double-counting.</para>
    /// </summary>
    public sealed class OrbitToRemoteStationGeometry : IVisibilityGeometry
    {
        private static readonly Vector3d Origin = new Vector3d(0.0, 0.0, 0.0);

        private readonly OrbitElements _vesselOrbit;
        private readonly OrbitElements? _parentOrbit;
        private readonly RotatingGroundStation _station;
        private readonly double _stationBodyOccludingRadiusMeters;
        private readonly double _parentBodyOccludingRadiusMeters;
        private readonly IPropagationProvider _propagator;

        /// <param name="vesselOrbit">The vessel's elements, relative to its own parent body.</param>
        /// <param name="parentOrbit">
        /// The vessel's parent body's elements, relative to the STATION's body.
        /// Null when the vessel already orbits the station's body.
        /// </param>
        /// <param name="station">The station, on the frame-centre body.</param>
        /// <param name="stationBodyOccludingRadiusMeters">Occluding radius of the station's body, from the elected comms backend's occlusion model.</param>
        /// <param name="parentBodyOccludingRadiusMeters">Occluding radius of the vessel's parent body. Ignored when <paramref name="parentOrbit"/> is null.</param>
        public OrbitToRemoteStationGeometry(
            OrbitElements vesselOrbit,
            OrbitElements? parentOrbit,
            RotatingGroundStation station,
            double stationBodyOccludingRadiusMeters,
            double parentBodyOccludingRadiusMeters,
            IPropagationProvider propagator = null)
        {
            RequireRadius(stationBodyOccludingRadiusMeters, nameof(stationBodyOccludingRadiusMeters));
            if (parentOrbit != null)
            {
                RequireRadius(parentBodyOccludingRadiusMeters, nameof(parentBodyOccludingRadiusMeters));
            }

            _vesselOrbit = vesselOrbit;
            _parentOrbit = parentOrbit;
            _station = station;
            _stationBodyOccludingRadiusMeters = stationBodyOccludingRadiusMeters;
            _parentBodyOccludingRadiusMeters = parentBodyOccludingRadiusMeters;
            _propagator = propagator ?? new KeplerProvider();
        }

        /// <summary>The VESSEL's orbital period, seconds: the scale a sweep step and window are chosen against, since it is the fast term.</summary>
        public double PeriodSeconds
        {
            get
            {
                return 2.0 * Math.PI * Math.Sqrt(
                    _vesselOrbit.Sma * _vesselOrbit.Sma * _vesselOrbit.Sma / _vesselOrbit.Mu);
            }
        }

        public double MarginAt(double ut)
        {
            Vector3d parent;
            var vessel = VesselAt(ut, out parent);
            var station = _station.PositionAt(ut);

            var margin = ChordOcclusion.HorizonMargin(
                vessel, station, Origin, _stationBodyOccludingRadiusMeters);

            if (_parentOrbit != null)
            {
                var parentMargin = ChordOcclusion.HorizonMargin(
                    vessel, station, parent, _parentBodyOccludingRadiusMeters);
                if (parentMargin < margin)
                {
                    margin = parentMargin;
                }
            }

            return margin;
        }

        public double SeparationAt(double ut)
        {
            Vector3d parent;
            var vessel = VesselAt(ut, out parent);
            return (vessel - _station.PositionAt(ut)).Magnitude();
        }

        private Vector3d VesselAt(double ut, out Vector3d parentPosition)
        {
            if (_parentOrbit == null)
            {
                parentPosition = Origin;
                return _propagator.Solve(_vesselOrbit, ut).Position;
            }

            parentPosition = _propagator.Solve(_parentOrbit.Value, ut).Position;
            return parentPosition + _propagator.Solve(_vesselOrbit, ut).Position;
        }

        private static void RequireRadius(double radiusMeters, string name)
        {
            if (double.IsNaN(radiusMeters) || double.IsInfinity(radiusMeters) || radiusMeters < 0.0)
            {
                throw new ArgumentOutOfRangeException(
                    name,
                    "An occluding radius must be finite and non-negative; got " + radiusMeters);
            }
        }
    }
}
