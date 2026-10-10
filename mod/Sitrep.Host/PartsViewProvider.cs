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
    }
}
