using System;
using System.Collections.Generic;
using Sitrep.Host.CommandCentres;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Enumerates crewed control-source vessels as command centres: the stock
    /// Probe Control Point mechanic (a crewed part making the vessel a local
    /// control source when qualifying crew reaches its minimum). Dynamic: a vessel
    /// becomes and stops being a centre at runtime, so it is re-enumerated each
    /// pass. Keyed <c>vessel:&lt;guid&gt;</c> so the authority matrix can self-exclude
    /// a crewed centre from its own subject row. The enumerator is injectable for
    /// testability (run at the full-sln fold; this worktree has no KSP refs).
    /// </summary>
    public sealed class CrewedVesselSource : ICommandCentreSource
    {
        private readonly Func<IEnumerable<Vessel>> _vessels;

        public CrewedVesselSource(Func<IEnumerable<Vessel>> vessels) => _vessels = vessels;

        public CrewedVesselSource()
            : this(() => FlightGlobals.Vessels)
        {
        }

        public string SourceId => "crewed-vessel";

        public IEnumerable<ICommandCentre> Enumerate()
        {
            foreach (var vessel in _vessels())
            {
                if (vessel == null)
                {
                    continue;
                }

                var comm = vessel.connection?.Comm;
                if (comm == null || !comm.isControlSource)
                {
                    continue;
                }

                // Coordinates only while the craft is actually ON its body. Off the
                // ground, converting precisePosition gives the sub-vessel ground
                // point, which sweeps at orbital rate and is not a place the centre
                // occupies; between spheres of influence it is a projection onto
                // whatever mainBody happens to be. The contract already says null
                // for a moving vessel centre, so this is where that gets honoured.
                double? latitude = null;
                double? longitude = null;
                if (IsOnSurface(vessel)
                    && SurfaceCoordinates.TryFrom(vessel.mainBody, comm.precisePosition, out var lat, out var lon))
                {
                    latitude = lat;
                    longitude = lon;
                }

                yield return new KspCommandCentre(
                    "vessel:" + vessel.id,
                    string.IsNullOrEmpty(vessel.vesselName) ? "Vessel" : vessel.vesselName,
                    CommandCentreKind.CrewedVessel,
                    BodyIndexOf(vessel.mainBody),
                    comm,
                    comm.precisePosition,
                    active: comm.isControlSource,
                    latitude: latitude,
                    longitude: longitude);
            }
        }

        /// <summary>
        /// Whether the craft is resting on its body, which is the only state where a
        /// crewed centre has a surface position rather than a groundtrack point.
        /// PRELAUNCH counts: a craft on the pad is as anchored as the pad is.
        /// </summary>
        private static bool IsOnSurface(Vessel vessel) =>
            vessel.situation == Vessel.Situations.LANDED
            || vessel.situation == Vessel.Situations.SPLASHED
            || vessel.situation == Vessel.Situations.PRELAUNCH;

        private static int? BodyIndexOf(CelestialBody body)
        {
            if (body == null)
            {
                return null;
            }

            var index = FlightGlobals.Bodies.IndexOf(body);
            return index >= 0 ? index : (int?)null;
        }
    }
}
