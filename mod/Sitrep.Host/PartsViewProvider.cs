using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>parts.power</c> channel, added THIS
    /// session, same "primitives-dict pass-through is fine for now" posture
    /// as <see cref="CareerViewProvider"/>/<see cref="ScienceViewProvider"/>.
    /// Reads <c>Values["parts"]["power"]</c>,
    /// <c>Gonogo.KSP.KspHost.BuildParts</c>'s raw dict. The sibling Breaking
    /// Ground <c>robotics.*</c> channels that used to live here (reading the
    /// same raw <c>Values["parts"]</c> group) moved to
    /// <see cref="BreakingGroundViewProvider"/> alongside the DLC-gated
    /// bundled uplink; see that class's doc comment for the shared-snapshot-
    /// key rationale.
    ///
    /// <para><b>Raw snapshot encoding (Gonogo.KSP.KspHost.BuildParts must
    /// populate exactly this shape at <c>Values["parts"]</c>: entirely
    /// OMITTED, no key at all, whenever there's no active vessel):</b></para>
    /// <code>
    /// snapshot.Values["parts"] = Dictionary&lt;string, object?&gt; {
    ///   "power": {
    ///     "solarPanels": [ { "partName", "partId", "deployState", "flowRate", "chargeRate", "sunAOA" }, ... ],
    ///     "batteries":   [ { "partName", "partId", "current", "max" }, ... ],
    ///     "fuelCells":   [ { "partName", "partId", "active", "status" }, ... ],
    ///     "alternators": [ { "partName", "partId", "outputRate" }, ... ],
    ///     "totalProductionEc": double,
    ///   } | null
    ///   "robotics": [ ... ] | null              // read by BreakingGroundViewProvider
    ///   "roboticsAvailable": bool                // read by BreakingGroundViewProvider
    /// }
    /// </code>
    ///
    /// <para><b>partId</b> is Gonogo.KSP's <c>Part.flightID</c>, stringified,
    /// stable per-part for the life of the flight and, unlike
    /// <c>partName</c>, unique even among symmetric same-named parts (e.g.
    /// a multirotor's N identical arms). Nullable: a snapshot recorded
    /// before this field existed, or a part whose flightID read as the
    /// uninitialized 0 sentinel, comes through as null; consumers must not
    /// assume presence.</para>
    /// </summary>
    public static class PartsViewProvider
    {
        public const string PowerTopic = "parts.power";

        public static object? BuildPower(KspSnapshot? snapshot)
        {
            if (!TryGetPartsGroup(snapshot, "power", out var raw))
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["solarPanels"] = BuildEntryList(raw, "solarPanels", BuildSolarPanelEntry),
                ["batteries"] = BuildEntryList(raw, "batteries", BuildBatteryEntry),
                ["fuelCells"] = BuildEntryList(raw, "fuelCells", BuildFuelCellEntry),
                ["alternators"] = BuildEntryList(raw, "alternators", BuildAlternatorEntry),
                ["totalProductionEc"] = SnapshotDict.GetDouble(raw, "totalProductionEc"),
            };
        }

        /// <summary>
        /// Returns <c>false</c> (never throws) whenever the snapshot has
        /// no <c>"parts"</c> key, or the sub-group key is itself absent
        /// (KspHost's own <c>TryBuildGroup</c> can omit "power" without
        /// taking out "robotics", and vice versa).
        /// </summary>
        private static bool TryGetPartsGroup(KspSnapshot? snapshot, string key, out IDictionary<string, object?> result)
        {
            if (snapshot?.Values != null &&
                snapshot.Values.TryGetValue("parts", out var rawParts) && rawParts is IDictionary<string, object?> parts &&
                parts.TryGetValue(key, out var raw) && raw is IDictionary<string, object?> dict)
            {
                result = dict;
                return true;
            }

            result = new Dictionary<string, object?>();
            return false;
        }

        private static List<object?> BuildEntryList(IDictionary<string, object?> raw, string key, Func<IDictionary<string, object?>, Dictionary<string, object?>> mapEntry)
        {
            var result = new List<object?>();
            if (!raw.TryGetValue(key, out var rawList) || rawList is not IEnumerable<object?> list)
            {
                return result;
            }

            foreach (var rawEntry in list)
            {
                if (rawEntry is IDictionary<string, object?> entry)
                {
                    result.Add(mapEntry(entry));
                }
            }
            return result;
        }

        private static Dictionary<string, object?> BuildSolarPanelEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["partId"] = SnapshotDict.GetString(raw, "partId"),
            ["deployState"] = SnapshotDict.GetString(raw, "deployState"),
            ["flowRate"] = SnapshotDict.GetDouble(raw, "flowRate"),
            ["chargeRate"] = SnapshotDict.GetDouble(raw, "chargeRate"),
            ["sunAOA"] = SnapshotDict.GetDouble(raw, "sunAOA"),
        };

        private static Dictionary<string, object?> BuildBatteryEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["partId"] = SnapshotDict.GetString(raw, "partId"),
            ["current"] = SnapshotDict.GetDouble(raw, "current"),
            ["max"] = SnapshotDict.GetDouble(raw, "max"),
        };

        private static Dictionary<string, object?> BuildFuelCellEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["partId"] = SnapshotDict.GetString(raw, "partId"),
            ["active"] = SnapshotDict.GetBool(raw, "active"),
            ["status"] = SnapshotDict.GetString(raw, "status"),
        };

        private static Dictionary<string, object?> BuildAlternatorEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["partId"] = SnapshotDict.GetString(raw, "partId"),
            ["outputRate"] = SnapshotDict.GetDouble(raw, "outputRate"),
        };
    }
}
