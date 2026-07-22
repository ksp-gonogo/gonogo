// mod/GonogoTestFlightUplink/TestFlightReliabilityMap.cs
// Pure (KSP-free) mapper: per-engine reflection reads -> the shared reliability
// wire shape (ReliabilitySummary / ReliabilityPartEntry, defined in
// Sitrep.Contract by the Kerbalism spec). Emits plain dictionaries so this file
// carries NO compile-time dependency on the shared POCOs and stays headlessly
// testable; the elected-provider wiring adapts these dicts to the contract.
using System.Collections.Generic;

namespace GonogoTestFlightUplink
{
    public static class TestFlightReliabilityMap
    {
        public static Dictionary<string, object?> Summary(bool anyMalfunction, bool anyCritical) => new()
        {
            ["unmodeled"] = false,
            ["malfunction"] = anyMalfunction,
            ["critical"] = anyCritical,
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
                    // TestFlight expresses health as a live reliability probability, not consumed
                    // fractions. mtbfHours carries the inverse-failure-rate estimate; ignitions/
                    // duration consumed stay null (Kerbalism-only concepts). The FleetRoster
                    // renderer shows whichever fields are non-null.
                    ["mtbfHours"] = e.MomentaryFailureRate > 0 ? (double?)(1.0 / e.MomentaryFailureRate / 3600.0) : null,
                    ["ignitionsConsumed"] = null,
                    ["durationConsumed"] = null,
                    ["needsRepair"] = e.CurrentReliability < 1.0,
                });
            return list;
        }
    }
}
