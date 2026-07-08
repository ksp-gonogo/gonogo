using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>parts.*</c> channels — added THIS
    /// session, same "primitives-dict pass-through is fine for now" posture
    /// as <see cref="CareerViewProvider"/>/<see cref="ScienceViewProvider"/>.
    /// Reads <c>Values["parts"]["power"/"robotics"]</c> —
    /// <c>Gonogo.KSP.KspHost.BuildParts</c>'s raw dict.
    ///
    /// <para><b>Raw snapshot encoding (Gonogo.KSP.KspHost.BuildParts must
    /// populate exactly this shape at <c>Values["parts"]</c> — entirely
    /// OMITTED, no key at all, whenever there's no active vessel):</b></para>
    /// <code>
    /// snapshot.Values["parts"] = Dictionary&lt;string, object?&gt; {
    ///   "power": {
    ///     "solarPanels": [ { "partName", "deployState", "flowRate", "chargeRate", "sunAOA" }, ... ],
    ///     "batteries":   [ { "partName", "current", "max" }, ... ],
    ///     "fuelCells":   [ { "partName", "active", "status" }, ... ],
    ///     "alternators": [ { "partName", "outputRate" }, ... ],
    ///     "totalProductionEc": double,
    ///   } | null
    ///   "robotics": [ { "partName", "type" ("rotor"|"hinge"|"piston"),
    ///     "servoIsLocked", "servoIsMotorized", "servoMotorIsEngaged",
    ///     "servoMotorLimit", "motorState", "currentAngle", "targetAngle",
    ///     "traverseVelocity", "currentRPM", "rpmLimit", "normalizedOutput",
    ///     "brakePercentage", "currentExtension", "targetExtension" }, ... ] | null
    /// }
    /// </code>
    /// </summary>
    public static class PartsViewProvider
    {
        public const string PowerTopic = "parts.power";
        public const string RoboticsTopic = "parts.robotics";

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

        public static object? BuildRobotics(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("parts", out var rawParts) || rawParts is not IDictionary<string, object?> parts)
            {
                return null;
            }

            if (!parts.TryGetValue("robotics", out var rawList) || rawList is not IEnumerable<object?> list)
            {
                return null;
            }

            var result = new List<object?>();
            foreach (var rawEntry in list)
            {
                if (rawEntry is IDictionary<string, object?> entry)
                {
                    result.Add(BuildServoEntry(entry));
                }
            }
            return result;
        }

        /// <summary>
        /// Returns <c>false</c> — never throws — whenever the snapshot has
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
            ["deployState"] = SnapshotDict.GetString(raw, "deployState"),
            ["flowRate"] = SnapshotDict.GetDouble(raw, "flowRate"),
            ["chargeRate"] = SnapshotDict.GetDouble(raw, "chargeRate"),
            ["sunAOA"] = SnapshotDict.GetDouble(raw, "sunAOA"),
        };

        private static Dictionary<string, object?> BuildBatteryEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["current"] = SnapshotDict.GetDouble(raw, "current"),
            ["max"] = SnapshotDict.GetDouble(raw, "max"),
        };

        private static Dictionary<string, object?> BuildFuelCellEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["active"] = SnapshotDict.GetBool(raw, "active"),
            ["status"] = SnapshotDict.GetString(raw, "status"),
        };

        private static Dictionary<string, object?> BuildAlternatorEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["outputRate"] = SnapshotDict.GetDouble(raw, "outputRate"),
        };

        private static Dictionary<string, object?> BuildServoEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["type"] = SnapshotDict.GetString(raw, "type"),
            ["servoIsLocked"] = SnapshotDict.GetBool(raw, "servoIsLocked"),
            ["servoIsMotorized"] = SnapshotDict.GetBool(raw, "servoIsMotorized"),
            ["servoMotorIsEngaged"] = SnapshotDict.GetBool(raw, "servoMotorIsEngaged"),
            ["servoMotorLimit"] = SnapshotDict.GetDouble(raw, "servoMotorLimit"),
            ["motorState"] = SnapshotDict.GetString(raw, "motorState"),
            ["currentAngle"] = SnapshotDict.GetDouble(raw, "currentAngle"),
            ["targetAngle"] = SnapshotDict.GetDouble(raw, "targetAngle"),
            ["traverseVelocity"] = SnapshotDict.GetDouble(raw, "traverseVelocity"),
            ["currentRPM"] = SnapshotDict.GetDouble(raw, "currentRPM"),
            ["rpmLimit"] = SnapshotDict.GetDouble(raw, "rpmLimit"),
            ["normalizedOutput"] = SnapshotDict.GetDouble(raw, "normalizedOutput"),
            ["brakePercentage"] = SnapshotDict.GetDouble(raw, "brakePercentage"),
            ["currentExtension"] = SnapshotDict.GetDouble(raw, "currentExtension"),
            ["targetExtension"] = SnapshotDict.GetDouble(raw, "targetExtension"),
        };
    }
}
