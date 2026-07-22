// mod/GonogoTestFlightUplink/TestFlightReliabilityMap.cs
// Pure (KSP-free) mapper: per-engine reflection reads -> the shared reliability
// wire shape (ReliabilitySummary / ReliabilityPartEntry, defined in
// Sitrep.Contract by the shared reliability contract). Emits plain dictionaries so this file
// carries NO compile-time dependency on the shared POCOs and stays headlessly
// testable; the elected-provider wiring adapts these dicts to the contract.
using System.Collections.Generic;

namespace GonogoTestFlightUplink
{
    public static class TestFlightReliabilityMap
    {
        public static Dictionary<string, object?> Summary(
            bool anyMalfunction,
            bool anyCritical,
            double? worstReliabilityFraction) => new()
        {
            ["unmodeled"] = false,
            ["malfunction"] = anyMalfunction,
            ["critical"] = anyCritical,
            // TestFlight's headline pre-burn go/no-go: the worst engine's live
            // reliability probability across the vessel (null when no engines).
            ["worstReliabilityFraction"] = worstReliabilityFraction,
            ["source"] = "testflight",
        };

        public static List<object> Parts(IEnumerable<EngineReliabilityRaw> engines)
        {
            var list = new List<object>();
            foreach (var e in engines)
                list.Add(new Dictionary<string, object?>
                {
                    ["partId"] = e.PartId,
                    ["title"] = e.Title,
                    ["group"] = "engine",
                    ["broken"] = e.CurrentReliability <= 0.01,
                    ["critical"] = e.MomentaryFailureRate > 0,
                    // TestFlight's headline signals: the live reliability probability (0..1)
                    // and the remaining rated burn seconds. mtbfHours keeps the inverse-
                    // failure-rate estimate too; ignitions/duration consumed stay null
                    // (fallback-provider concepts, not applicable to TestFlight). The FleetRoster
                    // renderer shows whichever fields are non-null.
                    ["reliabilityFraction"] = e.CurrentReliability,
                    ["remainingRatedBurn"] = e.RemainingRatedBurnSeconds,
                    ["mtbfHours"] = e.MomentaryFailureRate > 0 ? (double?)(1.0 / e.MomentaryFailureRate / 3600.0) : null,
                    ["ignitionsConsumed"] = null,
                    ["durationConsumed"] = null,
                    ["needsRepair"] = e.CurrentReliability < 1.0,
                });
            return list;
        }
    }
}
