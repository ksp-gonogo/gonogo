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
    /// seam), and deployed science still reads
    /// <c>Values["science"]["deployed"]</c> (<c>Gonogo.KSP.KspHost.BuildScience</c>'s
    /// raw dict, via <c>BuildDeployedScience</c>'s global
    /// <c>FlightGlobals.Vessels</c> walk, shared with
    /// <see cref="ScienceViewProvider"/>'s other <c>science.*</c> sub-groups).</para>
    ///
    /// <code>
    /// snapshot.Values["parts"]["robotics"] = [ { "partName", "partId", "type" ("rotor"|"hinge"|"rotationServo"|"piston"|"servo"),
    ///     "servoIsLocked", "servoIsMotorized", "servoMotorIsEngaged",
    ///     "servoMotorLimit", "motorState", "currentAngle", "targetAngle",
    ///     "traverseVelocity", "currentRPM", "rpmLimit", "normalizedOutput",
    ///     "brakePercentage", "currentExtension", "targetExtension",
    ///     "counterClockwise", "maxTorque" (rotor entries only, null otherwise) }, ... ] | null
    /// snapshot.Values["parts"]["roboticsAvailable"] = bool   // any Breaking Ground servo on THIS vessel
    /// snapshot.Values["science"]["deployed"] = [ { "vesselName", "partName", "body", "situation",
    ///     "biome", "experimentId", "scienceCompletedPercentage",
    ///     "scienceTransmittedPercentage", "scienceValue", "scienceLimit",
    ///     "powerState", "connectionState" (localised PROSE, display only),
    ///     "power" (int? DeployedPowerState, what a client branches on),
    ///     "controllerConnected" (bool?), "deployedOnGround" }, ... ] | null
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
        public const string DeployedTopic = "deployed.bases";

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
        /// only populates when there IS an active vessel), NOT the
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
        /// Shared "pull a list out of Values['science'][key]" walk, the same
        /// shape as <see cref="ScienceViewProvider"/>'s own private
        /// <c>BuildList</c> (kept as a separate copy here rather than shared:
        /// the two providers are deliberately independent now that they
        /// belong to different Uplinks). Returns <c>null</c> (never an empty
        /// list) whenever the snapshot has no <c>"science"</c> key at all, OR
        /// the <c>"deployed"</c> sub-group key is itself absent.
        /// </summary>
        public static object? BuildDeployed(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("science", out var raw) || raw is not IDictionary<string, object?> science)
            {
                return null;
            }

            if (!science.TryGetValue("deployed", out var rawList) || rawList is not IEnumerable<object?> list)
            {
                return null;
            }

            var result = new List<object?>();
            foreach (var rawEntry in list)
            {
                if (rawEntry is IDictionary<string, object?> entry)
                {
                    result.Add(BuildDeployedEntry(entry));
                }
            }
            return result;
        }

        private static Dictionary<string, object?> BuildDeployedEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["vesselName"] = SnapshotDict.GetString(raw, "vesselName"),
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["body"] = SnapshotDict.GetString(raw, "body"),
            ["situation"] = SnapshotDict.GetString(raw, "situation"),
            ["biome"] = SnapshotDict.GetString(raw, "biome"),
            ["experimentId"] = SnapshotDict.GetString(raw, "experimentId"),
            ["scienceCompletedPercentage"] = SnapshotDict.GetDouble(raw, "scienceCompletedPercentage"),
            ["scienceTransmittedPercentage"] = SnapshotDict.GetDouble(raw, "scienceTransmittedPercentage"),
            ["scienceValue"] = SnapshotDict.GetDouble(raw, "scienceValue"),
            ["scienceLimit"] = SnapshotDict.GetDouble(raw, "scienceLimit"),
            ["powerState"] = SnapshotDict.GetString(raw, "powerState"),
            ["power"] = SnapshotDict.GetInt(raw, "power"),
            ["controllerConnected"] = SnapshotDict.GetBool(raw, "controllerConnected"),
            ["connectionState"] = SnapshotDict.GetString(raw, "connectionState"),
            ["deployedOnGround"] = SnapshotDict.GetBool(raw, "deployedOnGround"),
        };
    }
}
