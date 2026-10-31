using System;
using System.Collections.Generic;
using Sitrep.Host.CommandCentres;
using Sitrep.Contract;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// The active craft as a seat: the place a session that follows the active craft
    /// stands, whether the craft is crewed or not, has an antenna or not, and is a
    /// command centre or not. Keyed <c>vessel:&lt;guid&gt;</c>, the id
    /// <see cref="CrewedVesselSource"/> gives the same craft when it is a centre, so the
    /// two never both hold a craft.
    ///
    /// <para>The craft is the one gonogo reports as active, which is what every
    /// <c>vessel.*</c> Topic describes and what the delay ledger is written for: during
    /// an EVA that is the craft the kerbal left, not the kerbal.</para>
    ///
    /// <para>Registered as a seat source, never as a centre source: a seat reads its own
    /// craft at no delay and is timed to everything else only over a route, but it is not
    /// in the roster, is never home and is not offered by the vantage picker. The kind is
    /// <see cref="CommandCentreKind.CrewedVessel"/> because that is the kind the delay
    /// matrix reads as a craft standing on itself.</para>
    /// </summary>
    public sealed class ActiveCraftSeatSource : ICommandCentreSource
    {
        private readonly Func<Vessel?> _activeVessel;

        public ActiveCraftSeatSource(Func<Vessel?> activeVessel) => _activeVessel = activeVessel;

        public ActiveCraftSeatSource()
            : this(() => ActiveVesselScope.Current)
        {
        }

        public string ProviderId => "active-craft-seat";

        public IEnumerable<ICommandCentre> Enumerate()
        {
            var vessel = _activeVessel();
            if (vessel == null)
            {
                yield break;
            }

            var comm = vessel.connection?.Comm;
            var bodyIndex = FlightGlobals.Bodies.IndexOf(vessel.mainBody);
            yield return new KspCommandCentre(
                "vessel:" + vessel.id,
                GameWords.VesselName(vessel),
                CommandCentreKind.CrewedVessel,
                bodyIndex >= 0 ? bodyIndex : (int?)null,
                comm,
                comm != null ? comm.precisePosition : vessel.GetWorldPos3D(),
                active: true);
        }
    }
}
