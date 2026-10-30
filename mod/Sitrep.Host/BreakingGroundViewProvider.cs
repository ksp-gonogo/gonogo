using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the Breaking Ground uplink's <c>robotics.*</c>
    /// + <c>deployed.*</c> channels, held here rather than in
    /// <see cref="PartsViewProvider"/> (robotics) or
    /// <see cref="ScienceViewProvider"/> (deployed science) so the DLC-specific
    /// surface does not co-mingle with vanilla power/science mapping. Same
    /// "primitives-dict pass-through is fine for now" posture as those two.
    ///
    /// <para><b>The raw snapshot encoding is shared, not private to this
    /// provider</b>: robotics reads
    /// <c>Values["parts"]["robotics"]</c>/<c>Values["parts"]["roboticsAvailable"]</c>
    /// (<c>Gonogo.KSP.KspHost.BuildParts</c>'s raw dict, shared with
    /// <see cref="PartsViewProvider.BuildPower"/>'s <c>Values["parts"]["power"]</c>
    /// read: robotics and power are captured by the same sampler call and
    /// keep sharing that snapshot key rather than introduce a new sampler
    /// seam). Deployed science reads the top-level
    /// <c>Values["deployedScience"]</c> (<c>Gonogo.KSP.KspHost.BuildDeployedScience</c>),
    /// captured in every game scene whether or not anything is flying, since
    /// every base in the save is listed.</para>
    ///
    /// <code>
    /// snapshot.Values["parts"]["robotics"] = [ { "partName", "partId", "type" ("rotor"|"hinge"|"rotationServo"|"piston"|"servo"),
    ///     "servoIsLocked", "servoIsMotorized", "servoMotorIsEngaged",
    ///     "servoMotorLimit", "motorState", "currentAngle", "targetAngle",
    ///     "traverseVelocity", "currentRPM", "rpmLimit", "normalizedOutput",
    ///     "brakePercentage", "currentExtension", "targetExtension",
    ///     "counterClockwise", "maxTorque" (rotor entries only, null otherwise) }, ... ] | null
    /// snapshot.Values["parts"]["roboticsAvailable"] = bool?  // any BG servo on THIS vessel, null if a part could not be read
    /// snapshot.Values["deployedScience"] = [ { "partName", "experimentId", "scienceCompletedPercentage",
    ///     "scienceTransmittedPercentage", "scienceValue", "scienceLimit",
    ///     "power" (int? DeployedPowerState, what a client branches on),
    ///     "powerAvailable", "powerRequired", "deployedOnGround",
    ///     "storedData", "dataSendFailed", "sendPathHome",
    ///     "enabled" (bool?, the experiment's own switch, read loaded or not),
    ///     "offReason" (int? DeployedOffReason, absent while on or unread),
    ///     "stationId" (the controller vessel's guid, absent when it cannot be
    ///     placed), "stationName", "stationBody", "stationSituation",
    ///     "stationBiome" }, ... ] | null
    /// </code>
    ///
    /// <para><b>partId</b> is Gonogo.KSP's <c>Part.flightID</c>, stringified,
    /// same convention as every other capture-added provider in this
    /// assembly.</para>
    /// </summary>
    public static class BreakingGroundViewProvider
    {
        public const string RoboticsTopic = "robotics.servos";
        public const string RoboticsAvailableTopic = "robotics.available";
        /// <summary>The prefix of the per-station namespace; the key after it is the controller vessel's guid.</summary>
        public const string StationPrefix = "deployed.station.";

        /// <summary>
        /// The field a station publishes under its key. A per-vessel topic needs a
        /// field after the key: a bare <c>deployed.station.&lt;guid&gt;</c> would be
        /// timed on the active craft's node, not the station's.
        /// </summary>
        public const string StationReportSuffix = ".report";

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
        /// The <c>robotics.available</c> channel: a wrapper object
        /// <c>{ available: bool }</c>, or <c>null</c> when there is no active
        /// vessel (no <c>"parts"</c> key at all). Unlike
        /// <see cref="BuildRobotics"/>, this keys off the presence of the
        /// <c>"parts"</c> group itself (which <c>Gonogo.KSP.KspHost.BuildParts</c>
        /// only populates when there is an active vessel), not the
        /// <c>"robotics"</c> sub-key: a vessel with no robotic parts must
        /// still report <c>available: false</c>, and only an omitted parts
        /// key (no vessel) collapses to <c>null</c>. That is the empty-vs-no-
        /// vessel disambiguation the bare <c>robotics.servos</c> array can't
        /// carry: see <see cref="Sitrep.Contract.RoboticsAvailability"/>.
        /// </summary>
        public static object? BuildRoboticsAvailable(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("parts", out var rawParts) || rawParts is not IDictionary<string, object?> parts)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["available"] = SnapshotDict.GetBool(parts, "roboticsAvailable"),
            };
        }

        private static Dictionary<string, object?> BuildServoEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["partId"] = SnapshotDict.GetString(raw, "partId"),
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
            ["counterClockwise"] = SnapshotDict.GetBool(raw, "counterClockwise"),
            ["maxTorque"] = SnapshotDict.GetDouble(raw, "maxTorque"),
        };

        /// <summary>
        /// Every deployed-science station in the save, keyed by the guid of its
        /// controller vessel, each as the wire payload for
        /// <c>deployed.station.&lt;guid&gt;.report</c>. <c>null</c> when the snapshot has
        /// no <c>"deployedScience"</c> list (Breaking Ground absent, or not read);
        /// an empty map is a complete roster with no station in it.
        ///
        /// <para>An experiment with no <c>"stationId"</c> belongs to no station and is
        /// left out: with no controller vessel it has no link to be timed on, and a
        /// station invented for it would be one that can never be heard from.</para>
        /// </summary>
        public static Dictionary<string, Dictionary<string, object?>>? BuildStations(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("deployedScience", out var rawList) || rawList is not IEnumerable<object?> list)
            {
                return null;
            }

            var order = new List<string>();
            var groups = new Dictionary<string, List<IDictionary<string, object?>>>(StringComparer.Ordinal);
            foreach (var rawEntry in list)
            {
                if (rawEntry is not IDictionary<string, object?> entry)
                {
                    continue;
                }

                var stationId = SnapshotDict.GetString(entry, "stationId");
                if (string.IsNullOrEmpty(stationId))
                {
                    continue;
                }

                if (!groups.TryGetValue(stationId!, out var group))
                {
                    group = new List<IDictionary<string, object?>>();
                    groups[stationId!] = group;
                    order.Add(stationId!);
                }
                group.Add(entry);
            }

            var stations = new Dictionary<string, Dictionary<string, object?>>(StringComparer.Ordinal);
            foreach (var stationId in order)
            {
                stations[stationId] = BuildDeployedStation(groups[stationId]);
            }
            return stations;
        }

        /* Station-level fields are cluster facts every experiment of the cluster repeats, so the first entry stands for them. */
        private static Dictionary<string, object?> BuildDeployedStation(List<IDictionary<string, object?>> entries)
        {
            var first = entries[0];
            var experiments = new List<object?>(entries.Count);
            foreach (var raw in entries)
            {
                experiments.Add(BuildDeployedStationExperiment(raw));
            }

            return new Dictionary<string, object?>
            {
                ["stationName"] = SnapshotDict.GetString(first, "stationName"),
                ["body"] = SnapshotDict.GetString(first, "stationBody"),
                ["situation"] = SnapshotDict.GetString(first, "stationSituation"),
                ["biome"] = SnapshotDict.GetString(first, "stationBiome"),
                ["power"] = SnapshotDict.GetInt(first, "power"),
                ["powerAvailable"] = SnapshotDict.GetInt(first, "powerAvailable"),
                ["powerRequired"] = SnapshotDict.GetInt(first, "powerRequired"),
                ["sendPathHome"] = SnapshotDict.GetBool(first, "sendPathHome"),
                ["dataSendFailed"] = SnapshotDict.GetBool(first, "dataSendFailed"),
                ["experiments"] = experiments,
            };
        }

        /* An experiment switches itself off at its science limit and never sends again, so whatever it still holds then waits for a kerbal whether or not the station has a link. */
        private static bool? IsStranded(double? completedPercentage, double? storedData)
        {
            if (completedPercentage == null || storedData == null)
            {
                return null;
            }
            return completedPercentage >= 100.0 && storedData > 0.0;
        }

        private static Dictionary<string, object?> BuildDeployedStationExperiment(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["experimentId"] = SnapshotDict.GetString(raw, "experimentId"),
            ["scienceCompletedPercentage"] = SnapshotDict.GetDouble(raw, "scienceCompletedPercentage"),
            ["scienceTransmittedPercentage"] = SnapshotDict.GetDouble(raw, "scienceTransmittedPercentage"),
            ["scienceValue"] = SnapshotDict.GetDouble(raw, "scienceValue"),
            ["scienceLimit"] = SnapshotDict.GetDouble(raw, "scienceLimit"),
            ["storedData"] = SnapshotDict.GetDouble(raw, "storedData"),
            ["stranded"] = IsStranded(SnapshotDict.GetDouble(raw, "scienceCompletedPercentage"), SnapshotDict.GetDouble(raw, "storedData")),
            ["deployedOnGround"] = SnapshotDict.GetBool(raw, "deployedOnGround"),
            ["enabled"] = SnapshotDict.GetBool(raw, "enabled"),
            ["offReason"] = SnapshotDict.GetInt(raw, "offReason"),
        };
    }
}
