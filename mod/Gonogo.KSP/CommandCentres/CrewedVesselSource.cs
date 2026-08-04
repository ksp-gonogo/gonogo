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

                yield return new KspCommandCentre(
                    "vessel:" + vessel.id,
                    string.IsNullOrEmpty(vessel.vesselName) ? "Vessel" : vessel.vesselName,
                    CommandCentreKind.CrewedVessel,
                    BodyIndexOf(vessel.mainBody),
                    comm,
                    comm.precisePosition,
                    active: comm.isControlSource);
            }
        }

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
