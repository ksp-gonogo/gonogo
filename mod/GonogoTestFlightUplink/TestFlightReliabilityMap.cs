// mod/GonogoTestFlightUplink/TestFlightReliabilityMap.cs
// Pure (KSP-free) mapper: per-engine reflection reads -> the shared reliability
// wire shape (ReliabilitySummary / ReliabilityPartEntry, defined in
// Sitrep.Contract). It builds the contract POCOs directly and the backend calls
// it, rather than each writing its own copy of the mapping: the two copies that
// used to exist were a corroborating pair, both green while the reflection layer
// underneath them returned nothing.
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    public static class TestFlightReliabilityMap
    {
        /// <summary>The provider id this backend registers with the Kernel, and the key its extension namespace lives under.</summary>
        public const string ProviderId = "testflight";

        public static ReliabilitySummary Summary(string coverage) => new()
        {
            Source = ProviderId,
            Coverage = coverage,
        };

        public static List<ReliabilityPartEntry> Parts(
            IEnumerable<EngineReliabilityRaw> engines,
            TestFlightBindingReport? binding = null)
        {
            var list = new List<ReliabilityPartEntry>();
            var seen = new Dictionary<string, int>();
            foreach (var e in engines)
            {
                // "<flightID>:<occurrence>". A part can carry more than one active
                // core, and a bare flightID would silently merge the rows.
                seen.TryGetValue(e.PartId, out var n);
                seen[e.PartId] = n + 1;

                list.Add(new ReliabilityPartEntry
                {
                    PartId = e.PartId + ":" + n,
                    Title = e.Title,
                    Condition = ConditionOf(e),
                    ConditionDetail = Clamp(e.FailureTitles, 120),
                    Survival = e.Survival,
                    SurvivalHorizonSeconds = e.Survival == null ? null : e.SurvivalHorizonSeconds,
                    Budgets = BurnBudgets(e),
                    Extensions = PartExtensions(e, binding),
                });
            }
            return list;
        }

        /// <summary>
        /// TestFlight's own part status is the condition, and there is no
        /// two-tier failure grade to read: <c>CanAttemptRepair()</c> is a
        /// contingent runtime predicate about the crew and the situation, not a
        /// severity, so nothing here ever emits "failed-critical".
        ///
        /// <para>An unread status is "unknown", never "nominal". That substitution
        /// is what the old layer made, on every part, on every install.</para>
        /// </summary>
        private static string ConditionOf(EngineReliabilityRaw e)
        {
            if (e.PartStatus == null) return "unknown";
            return e.PartStatus.Value != 0 ? "failed" : "nominal";
        }

        /// <summary>
        /// The two rated-burn budgets. They are INDEPENDENT ratings, not two views
        /// of one: under RO a BNTR rates 36000 s cumulative against 3600 s
        /// continuous, so a single "remaining rated burn" slot has to pick one and
        /// be wrong about the other. Each names its scope in the label so the
        /// number on screen cannot be read as the other one.
        ///
        /// <para>When the two rated limits are EQUAL only the cumulative one is
        /// emitted, labelled plainly "rated burn": that mirrors TestFlight's own
        /// GUI collapsing to a single field, and avoids two identical rows.</para>
        ///
        /// <para>A null run time is never substituted with 0: zero used reads as a
        /// brand-new part. The budget is still carried (the rating is real
        /// information) but with no Consumed, so it can never select a row.</para>
        /// </summary>
        private static List<ReliabilityBudget>? BurnBudgets(EngineReliabilityRaw e)
        {
            var budgets = new List<ReliabilityBudget>();
            var collapsed = e.RatedCumulativeSeconds is > 0
                && e.RatedContinuousSeconds is > 0
                && e.RatedCumulativeSeconds.Value == e.RatedContinuousSeconds.Value;

            if (!collapsed && e.RatedContinuousSeconds is > 0)
            {
                budgets.Add(Burn("burn.continuous", "continuous rated burn",
                    e.RatedContinuousSeconds, e.RunContinuousSeconds));
            }
            if (e.RatedCumulativeSeconds is > 0)
            {
                budgets.Add(Burn("burn.cumulative", collapsed ? "rated burn" : "cumulative rated burn",
                    e.RatedCumulativeSeconds, e.RunCumulativeSeconds));
            }
            return budgets.Count == 0 ? null : budgets;
        }

        private static ReliabilityBudget Burn(string id, string label, double? limit, double? used) => new()
        {
            Id = id,
            Label = label,
            // Past the rating, failure probability begins climbing along a
            // config-authored curve. Nothing stops and nothing is guaranteed.
            Kind = "risk-ramp",
            Consumed = used.HasValue && limit is > 0 ? used.Value / limit.Value : null,
            UsedSeconds = used,
            LimitSeconds = limit,
        };

        /// <summary>
        /// TestFlight's per-part namespace. The bound/unbound lists are the
        /// provenance record: an install that regresses the binder is visible in a
        /// debug surface without another decompile.
        /// </summary>
        private static Dictionary<string, object?>? PartExtensions(
            EngineReliabilityRaw e,
            TestFlightBindingReport? binding)
        {
            if (e.Configuration == null && e.FlightData == null && binding == null) return null;
            return new Dictionary<string, object?>
            {
                [ProviderId] = new Dictionary<string, object?>
                {
                    ["configuration"] = e.Configuration,
                    ["flightData"] = e.FlightData,
                    ["boundMembers"] = binding?.Bound,
                    ["unboundMembers"] = binding?.Unbound,
                },
            };
        }

        private static string? Clamp(string? text, int max)
        {
            if (string.IsNullOrEmpty(text)) return null;
            return text!.Length <= max ? text : text.Substring(0, max);
        }
    }
}
