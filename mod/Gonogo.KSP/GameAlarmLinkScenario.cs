using System;
using System.Collections.Generic;
using System.Globalization;

namespace Gonogo.KSP
{
    /// <summary>
    /// Saves which game alarm is the copy of which Gonogo alarm, beside the
    /// stock clock's own alarms in the same save, so a quickload restores the
    /// two in step.
    ///
    /// <para>The links are a static book because the alarm uplink that reads
    /// them outlives every scene. OnAwake empties it and OnLoad refills it from
    /// the incoming save, the same as <see cref="EvaParentageScenario"/>.</para>
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class GameAlarmLinkScenario : ScenarioModule
    {
        private const string LinkNode = "LINK";
        private const string GonogoKey = "gonogo";
        private const string GameKey = "game";

        /// <summary>Game alarm id by Gonogo alarm id. Main thread only.</summary>
        public static Dictionary<string, long> Links { get; } = new Dictionary<string, long>(StringComparer.Ordinal);

        public override void OnAwake()
        {
            base.OnAwake();
            Links.Clear();
        }

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            try
            {
                Links.Clear();
                foreach (var link in node.GetNodes(LinkNode))
                {
                    var gonogo = link.GetValue(GonogoKey);
                    if (!string.IsNullOrEmpty(gonogo)
                        && long.TryParse(link.GetValue(GameKey), NumberStyles.Integer, CultureInfo.InvariantCulture, out var game))
                    {
                        Links[gonogo] = game;
                    }
                }
            }
            catch (Exception ex)
            {
                GonogoLog.Error("GameAlarmLinkScenario.OnLoad failed", ex);
            }
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            try
            {
                foreach (var link in Links)
                {
                    var child = node.AddNode(LinkNode);
                    child.AddValue(GonogoKey, link.Key);
                    child.AddValue(GameKey, link.Value.ToString(CultureInfo.InvariantCulture));
                }
            }
            catch (Exception ex)
            {
                GonogoLog.Error("GameAlarmLinkScenario.OnSave failed", ex);
            }
        }
    }
}
