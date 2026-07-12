using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>dv.stages</c> (bare array) and
    /// <c>dv.summary</c> (wrapper object) channels — the active vessel's
    /// stage-ΔV rollup, sourced from KSP's STOCK <c>VesselDeltaV</c> stage
    /// simulation (captured by <c>Gonogo.KSP.KspHost.BuildDeltaV</c>; see that
    /// method for why the stock sim, not a hand-rolled rocket equation).
    ///
    /// <para>Follows <see cref="SystemViewProvider"/>'s untyped-dict
    /// convention rather than <see cref="VesselPartsViewProvider"/>'s typed
    /// <c>ToWire</c> flatten: even though the raw source lives under the
    /// vessel group, these are <c>dv.*</c>-domain snapshot payloads with no
    /// per-payload <c>Meta</c> provenance (their <c>Meta</c> rides the
    /// envelope), so both <see cref="BuildStages"/> and
    /// <see cref="BuildSummary"/> hand-build the <c>Dictionary</c>/<c>List</c>
    /// tree <c>JsonWriter</c> already walks and return it directly to
    /// <c>AddChannelSource</c> — no <c>*Wire</c> adapter needed. The
    /// <c>Sitrep.Contract.StageDeltaVEntry</c>/<c>StageDeltaVSummary</c> POCOs
    /// are TS-shape-only codegen markers, never serialized.</para>
    ///
    /// <para><b>Raw snapshot encoding</b> (<c>KspHost.BuildDeltaV</c> populates
    /// exactly this shape at <c>Values["vessel"]["deltaV"]</c> — a dict with a
    /// <c>stages</c> list and a <c>summary</c> dict, the whole group omitted
    /// when the stock sim isn't ready / there is no active vessel):</para>
    /// <code>
    /// Values["vessel"]["deltaV"] = {
    ///   "stages": [
    ///     { "stage", "dvVac", "dvAsl", "dvActual", "burnTime",
    ///       "twrVac", "twrAsl", "twrActual",
    ///       "thrustVac", "thrustAsl", "thrustActual",
    ///       "startMass", "endMass", "dryMass", "fuelMass" }, ...
    ///   ],
    ///   "summary": { "stageCount", "totalDvVac", "totalDvAsl",
    ///                "totalDvActual", "totalBurnTime" }
    /// }
    /// </code>
    /// Every scalar reads through <see cref="SnapshotDict"/> (null-on-absence,
    /// non-finite → null), so a stage the sim reports as <c>NaN</c>/
    /// <c>Infinity</c> becomes <c>null</c>, never a sentinel on the wire. Both
    /// builders return <c>null</c> (not an empty list / object) when the raw
    /// <c>deltaV</c> group is missing — "sim not ready" is distinct from
    /// "zero stages".
    /// </summary>
    public static class StageDeltaVViewProvider
    {
        /// <summary>The bare-array per-stage topic.</summary>
        public const string StagesTopic = "dv.stages";

        /// <summary>The wrapper-object whole-vessel-rollup topic.</summary>
        public const string SummaryTopic = "dv.summary";

        /// <summary>
        /// Maps the raw <c>deltaV.stages</c> list to the <c>dv.stages</c>
        /// payload — a bare <c>List</c> of per-stage dicts whose keys mirror
        /// <c>Sitrep.Contract.StageDeltaVEntry</c>. Returns <c>null</c> when
        /// there is no <c>deltaV</c> group or no <c>stages</c> list at all
        /// (stock sim not ready / no vessel), distinct from an empty list.
        /// </summary>
        public static object? BuildStages(KspSnapshot? snapshot)
        {
            var deltaV = GetDeltaVGroup(snapshot);
            if (deltaV == null)
            {
                return null;
            }

            if (!deltaV.TryGetValue("stages", out var rawStages) || rawStages is not IEnumerable<object?> rawList)
            {
                return null;
            }

            var stages = new List<object?>();
            foreach (var rawEntry in rawList)
            {
                if (rawEntry is IDictionary<string, object?> raw)
                {
                    stages.Add(MapStage(raw));
                }
            }

            return stages;
        }

        /// <summary>
        /// Maps the raw <c>deltaV.summary</c> dict to the <c>dv.summary</c>
        /// payload — a single dict whose keys mirror
        /// <c>Sitrep.Contract.StageDeltaVSummary</c>. Returns <c>null</c> when
        /// there is no <c>deltaV</c> group or no <c>summary</c> dict at all.
        /// </summary>
        public static object? BuildSummary(KspSnapshot? snapshot)
        {
            var deltaV = GetDeltaVGroup(snapshot);
            if (deltaV == null)
            {
                return null;
            }

            if (!deltaV.TryGetValue("summary", out var rawSummary) || rawSummary is not IDictionary<string, object?> raw)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["stageCount"] = GetInt(raw, "stageCount"),
                ["totalDvVac"] = GetDouble(raw, "totalDvVac"),
                ["totalDvAsl"] = GetDouble(raw, "totalDvAsl"),
                ["totalDvActual"] = GetDouble(raw, "totalDvActual"),
                ["totalBurnTime"] = GetDouble(raw, "totalBurnTime"),
            };
        }

        private static Dictionary<string, object?> MapStage(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["stage"] = GetInt(raw, "stage"),
            ["dvVac"] = GetDouble(raw, "dvVac"),
            ["dvAsl"] = GetDouble(raw, "dvAsl"),
            ["dvActual"] = GetDouble(raw, "dvActual"),
            ["burnTime"] = GetDouble(raw, "burnTime"),
            ["twrVac"] = GetDouble(raw, "twrVac"),
            ["twrAsl"] = GetDouble(raw, "twrAsl"),
            ["twrActual"] = GetDouble(raw, "twrActual"),
            ["thrustVac"] = GetDouble(raw, "thrustVac"),
            ["thrustAsl"] = GetDouble(raw, "thrustAsl"),
            ["thrustActual"] = GetDouble(raw, "thrustActual"),
            ["startMass"] = GetDouble(raw, "startMass"),
            ["endMass"] = GetDouble(raw, "endMass"),
            ["dryMass"] = GetDouble(raw, "dryMass"),
            ["fuelMass"] = GetDouble(raw, "fuelMass"),
            ["resources"] = MapStageResources(raw),
        };

        /// <summary>
        /// Maps the raw <c>stages[i].resources</c> dict (KspHost's
        /// <c>BuildStageResources</c> — a resource-name-keyed map of
        /// <c>{current, max}</c>) to the wire shape mirroring
        /// <c>Sitrep.Contract.ResourceAmount</c>. An entry missing either
        /// scalar is skipped (R1(c) — same "absent, not fabricated"
        /// discipline every other raw-dict reader in this class follows), and
        /// a stage carrying no <c>resources</c> key at all (an entry built
        /// before this field existed, or the sim's per-part resource lookup
        /// came up empty) maps to an empty dict, never null.
        /// </summary>
        private static Dictionary<string, object?> MapStageResources(IDictionary<string, object?> raw)
        {
            var result = new Dictionary<string, object?>();
            if (!raw.TryGetValue("resources", out var rawResources) || rawResources is not IDictionary<string, object?> resources)
            {
                return result;
            }

            foreach (var kvp in resources)
            {
                if (kvp.Value is not IDictionary<string, object?> entry)
                {
                    continue;
                }

                var current = GetDouble(entry, "current");
                var max = GetDouble(entry, "max");
                if (!current.HasValue || !max.HasValue)
                {
                    continue;
                }

                result[kvp.Key] = new Dictionary<string, object?>
                {
                    ["current"] = current.Value,
                    ["max"] = max.Value,
                    ["active"] = true,
                };
            }

            return result;
        }

        private static IDictionary<string, object?>? GetDeltaVGroup(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("vessel", out var rawVessel) || rawVessel is not IDictionary<string, object?> vessel)
            {
                return null;
            }

            return vessel.TryGetValue("deltaV", out var rawDeltaV) && rawDeltaV is IDictionary<string, object?> deltaV
                ? deltaV
                : null;
        }

        private static int? GetInt(IDictionary<string, object?> raw, string key) => SnapshotDict.GetInt(raw, key);
        private static double? GetDouble(IDictionary<string, object?> raw, string key) => SnapshotDict.GetDouble(raw, key);
    }
}
