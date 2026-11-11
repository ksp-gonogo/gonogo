using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Lists every craft with a kerbal aboard, pilot or not, as a listener: a place a
    /// message can be addressed to and nothing else. It needs no control source and no
    /// antenna to be listed, and it is never a command centre, so command rights, the
    /// vantage picker and every centre's delay rows are exactly as without it.
    ///
    /// <para>An EVA kerbal is not a craft and is left out, and so is a craft with
    /// nobody aboard.</para>
    /// </summary>
    public sealed class CrewedCraftListenerSource : ICommandCentreSource
    {
        private readonly Func<IEnumerable<Vessel>> _vessels;

        public CrewedCraftListenerSource(Func<IEnumerable<Vessel>> vessels) => _vessels = vessels;

        public CrewedCraftListenerSource()
            : this(() => FlightGlobals.Vessels)
        {
        }

        public string ProviderId => "crewed-craft-listener";

        public IEnumerable<ICommandCentre> Enumerate()
        {
            foreach (var vessel in _vessels())
            {
                if (vessel == null || vessel.isEVA || vessel.GetCrewCount() <= 0)
                {
                    continue;
                }

                var comm = vessel.connection?.Comm;
                yield return new KspCommandCentre(
                    "vessel:" + vessel.id,
                    GameWords.VesselName(vessel),
                    CommandCentreKind.CrewedVessel,
                    BodyIndexOf(vessel.mainBody),
                    comm,
                    comm != null ? comm.precisePosition : vessel.GetWorldPos3D(),
                    active: false);
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
