using System;
using System.Collections.Generic;
using Expansions;
using Expansions.Missions;
using Expansions.Missions.Runtime;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Reads the running Making History mission into the raw
    /// <c>Values["missions"]</c> group <c>Sitrep.Host.MakingHistoryViewProvider</c>
    /// maps. Every member read here was checked against the decompiled
    /// <c>Assembly-CSharp</c> types (<c>MissionSystem</c>, <c>Mission</c>,
    /// <c>MENode</c>), and none of it has been run against a real Making History
    /// install: nobody on the project owns the expansion.
    ///
    /// <para>Returns <c>null</c>, so the group is omitted, when the expansion is
    /// not installed or no mission is loaded.</para>
    /// </summary>
    public static class MissionCapture
    {
        public static Dictionary<string, object?>? Build()
        {
            if (!ExpansionsLoader.IsExpansionInstalled("MakingHistory"))
            {
                return null;
            }

            var missions = MissionSystem.missions;
            if (missions == null || missions.Count == 0)
            {
                return null;
            }

            var states = new List<(bool Started, bool Ended)>(missions.Count);
            foreach (var m in missions)
            {
                states.Add((m != null && m.isStarted, m != null && m.isEnded));
            }

            var index = MakingHistoryReads.PickMission(states);
            var mission = index < 0 ? null : missions[index];
            if (mission == null)
            {
                return null;
            }

            var active = mission.activeNode;
            var entry = new Dictionary<string, object?>
            {
                ["name"] = GameWords.Name(mission.title, "Mission"),
                ["phase"] = active != null ? GameWords.Name(active.Title, "") : null,
                ["started"] = mission.isStarted,
                ["finished"] = mission.isEnded,
                ["succeeded"] = mission.isSuccesful,
                ["scoreEnabled"] = mission.isScoreEnabled,
                ["score"] = (double)mission.currentScore,
                ["maxScore"] = (double)mission.maxScore,
            };

            try
            {
                entry["objectives"] = BuildObjectives(mission);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] missions objectives build failed, omitting: " + ex);
            }

            return entry;
        }

        /// <summary>
        /// The objective nodes in mission-flow order: a walk from the start node
        /// along <c>toNodes</c>, each node once, skipping orphans, which is the
        /// walk the mission's own objective printout makes.
        /// </summary>
        private static List<object?> BuildObjectives(Mission mission)
        {
            var result = new List<object?>();
            var visited = new HashSet<MENode>();
            var pending = new Stack<MENode>();
            if (mission.startNode != null)
            {
                pending.Push(mission.startNode);
            }

            while (pending.Count > 0)
            {
                var node = pending.Pop();
                if (node == null || !visited.Add(node) || node.IsOrphanNode)
                {
                    continue;
                }

                if (node.isObjective)
                {
                    result.Add(new Dictionary<string, object?>
                    {
                        ["id"] = node.id.ToString(),
                        ["title"] = GameWords.Name(node.Title, "Objective"),
                        ["description"] = string.IsNullOrEmpty(node.description) ? null : GameWords.Name(node.description, ""),
                        ["hasBeenActivated"] = node.HasBeenActivated,
                        ["isActive"] = node.IsActiveNode,
                    });
                }

                var next = node.toNodes;
                if (next == null)
                {
                    continue;
                }

                // Pushed in reverse so the first branch is walked first.
                for (var i = next.Count - 1; i >= 0; i--)
                {
                    pending.Push(next[i]);
                }
            }

            return result;
        }
    }
}
