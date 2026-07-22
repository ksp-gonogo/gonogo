using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Pure mappers from the reflected ReliabilityRaw to the source-agnostic
    /// reliability.* contract POCOs. Kerbalism fills the consumed-fraction fields
    /// (IgnitionsConsumed/DurationConsumed, 1.0 = spent) and leaves the
    /// TestFlight-only live-probability fields (ReliabilityFraction /
    /// RemainingRatedBurn / WorstReliabilityFraction) null. KSP-free (Sitrep.Contract
    /// only) so it is headless-testable.
    /// </summary>
    public static class KerbalismReliabilityMap
    {
        /// <param name="modeled">Features.Reliability — false under RO makes this an unmodeled fallback.</param>
        public static ReliabilitySummary Summary(ReliabilityRaw raw, bool modeled) => new()
        {
            Unmodeled = !modeled,
            Malfunction = modeled && raw.Malfunction,
            Critical = modeled && raw.Critical,
            Source = "kerbalism",
            WorstReliabilityFraction = null,   // Kerbalism has no live probability; TestFlight-only
        };

        public static List<ReliabilityPartEntry> Parts(ReliabilityRaw raw, bool modeled)
        {
            var list = new List<ReliabilityPartEntry>();
            if (!modeled) return list;   // unmodeled -> no per-part data
            foreach (var p in raw.Parts)
                list.Add(new ReliabilityPartEntry
                {
                    PartId = p.PartId,
                    Title = p.Title,
                    Group = p.Group,
                    Broken = p.Broken,
                    Critical = p.Critical,
                    MtbfHours = p.Mtbf,
                    IgnitionsConsumed = p.IgnitionsConsumed,
                    DurationConsumed = p.DurationConsumed,
                    ReliabilityFraction = null,   // TestFlight-only
                    RemainingRatedBurn = null,    // TestFlight-only
                    NeedsRepair = p.NeedsRepair,
                });
            return list;
        }
    }
}
