// mod/GonogoTestFlightUplink/TestFlightReliabilityBackend.cs
// TestFlight's implementation of the shared reliability Kernel capability
// (IReliabilityBackend, owned by the shared reliability core registrar in
// Sitrep.Contract/Reliability.cs). Parameterless + reads the active vessel
// internally, like the other capability backends. Registered at Priority 10 so it WINS
// the election over the Priority-1 unmodeled fallback provider under RO/RP-1.
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    public sealed class TestFlightReliabilityBackend : IReliabilityBackend
    {
        private readonly TestFlightReflection _tf;

        public TestFlightReliabilityBackend(TestFlightReflection tf) => _tf = tf;

        public string BackendId => "testflight";

        // TestFlight always MODELS reliability when its assembly is present.
        public bool IsModeled => _tf.IsAvailable;

        public ReliabilitySummary Summary()
        {
            var v = FlightGlobals.ActiveVessel;
            return new ReliabilitySummary
            {
                Unmodeled = false,
                Malfunction = v != null && _tf.AnyMalfunction(v),
                Critical = v != null && _tf.AnyCritical(v),
                Source = "testflight",
            };
        }

        public IReadOnlyList<ReliabilityPartEntry> Parts()
        {
            var v = FlightGlobals.ActiveVessel;
            var list = new List<ReliabilityPartEntry>();
            if (v == null) return list;
            foreach (var e in _tf.Engines(v))
            {
                list.Add(new ReliabilityPartEntry
                {
                    PartId = e.PartId,
                    Title = e.Title,
                    Group = "engine",
                    Broken = e.CurrentReliability <= 0.01,
                    Critical = e.MomentaryFailureRate > 0,
                    // TestFlight expresses health as a live reliability probability, not
                    // consumed fractions. MtbfHours carries the inverse-failure-rate estimate;
                    // the ignition/duration consumed slots stay null (fallback-provider concepts, not applicable to TestFlight).
                    MtbfHours = e.MomentaryFailureRate > 0 ? (double?)(1.0 / e.MomentaryFailureRate / 3600.0) : null,
                    IgnitionsConsumed = null,
                    DurationConsumed = null,
                    NeedsRepair = e.CurrentReliability < 1.0,
                });
            }
            return list;
        }
    }
}
