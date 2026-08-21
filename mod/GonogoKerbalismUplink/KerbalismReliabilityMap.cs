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
    ///
    /// <para>The summary additionally carries Kerbalism's OWN vessel-level rollup in
    /// its provider extension bag, under the provider id this backend registers with
    /// the Kernel. That sub-tree is this Uplink's shape, not core's: it is declared in
    /// GonogoKerbalismUplink.Contract/KerbalismReliabilityExt.cs, written here as a
    /// plain value tree (JsonWriter walks it, exactly as it does every other
    /// producer-flattened payload), and typed client-side by this Uplink's own
    /// readKerbalismReliabilityExt. Nothing about it is known to Sitrep.Contract, which
    /// is the point of the mechanism.</para>
    /// </summary>
    public static class KerbalismReliabilityMap
    {
        /// <summary>
        /// The provider id this backend registers with the Kernel, and therefore the
        /// key its extension namespace lives under. Matches
        /// <c>KerbalismReliabilityBackend.ProviderId</c> and the
        /// <c>ReliabilitySummary.Source</c> tag; the client's
        /// <c>registerProviderExtensionShape</c> call names the same string.
        /// </summary>
        public const string ProviderId = "kerbalism";

        /// <param name="modeled">Features.Reliability: false under RO makes this an unmodeled fallback.</param>
        public static ReliabilitySummary Summary(ReliabilityRaw raw, bool modeled) => new()
        {
            Unmodeled = !modeled,
            Malfunction = modeled && raw.Malfunction,
            Critical = modeled && raw.Critical,
            Source = ProviderId,
            WorstReliabilityFraction = null,   // Kerbalism has no live probability; TestFlight-only
            Extensions = SummaryExtensions(raw, modeled),
        };

        /// <summary>
        /// Kerbalism's namespace of the summary's extension bag, or null when there is
        /// nothing to say (unmodeled, or no parts). Null rather than an empty bag on
        /// purpose: the wire omits the key entirely, so an unextended payload is
        /// byte-for-byte what it was before this mechanism existed.
        ///
        /// <para>Wire keys are camelCase, hand-written to match the generated
        /// TypeScript, the same producer-owns-the-flatten rule every hand-built value
        /// tree in the mod already follows.</para>
        /// </summary>
        private static Dictionary<string, object?>? SummaryExtensions(ReliabilityRaw raw, bool modeled)
        {
            if (!modeled || raw.Parts.Count == 0)
            {
                return null;
            }

            var worstMtbf = double.MaxValue;
            var broken = 0;
            var maintenanceDue = 0;
            foreach (var p in raw.Parts)
            {
                if (p.Mtbf > 0 && p.Mtbf < worstMtbf) worstMtbf = p.Mtbf;
                if (p.Broken) broken++;
                if (p.NeedsRepair) maintenanceDue++;
            }

            return new Dictionary<string, object?>
            {
                [ProviderId] = new Dictionary<string, object?>
                {
                    // No positive MTBF anywhere means nothing on the vessel is
                    // modelled as failing over time; a sentinel MaxValue would read
                    // as a real number in a widget.
                    ["worstMtbfHours"] = worstMtbf == double.MaxValue ? null : (object?)worstMtbf,
                    ["brokenPartCount"] = broken,
                    ["maintenanceDueCount"] = maintenanceDue,
                },
            };
        }

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
