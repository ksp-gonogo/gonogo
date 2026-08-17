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
    /// once, the vessel's parent has moved off the origin, and the station's
    /// own body is now an occluder too.
    ///
    /// <para><b>Frame: centred on the STATION's body</b>, Z-up inertial, the
    /// same convention <see cref="KeplerProvider"/> emits. The station is then
    /// a rotating point near the origin, and the vessel is asked for in that
    /// frame directly rather than described by one element set pretending to
    /// cover both. Getting this wrong is worth hundreds of kilometres within
    /// minutes.</para>
    ///
    /// <para><b>Two occluders, and the margin is the worse of them.</b> The
    /// vessel can be hidden behind its own parent (the far side of Minmus) or
    /// behind the station's body (the station has rotated onto the far side of
    /// Kerbin). Both are real losses of signal and they interleave, so the
    /// margin is the minimum of the two horizon margins. Taking only the
    /// parent would predict an emergence that the station's own body then
    /// blocks anyway.</para>
    ///
    /// <para>Pass no occluders for a vessel orbiting the station's body
    /// directly; the station body is already the frame centre and is handled
    /// as an occluder in its own right, so nothing is double-counted.</para>
    /// </summary>
    public sealed class OrbitToRemoteStationGeometry : IVisibilityGeometry, IVisibilityCadence
    {
        private static readonly Vector3d Origin = new Vector3d(0.0, 0.0, 0.0);

        private readonly PropagationTarget _vessel;
        private readonly PropagationFrame _frame;
        private readonly OccludingBody[] _occluders;
        private readonly RotatingGroundStation[] _stations;
        private readonly double _stationBodyOccludingRadiusMeters;
        private readonly IPropagationProvider _propagator;

        /// <param name="vessel">The craft, named along with the body it orbits.</param>
        /// <param name="frame">Centred on the STATION's body. Reaching it from the vessel's parent is the provider's job, not this class's.</param>
        /// <param name="occluders">
        /// Every body that can come between the two endpoints, from
        /// <see cref="PatchedConicChain.OccludersBetween"/>. Empty when the vessel
        /// already orbits the station's body.
        /// </param>
        /// <param name="stationBodyOccludingRadiusMeters">Occluding radius of the station's body, from the elected comms backend's occlusion model.</param>
        /// <param name="stations">
        /// Every ground station on the frame-centre body, not one representative
        /// of them. The craft is in contact when ANY of them can see it, so a
        /// single station's horizon is not a constraint on the network.
        /// </param>
        public OrbitToRemoteStationGeometry(
            PropagationTarget vessel,
            PropagationFrame frame,
            IEnumerable<OccludingBody> occluders,
            IEnumerable<RotatingGroundStation> stations,
            double stationBodyOccludingRadiusMeters,
            IPropagationProvider propagator = null)
        {
            RequireRadius(stationBodyOccludingRadiusMeters, nameof(stationBodyOccludingRadiusMeters));

            _occluders = occluders == null ? new OccludingBody[0] : new List<OccludingBody>(occluders).ToArray();
            foreach (var occluder in _occluders)
            {
                RequireRadius(occluder.OccludingRadiusMeters, nameof(occluders));
            }

            _stations = stations == null
                ? new RotatingGroundStation[0]
                : new List<RotatingGroundStation>(stations).ToArray();
            if (_stations.Length == 0)
            {
                throw new ArgumentException(
                    "at least one ground station is required; an empty set would report the craft permanently unseen",
                    nameof(stations));
            }

            _vessel = vessel;
            _frame = frame;
            _stationBodyOccludingRadiusMeters = stationBodyOccludingRadiusMeters;
            _propagator = propagator ?? new KeplerProvider();
        }

        /// <summary>Single-station convenience, for callers with exactly one endpoint.</summary>
        public OrbitToRemoteStationGeometry(
            PropagationTarget vessel,
            PropagationFrame frame,
            IEnumerable<OccludingBody> occluders,
            RotatingGroundStation station,
            double stationBodyOccludingRadiusMeters,
            IPropagationProvider propagator = null)
            : this(vessel, frame, occluders, new[] { station }, stationBodyOccludingRadiusMeters, propagator)
        {
        }

        /// <summary>
        /// The VESSEL's orbital period, seconds, as the elected propagation
        /// provider reports it, or null when it declines. One of the two terms a
        /// sweep step has to resolve, and NOT reliably the faster of them: see
        /// <see cref="ShortestCycleSeconds"/>, which is what a caller sizing a
        /// step should ask for.
        /// </summary>
        public double? PeriodSeconds
        {
            get { return _propagator.CharacteristicCycleSeconds(_vessel); }
        }

        /// <summary>
        /// The faster of the vessel's orbit and the stations' spin, seconds.
        /// A station's day is the term that opens and closes the path for
        /// anything slower than it, which every interplanetary craft is.
        ///
        /// <para>The stations are taken at their fastest rather than averaged:
        /// they need not share a spin (nothing here says they sit on one body),
        /// and a step that resolves the fastest of them resolves all of them.
        /// A station with no usable spin rate is held fixed in the inertial
        /// frame by <see cref="RotatingGroundStation"/>, so it contributes no
        /// cycle rather than an infinitely fast one.</para>
        ///
        /// <para>The chain bodies are deliberately absent: a body's orbit about
        /// its parent runs to days or years where the body it is measured
        /// against spins in hours, so including them would only ever confirm
        /// the answer already found here.</para>
        /// </summary>
        public double? ShortestCycleSeconds
        {
            get
            {
                var shortest = PeriodSeconds;
                foreach (var station in _stations)
                {
                    var spin = Math.Abs(station.RotationPeriodSeconds);
                    if (!(spin > 0.0) || double.IsInfinity(spin))
                    {
                        continue;
                    }
                    if (shortest == null || spin < shortest.Value)
                    {
                        shortest = spin;
                    }
                }
                return shortest;
            }
        }

        public double MarginAt(double ut)
        {
            var occluderPositions = new Vector3d[_occluders.Length];
            var vessel = VesselAt(ut, occluderPositions);

            // The worst occluder wins. Every body in the chain can come between
            // the craft and the station, and so can the station's own body when
            // the station has rotated onto its far side; taking only the
            // vessel's immediate parent would predict an emergence that one of
            // the others then blocks anyway.
            // The BEST station wins: the craft is in contact if any one of them
            // has it above the horizon. Taking a single representative station
            // instead invents an outage lasting a large fraction of the body's
            // rotation, which a distributed ground network never has - measured
            // live as a 2104 s prediction against a 795 s truth.
            var margin = double.NegativeInfinity;
            foreach (var station in _stations)
            {
                var at = station.PositionAt(ut);
                var reach = ChordOcclusion.HorizonMargin(
                    vessel, at, Origin, _stationBodyOccludingRadiusMeters);

                // Bodies along the chain block regardless of which station is
                // looking, so they cut this station's own reach before it
                // competes with the others.
                for (var i = 0; i < _occluders.Length; i++)
                {
                    var occluderMargin = ChordOcclusion.HorizonMargin(
                        vessel, at, occluderPositions[i], _occluders[i].OccludingRadiusMeters);
                    if (occluderMargin < reach)
                    {
                        reach = occluderMargin;
                    }
                }

                if (reach > margin)
                {
                    margin = reach;
                }
            }

            return margin;
        }

        /// <summary>
        /// Distance from the vessel to the FIRST station, which callers doing a
        /// frame reconciliation must therefore pass as the one they measured
        /// against. Comparing against any other station reports the distance
        /// between two points on the same planet as frame error.
        /// </summary>
        public double SeparationAt(double ut)
        {
            var vessel = VesselAt(ut, new Vector3d[_occluders.Length]);
            return (vessel - _stations[0].PositionAt(ut)).Magnitude();
        }

        /// <summary>
        /// The vessel's position in the station body's frame, and each occluding
        /// body's position in the same frame, all asked of the provider.
        ///
        /// <para>Asking rather than summing is the whole point of the seam: a craft
        /// at Minmus described by its Minmus-relative elements alone sits 46,400 km
        /// from where it actually is, and which arithmetic closes that gap is a
        /// question about the physics rather than about the geometry.</para>
        /// </summary>
        private Vector3d VesselAt(double ut, Vector3d[] occluderPositions)
        {
            for (var i = 0; i < _occluders.Length; i++)
            {
                occluderPositions[i] = _propagator
                    .Solve(PropagationTarget.Body(_occluders[i].BodyIndex), _frame, ut).Position;
            }
            return _propagator.Solve(_vessel, _frame, ut).Position;
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
