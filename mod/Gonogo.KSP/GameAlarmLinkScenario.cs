using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Saves which game alarm is the copy of which Gonogo alarm, and the Gonogo
    /// alarms themselves, beside the stock clock's own alarms in the same save,
    /// so a quickload restores the three in step.
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

        /// <summary>
        /// Reads the live roster for OnSave, set by the alarm uplink. Called on the
        /// main thread.
        /// </summary>
        public static Func<IReadOnlyList<ScetAlarm>>? LiveRoster { get; set; }

        private static List<ScetAlarm>? _loaded;

        /// <summary>
        /// The roster the last load brought back, handed over once: null when the
        /// uplink has already taken it or no load has happened since.
        /// </summary>
        public static List<ScetAlarm>? TakeLoadedRoster()
        {
            var taken = _loaded;
            _loaded = null;
            return taken;
        }

        public override void OnAwake()
        {
            base.OnAwake();
            Links.Clear();
            _loaded = null;
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
                _loaded = ScetRosterPersistence.Load(node);
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
                var roster = LiveRoster;
                if (roster != null)
                {
                    ScetRosterPersistence.Save(roster(), node);
                }
            }
            catch (Exception ex)
            {
                GonogoLog.Error("GameAlarmLinkScenario.OnSave failed", ex);
            }
        }
    }
}
