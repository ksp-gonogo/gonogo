using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>science.*</c> channels — added THIS
    /// session (speed prioritized, same posture as <see cref="CareerViewProvider"/>'s
    /// doc comment: a primitives-dict pass-through is fine for now, a typed
    /// <c>Sitrep.Contract</c> POCO is a follow-up). Reads
    /// <c>Values["science"]["experiments"/"lab"/"deployed"]</c> —
    /// <c>Gonogo.KSP.KspHost.BuildScience</c>'s raw dict — and republishes
    /// each sub-group through <see cref="SnapshotDict"/>'s readers so every
    /// scalar gets the same R1/F-1 non-finite-is-absent rule every other
    /// provider in this assembly applies.
    ///
    /// <para><b>Raw snapshot encoding (Gonogo.KSP.KspHost.BuildScience must
    /// populate exactly this shape at <c>Values["science"]</c> — entirely
    /// OMITTED, no key at all, whenever there's no active vessel):</b></para>
    /// <code>
    /// snapshot.Values["science"] = Dictionary&lt;string, object?&gt; {
    ///   "experiments": [ { "partName", "location" ("experiment"|"container"),
    ///     "experimentId", "subjectId", "title", "dataAmount",
    ///     "scienceValueRatio", "baseTransmitValue", "transmitBonus",
    ///     "labValue", "deployed", "inoperable", "situation" }, ... ] | null
    ///   "lab": [ { "partName", "dataStored", "dataStorage", "storedScience",
    ///     "processingData", "statusText", "scientistCount", "scienceRate",
    ///     "isOperational" }, ... ] | null
    ///   "deployed": [ { "partName", "experimentId", "deployed",
    ///     "inoperable", "situation" }, ... ] | null
    /// }
    /// </code>
    /// Three separate channels (one per sub-group) rather than one combined
    /// topic — see <c>Gonogo.KSP.ScienceExtension</c>'s doc comment for why.
    /// </summary>
    public static class ScienceViewProvider
    {
        public const string ExperimentsTopic = "science.experiments";
        public const string LabTopic = "science.lab";
        public const string DeployedTopic = "science.deployed";

        public static object? BuildExperiments(KspSnapshot? snapshot) =>
            BuildList(snapshot, "experiments", BuildExperimentEntry);

        public static object? BuildLab(KspSnapshot? snapshot) =>
            BuildList(snapshot, "lab", BuildLabEntry);

        public static object? BuildDeployed(KspSnapshot? snapshot) =>
            BuildList(snapshot, "deployed", BuildDeployedEntry);

        /// <summary>
        /// Shared "pull a list out of Values['science'][key]" walk. Returns
        /// <c>null</c> — never an empty list — whenever the snapshot has no
        /// <c>"science"</c> key at all, OR the sub-group key is itself
        /// absent (KspHost's own <c>TryBuildGroup</c> can omit an individual
        /// sub-group on a build failure without taking out the others; see
        /// its own doc comment).
        /// </summary>
        private static object? BuildList(KspSnapshot? snapshot, string key, Func<IDictionary<string, object?>, Dictionary<string, object?>> mapEntry)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("science", out var raw) || raw is not IDictionary<string, object?> science)
            {
                return null;
            }

            if (!science.TryGetValue(key, out var rawList) || rawList is not IEnumerable<object?> list)
            {
                return null;
            }

            var result = new List<object?>();
            foreach (var rawEntry in list)
            {
                if (rawEntry is IDictionary<string, object?> entry)
                {
                    result.Add(mapEntry(entry));
                }
            }
            return result;
        }

        private static Dictionary<string, object?> BuildExperimentEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["location"] = SnapshotDict.GetString(raw, "location"),
            ["experimentId"] = SnapshotDict.GetString(raw, "experimentId"),
            ["subjectId"] = SnapshotDict.GetString(raw, "subjectId"),
            ["title"] = SnapshotDict.GetString(raw, "title"),
            ["dataAmount"] = SnapshotDict.GetDouble(raw, "dataAmount"),
            ["scienceValueRatio"] = SnapshotDict.GetDouble(raw, "scienceValueRatio"),
            ["baseTransmitValue"] = SnapshotDict.GetDouble(raw, "baseTransmitValue"),
            ["transmitBonus"] = SnapshotDict.GetDouble(raw, "transmitBonus"),
            ["labValue"] = SnapshotDict.GetDouble(raw, "labValue"),
            ["deployed"] = SnapshotDict.GetBool(raw, "deployed"),
            ["inoperable"] = SnapshotDict.GetBool(raw, "inoperable"),
            ["situation"] = SnapshotDict.GetString(raw, "situation"),
        };

        private static Dictionary<string, object?> BuildLabEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["dataStored"] = SnapshotDict.GetDouble(raw, "dataStored"),
            ["dataStorage"] = SnapshotDict.GetDouble(raw, "dataStorage"),
            ["storedScience"] = SnapshotDict.GetDouble(raw, "storedScience"),
            ["processingData"] = SnapshotDict.GetBool(raw, "processingData"),
            ["statusText"] = SnapshotDict.GetString(raw, "statusText"),
            ["scientistCount"] = SnapshotDict.GetInt(raw, "scientistCount"),
            ["scienceRate"] = SnapshotDict.GetDouble(raw, "scienceRate"),
            ["isOperational"] = SnapshotDict.GetBool(raw, "isOperational"),
        };

        private static Dictionary<string, object?> BuildDeployedEntry(IDictionary<string, object?> raw) => new Dictionary<string, object?>
        {
            ["partName"] = SnapshotDict.GetString(raw, "partName"),
            ["experimentId"] = SnapshotDict.GetString(raw, "experimentId"),
            ["deployed"] = SnapshotDict.GetBool(raw, "deployed"),
            ["inoperable"] = SnapshotDict.GetBool(raw, "inoperable"),
            ["situation"] = SnapshotDict.GetString(raw, "situation"),
        };
    }
}
