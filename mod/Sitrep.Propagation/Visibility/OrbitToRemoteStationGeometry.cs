using System;
using System.Collections.Generic;

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
        private readonly ChainLink[] _chain;
        private readonly RotatingGroundStation _station;
        private readonly double _stationBodyOccludingRadiusMeters;
        private readonly IPropagationProvider _propagator;

        /// <summary>
        /// One body between the station's body and the vessel's parent: its
        /// orbit about the body BELOW it in the chain, and how big it is to a
        /// radio wave.
        /// </summary>
        public readonly struct ChainLink
        {
            /// <param name="orbit">One body's elements about the body it orbits.</param>
            /// <param name="occludingRadiusMeters">
            /// The occluding radius of the body this link ARRIVES at, which is
            /// the one that then sits at the accumulated position.
            /// </param>
            /// <param name="descending">
            /// True when the link moves DOWN the hierarchy (a body about its
            /// parent, added), false when it moves UP (the same orbit, but
            /// subtracted, because the frame is on the far side of it).
            ///
            /// <para>Both directions are needed and neither is exotic. A craft
            /// at Minmus reaching a Kerbin station only descends; a craft in
            /// solar orbit reaching that same station has to climb from Kerbin
            /// out to the Sun first, and a walk that could only descend simply
            /// refused those vessels — which, in a real save, is most of
            /// them.</para>
            /// </param>
            public ChainLink(OrbitElements orbit, double occludingRadiusMeters, bool descending)
            {
                Orbit = orbit;
                OccludingRadiusMeters = occludingRadiusMeters;
                Descending = descending;
            }

            public OrbitElements Orbit { get; }

            public double OccludingRadiusMeters { get; }

            public bool Descending { get; }
        }

        /// <param name="vesselOrbit">The vessel's elements, relative to its own parent body.</param>
        /// <param name="chain">
        /// The patched-conic chain from the STATION's body to the vessel's
        /// parent, in walk order: up from the station's body to the common
        /// ancestor (ascending links), then down to the vessel's parent
        /// (descending links). Empty when the vessel already orbits the
        /// station's body.
        /// </param>
        /// <param name="station">The station, on the frame-centre body.</param>
        /// <param name="stationBodyOccludingRadiusMeters">Occluding radius of the station's body, from the elected comms backend's occlusion model.</param>
        public OrbitToRemoteStationGeometry(
            OrbitElements vesselOrbit,
            IEnumerable<ChainLink> chain,
            RotatingGroundStation station,
            double stationBodyOccludingRadiusMeters,
            IPropagationProvider propagator = null)
        {
            RequireRadius(stationBodyOccludingRadiusMeters, nameof(stationBodyOccludingRadiusMeters));

            _chain = chain == null ? new ChainLink[0] : new List<ChainLink>(chain).ToArray();
            foreach (var link in _chain)
            {
                RequireRadius(link.OccludingRadiusMeters, nameof(chain));
            }

            _vesselOrbit = vesselOrbit;
            _station = station;
            _stationBodyOccludingRadiusMeters = stationBodyOccludingRadiusMeters;
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
            var chainPositions = new Vector3d[_chain.Length];
            var vessel = VesselAt(ut, chainPositions);
            var station = _station.PositionAt(ut);

            // The worst occluder wins. Every body in the chain can come between
            // the craft and the station, and so can the station's own body when
            // the station has rotated onto its far side; taking only the
            // vessel's immediate parent would predict an emergence that one of
            // the others then blocks anyway.
            var margin = ChordOcclusion.HorizonMargin(
                vessel, station, Origin, _stationBodyOccludingRadiusMeters);

            for (var i = 0; i < _chain.Length; i++)
            {
                var linkMargin = ChordOcclusion.HorizonMargin(
                    vessel, station, chainPositions[i], _chain[i].OccludingRadiusMeters);
                if (linkMargin < margin)
                {
                    margin = linkMargin;
                }
            }

            return margin;
        }

        public double SeparationAt(double ut)
        {
            var vessel = VesselAt(ut, new Vector3d[_chain.Length]);
            return (vessel - _station.PositionAt(ut)).Magnitude();
        }

        /// <summary>
        /// The vessel's position in the station body's frame, by summing the
        /// chain outward. Fills <paramref name="chainPositions"/> with each
        /// intermediate body's position in the same frame, which the occlusion
        /// pass then needs.
        ///
        /// <para>Summing rather than using one element set is the whole point:
        /// a craft at Minmus described by its Minmus-relative elements alone
        /// sits 46,400 km from where it actually is.</para>
        /// </summary>
        private Vector3d VesselAt(double ut, Vector3d[] chainPositions)
        {
            var accumulated = Origin;
            for (var i = 0; i < _chain.Length; i++)
            {
                var step = _propagator.Solve(_chain[i].Orbit, ut).Position;
                accumulated = _chain[i].Descending ? accumulated + step : accumulated - step;
                chainPositions[i] = accumulated;
            }
            return accumulated + _propagator.Solve(_vesselOrbit, ut).Position;
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
