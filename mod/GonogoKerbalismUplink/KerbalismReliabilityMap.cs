using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Pure mappers from the reflected ReliabilityRaw to the source-agnostic
    /// reliability.* contract POCOs. KSP-free (Sitrep.Contract only) so it is
    /// headless-testable.
    ///
    /// <para>What Kerbalism can honestly fill, and nothing else. It has NO per-part
    /// probability: the only probabilities in the assembly are the save-wide
    /// difficulty settings criticalChance / safeModeChance, consulted once at the
    /// instant a break resolves. So Survival and its horizon are always null here,
    /// and the whole per-part contribution is a Condition plus at most one
    /// "service" budget. That is less than TestFlight publishes, and it is a
    /// truthful report of what Kerbalism exposes rather than a demotion.</para>
    ///
    /// <para>The summary additionally carries Kerbalism's OWN vessel-level rollup in
    /// its provider extension bag, under the provider id this backend registers with
    /// the Kernel. That sub-tree is this Uplink's shape, not core's: it is declared in
    /// GonogoKerbalismUplink.Contract/KerbalismReliabilityExt.cs, written here as a
    /// plain value tree (JsonWriter walks it, exactly as it does every other
    /// producer-flattened payload), and typed client-side by this Uplink's own
    /// readKerbalismReliabilityExt.</para>
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

        /// <summary>Kerbalism's own status vocabulary (FailuresManager.StatusString), kept verbatim.</summary>
        private const string Busted = "busted";
        private const string NeedsRepair = "needs repair";
        private const string NeedsService = "needs service";

        public static ReliabilitySummary Summary(
            ReliabilityRaw raw,
            ReliabilityPreferencesRaw prefs,
            string coverage) => new()
        {
            Source = ProviderId,
            Coverage = coverage,
            Extensions = SummaryExtensions(raw, prefs, coverage),
        };

        /// <summary>
        /// Kerbalism's namespace of the summary's extension bag, or null when there is
        /// nothing to say (not modelling, or no parts). Null rather than an empty bag on
        /// purpose: the wire omits the key entirely, so an unextended payload is
        /// byte-for-byte what it was before this mechanism existed.
        ///
        /// <para>Wire keys are camelCase, hand-written to match the generated
        /// TypeScript, the same producer-owns-the-flatten rule every hand-built value
        /// tree in the mod already follows.</para>
        /// </summary>
        private static Dictionary<string, object?>? SummaryExtensions(
            ReliabilityRaw raw,
            ReliabilityPreferencesRaw prefs,
            string coverage)
        {
            if (coverage != ReliabilityCoverage.Modeled || raw.Parts.Count == 0)
            {
                return null;
            }

            var worstMtbf = double.MaxValue;
            var broken = 0;
            var serviceDue = 0;
            foreach (var p in raw.Parts)
            {
                if (p.MtbfSeconds is > 0 && p.MtbfSeconds.Value < worstMtbf) worstMtbf = p.MtbfSeconds.Value;
                if (p.Broken) broken++;
                if (!p.Broken && p.NeedsService) serviceDue++;
            }

            return new Dictionary<string, object?>
            {
                [ProviderId] = new Dictionary<string, object?>
                {
                    // No positive MTBF anywhere means nothing on the vessel is
                    // modelled as failing over time; a sentinel MaxValue would read
                    // as a real number in a widget.
                    ["worstMtbfSeconds"] = worstMtbf == double.MaxValue ? null : (object?)worstMtbf,
                    ["brokenPartCount"] = broken,
                    ["serviceDuePartCount"] = serviceDue,
                    ["criticalChance"] = prefs.CriticalChance,
                    ["safeModeChance"] = prefs.SafeModeChance,
                    ["requireRepairKits"] = prefs.RequireRepairKits,
                    ["incentiveRedundancy"] = prefs.IncentiveRedundancy,
                },
            };
        }

        public static List<ReliabilityPartEntry> Parts(ReliabilityRaw raw, string coverage)
        {
            var list = new List<ReliabilityPartEntry>();
            if (coverage != ReliabilityCoverage.Modeled) return list;

            var seen = new Dictionary<string, int>();
            foreach (var p in raw.Parts)
            {
                // PartId is "<rawId>:<occurrence>" and is never a bare flightID.
                // ReliabilityInfo's proto constructor sets partId = 0 for every part
                // on an unloaded vessel, and BuildList iterates MODULES, so a part
                // carrying two Reliability modules (the install's own configs do
                // this, one redundancy block per subsystem) yields two entries with
                // the same id. Either collision would silently merge two rows.
                seen.TryGetValue(p.PartId, out var n);
                seen[p.PartId] = n + 1;

                list.Add(new ReliabilityPartEntry
                {
                    PartId = p.PartId + ":" + n,
                    Title = p.Title,
                    Condition = ConditionOf(p),
                    ConditionDetail = ConditionDetailOf(p),
                    // Kerbalism has no per-part probability at all. Filling these
                    // would be inventing data.
                    Survival = null,
                    SurvivalHorizonSeconds = null,
                    RepairTrait = string.IsNullOrEmpty(p.RepairTrait) ? null : p.RepairTrait,
                    RepairLevel = p.RepairLevel,
                    Budgets = ServiceBudget(p, raw.Ut),
                    Extensions = PartExtensions(p),
                });
            }
            return list;
        }

        /// <summary>
        /// The coverage decision as a PURE function of the two things it reads, so
        /// it can be tested without standing up reflection into a live Kerbalism.
        /// </summary>
        public static string ComputeCoverage(
            IReadOnlyDictionary<string, bool> features,
            ReliabilityPreferencesRaw prefs)
        {
            if (features.Count == 0) return ReliabilityCoverage.Indeterminate;
            if (!features.TryGetValue("Reliability", out var on)) return ReliabilityCoverage.Indeterminate;
            if (!on) return ReliabilityCoverage.Disabled;
            if (prefs.MtbfFailures == null) return ReliabilityCoverage.Indeterminate;
            if (prefs.MtbfFailures == false) return ReliabilityCoverage.Disabled;
            return ReliabilityCoverage.Modeled;
        }

        /// <summary>
        /// Whether Kerbalism should TAKE the exclusive "reliability" capability at
        /// all. Lives here rather than beside the backend because the backend reads
        /// <c>FlightGlobals</c> and so cannot be compiled into a test assembly,
        /// and a decision nothing can test is the kind that quietly stops being
        /// true.
        /// </summary>
        public static bool CanServe(
            IReadOnlyDictionary<string, bool> features,
            ReliabilityPreferencesRaw prefs) =>
            ComputeCoverage(features, prefs) != ReliabilityCoverage.Disabled;

        private static string ConditionOf(ReliabilityPartRaw p)
        {
            if (p.Broken) return p.Critical ? "failed-critical" : "failed";
            return p.NeedsService ? "service-due" : "nominal";
        }

        private static string? ConditionDetailOf(ReliabilityPartRaw p)
        {
            if (p.Broken) return p.Critical ? Busted : NeedsRepair;
            return p.NeedsService ? NeedsService : null;
        }

        /// <summary>
        /// The one dimension Kerbalism counts: time since the last clean inspection,
        /// against half an effective MTBF (Kerbalism's own <c>maintenance_after =
        /// last_inspection + mtbf * 0.5</c>). <c>ReliabilityInfo.mtbf</c> is already
        /// <c>EffectiveMTBF(quality, mtbf)</c>, so the quality multiplier is in it.
        ///
        /// <para>Omitted entirely when either input is missing, and a
        /// <c>service-due</c> row then renders with no number, which is correct:
        /// <c>NeedsMaintenance()</c> has TWO independent sources (an explicit wear
        /// flag an EVA inspection sets, and this time-based clock) and they are
        /// unrelated. A part inspected today and found 40% worn is service-due NOW
        /// with its maintenance clock far in the future.</para>
        /// </summary>
        private static List<ReliabilityBudget>? ServiceBudget(ReliabilityPartRaw p, double ut)
        {
            if (p.MtbfSeconds is not > 0 || p.LastInspection is not > 0) return null;

            var limit = p.MtbfSeconds.Value * 0.5;
            var used = ut - p.LastInspection.Value;
            if (used < 0) used = 0;

            return new List<ReliabilityBudget>
            {
                new()
                {
                    Id = "service",
                    Label = "service",
                    Kind = "schedule",
                    Consumed = used / limit,
                    UsedSeconds = used,
                    LimitSeconds = limit,
                },
            };
        }

        /// <summary>
        /// Kerbalism's per-part namespace: the two nameplate facts the shared shape
        /// deliberately no longer carries. <c>redundancyGroup</c> is
        /// <c>ReliabilityInfo.group</c>, which is a redundancy-SET name
        /// (<c>module.redundancy</c>, "these parts are each other's spares"), not a
        /// category, and a roll-up over it inverts its meaning. <c>mtbfSeconds</c> is
        /// the nameplate constant that used to ride a field named MtbfHours.
        /// </summary>
        private static Dictionary<string, object?>? PartExtensions(ReliabilityPartRaw p)
        {
            var hasGroup = !string.IsNullOrEmpty(p.Group);
            if (!hasGroup && p.MtbfSeconds == null && p.Quality == null) return null;

            return new Dictionary<string, object?>
            {
                [ProviderId] = new Dictionary<string, object?>
                {
                    ["redundancyGroup"] = hasGroup ? p.Group : null,
                    ["mtbfSeconds"] = p.MtbfSeconds,
                    ["quality"] = p.Quality,
                },
            };
        }
    }
}
