using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>parts.power</c> channel, added this
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
    /// omitted, no key at all, whenever there's no active vessel):</b></para>
    /// <code>
    /// snapshot.Values["parts"] = Dictionary&lt;string, object?&gt; {
    ///   "power": {
    ///     "totalProductionEc": double,
    ///   } | null
    ///   "chargeRateEc": double | null            // stored-charge rate, ChargeRateEstimator
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

            var netRate = ReadChargeRate(snapshot);
            var rows = ReadChargeFlows(snapshot);
            double? total = null;
            double? unattributed = null;
            if (netRate.HasValue && rows.HasValue)
            {
                total = Math.Max(0.0, rows.Value.Produced - netRate.Value);
                unattributed = Math.Max(0.0, total.Value - rows.Value.Consumed);
            }

            return new Dictionary<string, object?>
            {
                ["totalProductionEc"] = SnapshotDict.GetDouble(raw, "totalProductionEc"),
                ["netChargeRateEc"] = netRate,
                ["totalConsumptionEc"] = total,
                ["unattributedConsumptionEc"] = unattributed,
            };
        }

        private static double? ReadChargeRate(KspSnapshot? snapshot)
        {
            return snapshot?.Values != null
                && snapshot.Values.TryGetValue("parts", out var rawParts)
                && rawParts is IDictionary<string, object?> parts
                    ? SnapshotDict.GetDouble(parts, "chargeRateEc")
                    : null;
        }

        /// <summary>What the itemised <c>ElectricCharge</c> rows of <c>vessel.parts</c> add and draw, each as a magnitude; null when the part list is not in the snapshot.</summary>
        private static (double Produced, double Consumed)? ReadChargeFlows(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null
                || !snapshot.Values.TryGetValue("vessel", out var rawVessel)
                || rawVessel is not IDictionary<string, object?> vessel
                || !vessel.TryGetValue("topology", out var rawTopology)
                || rawTopology is not IEnumerable<object?> topology)
            {
                return null;
            }

            double produced = 0;
            double consumed = 0;
            foreach (var rawPart in topology)
            {
                if (rawPart is IDictionary<string, object?> part
                    && part.TryGetValue("resources", out var rawResources)
                    && rawResources is IDictionary<string, object?> resources
                    && resources.TryGetValue("ElectricCharge", out var rawRow)
                    && rawRow is IDictionary<string, object?> row)
                {
                    var flow = SnapshotDict.GetDouble(row, "flow");
                    produced += Math.Max(0.0, flow ?? 0.0);
                    consumed += Math.Max(0.0, -(flow ?? 0.0));
                }
            }

            return (produced, consumed);
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
