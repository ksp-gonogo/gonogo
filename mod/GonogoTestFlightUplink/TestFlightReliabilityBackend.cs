// mod/GonogoTestFlightUplink/TestFlightReliabilityBackend.cs
// TestFlight's implementation of the shared reliability Kernel capability
// (IReliabilityBackend, declared in Sitrep.Contract/Reliability.cs). Parameterless
// + reads the active vessel internally, like the other capability backends.
// Registered at Priority 10 so it WINS the election over the Priority-1 Kerbalism
// provider under RO/RP-1.
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    public sealed class TestFlightReliabilityBackend : IReliabilityBackend
    {
        private readonly TestFlightReflection _tf;

        public TestFlightReliabilityBackend(TestFlightReflection tf) => _tf = tf;

        public string ProviderId => TestFlightReliabilityMap.ProviderId;

        /// <summary>
        /// A partially-bound binder stays <c>Modeled</c>: if part conditions are
        /// readable then reliability IS being modelled and reported, and missing
        /// rated-time reads only mean the budgets are absent. Absent is not the
        /// same as unreadable, and the difference is exactly which of the two is
        /// true. <c>Indeterminate</c> is reserved for the case where not even a
        /// part's condition can be read.
        /// </summary>
        public string Coverage
        {
            get
            {
                // Should not be reachable: the uplink does not register a provider
                // when the probe says TestFlight is absent.
                if (!_tf.IsAvailable) return ReliabilityCoverage.None;
                return _tf.BoundPartStatus
                    ? ReliabilityCoverage.Modeled
                    : ReliabilityCoverage.Indeterminate;
            }
        }

        public ReliabilitySummary Summary() => TestFlightReliabilityMap.Summary(Coverage);

        public IReadOnlyList<ReliabilityPartEntry> Parts()
        {
            var v = FlightGlobals.ActiveVessel;
            if (v == null) return new List<ReliabilityPartEntry>();
            return TestFlightReliabilityMap.Parts(_tf.Engines(v), _tf.Binding);
        }

        /// <summary>
        /// TestFlight models failures and their repair through its own in-game
        /// surfaces, and this Uplink does not reach that path. Refused, and
        /// named honestly: reporting "not modelled" would be false, since
        /// TestFlight plainly does model repair, and silently succeeding would
        /// be worse. The operator is told the console cannot drive it.
        /// </summary>
        public RepairOutcome Repair(string partId, string crewName) =>
            new RepairOutcome { Repaired = false, Refusal = "refused" };

    }
}
