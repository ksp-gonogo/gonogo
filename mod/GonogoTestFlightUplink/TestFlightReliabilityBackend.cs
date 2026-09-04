// mod/GonogoTestFlightUplink/TestFlightReliabilityBackend.cs
// TestFlight's implementation of the shared reliability Kernel capability
// (IReliabilityBackend, declared in Sitrep.Contract/Reliability.cs). Resolves the
// vessel internally, like the other capability backends.
// Registered at Priority 10 so it WINS the election over the Priority-1 Kerbalism
// provider under RO/RP-1.
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    public sealed class TestFlightReliabilityBackend : IReliabilityBackend
    {
        private readonly TestFlightReflection _tf;
        private readonly Kernel? _kernel;

        /// <param name="kernel">
        /// Core's capability registry, for the <c>activeVessel</c> resolution
        /// described on <see cref="ScopedVessel"/>. Optional, and null resolves
        /// no vessel: the listing comes back empty and the repair refuses, rather
        /// than either answering for a craft this backend could not confirm.
        /// </param>
        public TestFlightReliabilityBackend(TestFlightReflection tf, Kernel? kernel = null)
        {
            _tf = tf;
            _kernel = kernel;
        }

        public string ProviderId => TestFlightReliabilityMap.ProviderId;

        /// <summary>
        /// The craft this backend answers for, from core's <c>activeVessel</c>
        /// capability rather than from KSP.
        ///
        /// <para>The same regression <c>KerbalismReliabilityBackend</c> carried,
        /// line for line, and it lands on the RO/RP-1 installs where this
        /// provider outranks Kerbalism's. <c>vessel.parts</c> lists the CRAFT's
        /// parts, so a part id the operator can see resolves against a kerbal who
        /// has one and comes back unrepairable. Going outside to fix a failed
        /// engine is the whole reason the verb exists.</para>
        ///
        /// <para>Queried per call, as <see cref="IActiveVessel"/> requires: the
        /// answer changes on a vessel switch, a dock, an undock, and on both ends
        /// of an EVA.</para>
        /// </summary>
        private Vessel? ScopedVessel() => _kernel.ReportedVessel() as Vessel;

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
            var v = ScopedVessel();
            if (v == null) return new List<ReliabilityPartEntry>();
            return TestFlightReliabilityMap.Parts(_tf.Engines(v), _tf.Binding);
        }

        /// <summary>
        /// TestFlight's own repair, driven through
        /// <c>ITestFlightCore.ForceRepair</c>. This used to be a hardcoded
        /// <c>refused</c>, documented as deliberate on the grounds that TestFlight
        /// repairs through surfaces of its own. It does not: there is no repair
        /// button anywhere in the three TestFlight assemblies, only a public
        /// static <c>TestFlightInterface.ForceRepair</c> facade meant for exactly
        /// this, and nothing else in the install calls it.
        ///
        /// <para><paramref name="crewName"/> is unused because TestFlight's model
        /// has nothing to check it against, not because the check was skipped. See
        /// <see cref="TestFlightReflection.Repair"/>.</para>
        /// </summary>
        public RepairOutcome Repair(string partId, string crewName) =>
            _tf.Repair(ScopedVessel(), partId);

    }
}
