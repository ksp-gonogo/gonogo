using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the Making History uplink's
    /// <c>missions.active</c> channel. The capture
    /// (<c>Gonogo.KSP.MissionCapture.Build</c>) records raw facts about the
    /// running mission; this derives the contract's
    /// <see cref="MissionObjectiveState"/> from them, so the one rule an
    /// operator reads is testable without a game.
    ///
    /// <code>
    /// snapshot.Values["missions"] = { "name", "phase", "started" (bool?), "finished" (bool?),
    ///     "succeeded" (bool?), "scoreEnabled" (bool?), "score" (double?), "maxScore" (double?),
    ///     "objectives": [ { "id", "title", "description", "hasBeenActivated" (bool?), "isActive" (bool?) }, ... ] }
    /// </code>
    ///
    /// The group is absent when there is no mission to report, which maps to a
    /// <c>null</c> payload.
    /// </summary>
    public static class MakingHistoryViewProvider
    {
        public const string MissionTopic = "missions.active";

        public static object? BuildMissionStatus(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("missions", out var raw) || raw is not IDictionary<string, object?> mission)
            {
                return null;
            }

            var finished = SnapshotDict.GetBool(mission, "finished");
            var succeeded = SnapshotDict.GetBool(mission, "succeeded");

            var objectives = new List<object?>();
            if (mission.TryGetValue("objectives", out var rawList) && rawList is IEnumerable<object?> list)
            {
                foreach (var rawEntry in list)
                {
                    if (rawEntry is IDictionary<string, object?> entry)
                    {
                        objectives.Add(BuildMissionObjectiveEntry(entry, finished, succeeded));
                    }
                }
            }

            return new Dictionary<string, object?>
            {
                ["name"] = SnapshotDict.GetString(mission, "name"),
                ["phase"] = SnapshotDict.GetString(mission, "phase"),
                ["started"] = SnapshotDict.GetBool(mission, "started"),
                ["finished"] = finished,
                ["succeeded"] = succeeded,
                ["scoreEnabled"] = SnapshotDict.GetBool(mission, "scoreEnabled"),
                ["score"] = SnapshotDict.GetDouble(mission, "score"),
                ["maxScore"] = SnapshotDict.GetDouble(mission, "maxScore"),
                ["objectives"] = objectives,
            };
        }

        private static Dictionary<string, object?> BuildMissionObjectiveEntry(IDictionary<string, object?> raw, bool? missionFinished, bool? missionSucceeded) => new Dictionary<string, object?>
        {
            ["id"] = SnapshotDict.GetString(raw, "id"),
            ["title"] = SnapshotDict.GetString(raw, "title"),
            ["description"] = SnapshotDict.GetString(raw, "description"),
            ["state"] = (int?)ObjectiveState(
                SnapshotDict.GetBool(raw, "hasBeenActivated"),
                SnapshotDict.GetBool(raw, "isActive"),
                missionFinished,
                missionSucceeded),
        };

        /// <summary>
        /// The state of one objective node: <c>null</c> when whether the mission
        /// reached it could not be read, since a guess would tell the operator
        /// something about a mission the capture never saw.
        ///
        /// <para>A node the mission never reached is Pending, or Failed once the
        /// mission has ended without success. A reached node that is still the
        /// active node is Active while the mission runs, and on a finished
        /// mission is Reached when it succeeded and Failed when it did not. A
        /// reached node the mission has moved past is Reached.</para>
        /// </summary>
        public static MissionObjectiveState? ObjectiveState(bool? hasBeenActivated, bool? isActive, bool? missionFinished, bool? missionSucceeded)
        {
            if (hasBeenActivated == null)
            {
                return null;
            }

            var ended = missionFinished == true;
            var failedEnd = ended && missionSucceeded != true;

            if (hasBeenActivated == false)
            {
                return failedEnd ? MissionObjectiveState.Failed : MissionObjectiveState.Pending;
            }

            if (isActive == true)
            {
                if (!ended)
                {
                    return MissionObjectiveState.Active;
                }

                return failedEnd ? MissionObjectiveState.Failed : MissionObjectiveState.Reached;
            }

            return MissionObjectiveState.Reached;
        }
    }
}
