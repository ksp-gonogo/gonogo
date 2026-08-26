using System;
using Sitrep.Contract;
using Sitrep.Host.Comms;

namespace Sitrep.Host.Flight
{
    /// <summary>
    /// Builds the <c>flight.simulation</c> payload from the elected simulation
    /// backend and the authored signal-delay config.
    ///
    /// <para><b>Why this channel is worth having.</b> Nothing else on the wire
    /// distinguishes a rehearsal from a mission. Every <c>flight.*</c> and
    /// <c>vessel.*</c> channel reports an RP-1 simulation exactly as it reports
    /// a real launch: altitude, stage, crew, fuel and the countdown are all
    /// true readings of a flight that is not happening. That is not a missing
    /// feature on a mission control board, it is a false statement about
    /// everything on it.</para>
    ///
    /// <para><b>Silent under a game with no such concept.</b> Stock KSP has no
    /// rehearsal mode, so it has nothing to say here and says nothing: the
    /// channel declares <c>absenceIsData</c> and a client reads the silence as
    /// "this game does not distinguish". Publishing <c>simulated: false</c>
    /// instead would let a client put a MISSION badge on a stock flight that
    /// was never in the running for one.</para>
    /// </summary>
    public static class FlightSimulationProvider
    {
        /// <summary>
        /// The payload, or null when this install has no concept of a
        /// simulation (and so nothing to report).
        /// </summary>
        public static FlightSimulation? Build(
            ISimulationBackend? backend,
            SignalDelayConfig? authored)
        {
            if (backend == null)
            {
                return null;
            }

            bool? simulated;
            try
            {
                simulated = backend.IsSimulatedFlight();
            }
            catch (Exception)
            {
                // A reflection walk into a mod nobody here has a copy of is not
                // something to let escape onto the channel loop. Read as "has
                // not said", same as the vanilla backend's own answer.
                return null;
            }

            if (simulated == null)
            {
                return null;
            }

            var effective = SimulationDelayPolicy.Effective(authored, backend);
            return new FlightSimulation
            {
                Simulated = simulated,
                // Read off the SAME derivation the reveal gate uses, not
                // re-deduced from the two flags: a readout that said delay was
                // applied while the gate was releasing live would be worse than
                // no readout.
                DelayApplied = effective.Enabled,
                DelayInSimulation = (authored ?? SignalDelayConfig.Off()).DelayInSimulation,
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };
        }
    }
}
