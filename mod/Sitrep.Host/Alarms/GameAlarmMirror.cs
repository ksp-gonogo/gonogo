using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// Keeps a copy of every Gonogo alarm on a universal time in the game's own
    /// alarm clock, and deletes a Gonogo alarm whose copy the player deleted in
    /// the game.
    ///
    /// <para>Only an armed <see cref="ScetAlarmConditionKind.Time"/> alarm is
    /// copied. Every other kind is judged on telemetry, at a craft or at a
    /// command centre, and a time for it in the game's clock would be a guess
    /// about a reading nobody has yet.</para>
    ///
    /// <para>The links live in <paramref name="links"/>, keyed by Gonogo id, which
    /// the caller saves with the game. A quickload therefore puts the links back
    /// in step with the clock it restores, and the client's re-arm that follows
    /// finds its copy instead of making a second one. A link whose Gonogo alarm
    /// is not armed again is left alone: the copy stays in the game as an
    /// ordinary alarm the player can see and delete.</para>
    /// </summary>
    public sealed class GameAlarmMirror
    {
        private readonly IDictionary<string, long> _links;
        private readonly List<string> _disarmed = new List<string>();

        public GameAlarmMirror(IDictionary<string, long> links)
        {
            _links = links ?? throw new ArgumentNullException(nameof(links));
        }

        /// <summary>Gonogo id by game alarm id, for the alarms that are copies.</summary>
        public IReadOnlyDictionary<long, string> MirrorOf()
        {
            var byGame = new Dictionary<long, string>();
            foreach (var link in _links)
            {
                byGame[link.Value] = link.Key;
            }
            return byGame;
        }

        /// <summary>
        /// An operator removed this alarm in Gonogo. Its copy goes on the next
        /// <see cref="Reconcile"/> the clock is available for.
        /// </summary>
        public void Disarmed(string? id)
        {
            if (!string.IsNullOrEmpty(id) && _links.ContainsKey(id!) && !_disarmed.Contains(id!))
            {
                _disarmed.Add(id!);
            }
        }

        /// <summary>
        /// The game alarm with this id was deleted from Gonogo. Returns the
        /// Gonogo alarm it was a copy of, or null for an alarm the player made in
        /// the game.
        /// </summary>
        public string? ForgetGameAlarm(long gameId)
        {
            foreach (var link in _links)
            {
                if (link.Value == gameId)
                {
                    _links.Remove(link.Key);
                    return link.Key;
                }
            }
            return null;
        }

        /// <summary>
        /// Bring the clock in line with <paramref name="roster"/> and report what
        /// the player deleted in the game. Nothing happens while the clock is
        /// absent; the links and any pending removals wait for it.
        /// </summary>
        public GameAlarmMirrorOutcome Reconcile(IReadOnlyList<ScetAlarm> roster, IGameAlarmClock? clock, double nowUt)
        {
            var outcome = new GameAlarmMirrorOutcome();
            if (clock == null || !clock.Available)
            {
                return outcome;
            }

            var held = new Dictionary<long, GameAlarmRecord>();
            foreach (var record in clock.Alarms())
            {
                if (record != null)
                {
                    held[record.Id] = record;
                }
            }

            foreach (var id in _disarmed)
            {
                if (_links.TryGetValue(id, out var gameId))
                {
                    if (held.ContainsKey(gameId))
                    {
                        clock.Delete(gameId);
                    }
                    _links.Remove(id);
                }
            }
            _disarmed.Clear();

            foreach (var alarm in roster)
            {
                if (alarm == null || string.IsNullOrEmpty(alarm.Id))
                {
                    continue;
                }
                var linked = _links.TryGetValue(alarm.Id, out var gameId);
                var present = linked && held.ContainsKey(gameId);

                if (!Wanted(alarm))
                {
                    if (present)
                    {
                        clock.Delete(gameId);
                    }
                    if (linked)
                    {
                        _links.Remove(alarm.Id);
                    }
                    outcome.Links[alarm.Id] = null;
                    continue;
                }

                var ut = alarm.Condition!.Ut;
                var title = TitleOf(alarm);
                if (linked && !present)
                {
                    // Once the instant has passed the game removes its own copy
                    // when it comes due, which is not the player deleting it.
                    _links.Remove(alarm.Id);
                    if (nowUt < ut)
                    {
                        outcome.DeletedInGame.Add(alarm.Id);
                    }
                    outcome.Links[alarm.Id] = null;
                    continue;
                }
                if (present)
                {
                    var copy = held[gameId];
                    if (copy.Ut == ut && string.Equals(copy.Title, title, StringComparison.Ordinal))
                    {
                        outcome.Links[alarm.Id] = gameId;
                        continue;
                    }
                    clock.Delete(gameId);
                }

                var created = clock.CreateAtUt(title, ut);
                if (created.HasValue)
                {
                    _links[alarm.Id] = created.Value;
                }
                else
                {
                    _links.Remove(alarm.Id);
                }
                outcome.Links[alarm.Id] = created;
            }
            return outcome;
        }

        private static bool Wanted(ScetAlarm alarm) =>
            alarm.State == ScetAlarmState.Armed
            && alarm.Condition != null
            && alarm.Condition.Kind == ScetAlarmConditionKind.Time
            && !double.IsNaN(alarm.Condition.Ut)
            && !double.IsInfinity(alarm.Condition.Ut);

        private static string TitleOf(ScetAlarm alarm) =>
            string.IsNullOrEmpty(alarm.Name) ? "Gonogo alarm" : alarm.Name;
    }

    /// <summary>What one <see cref="GameAlarmMirror.Reconcile"/> found and did.</summary>
    public sealed class GameAlarmMirrorOutcome
    {
        /// <summary>Gonogo alarms whose copy the player deleted in the game.</summary>
        public List<string> DeletedInGame { get; } = new List<string>();

        /// <summary>
        /// The copy each roster alarm has after the pass, null for none, by
        /// Gonogo id. Holds only the alarms the pass looked at.
        /// </summary>
        public Dictionary<string, long?> Links { get; } = new Dictionary<string, long?>(StringComparer.Ordinal);
    }

    /// <summary>
    /// What the game alarm Topics last carried, so each is published when it
    /// moved or when a subscriber has not been told it, and a craft whose last
    /// alarm went is told so with an empty list.
    /// </summary>
    public sealed class GameAlarmPublication
    {
        private string? _listKey;
        private readonly ScetRosterAudience _listAudience = new ScetRosterAudience();
        private readonly Dictionary<string, string> _craftKeys = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, ScetRosterAudience> _craftAudiences =
            new Dictionary<string, ScetRosterAudience>(StringComparer.Ordinal);

        /// <summary>The crafts whose Topic this has published and may need to again.</summary>
        public IEnumerable<string> KnownCrafts => _craftKeys.Keys;

        /// <summary>
        /// The publishes <paramref name="view"/> calls for, given whether the
        /// shared list and each craft's Topic have a subscriber now.
        /// </summary>
        public GameAlarmPublishes Next(GameAlarmBoardView view, bool listAudience, Func<string, bool> craftAudience)
        {
            var publishes = new GameAlarmPublishes();
            var listKey = (view.Available ? "1" : "0") + "\u001d" + GameAlarmBoard.KeyOf(view.Plan);
            var listMoved = !string.Equals(listKey, _listKey, StringComparison.Ordinal);
            _listKey = listKey;
            if (_listAudience.ShouldPublish(listAudience, listMoved))
            {
                publishes.List = new GameAlarmList { Available = view.Available, Alarms = view.Plan };
            }

            var crafts = new List<string>(view.ByCraft.Keys);
            foreach (var craft in _craftKeys.Keys)
            {
                if (!view.ByCraft.ContainsKey(craft))
                {
                    crafts.Add(craft);
                }
            }
            foreach (var craft in crafts)
            {
                var alarms = view.ByCraft.TryGetValue(craft, out var list) ? list : new List<GameAlarm>();
                var key = GameAlarmBoard.KeyOf(alarms);
                var moved = !_craftKeys.TryGetValue(craft, out var was) || !string.Equals(was, key, StringComparison.Ordinal);
                if (!_craftAudiences.TryGetValue(craft, out var audience))
                {
                    audience = new ScetRosterAudience();
                    _craftAudiences[craft] = audience;
                }
                if (audience.ShouldPublish(craftAudience(craft), moved))
                {
                    publishes.Crafts[craft] = alarms;
                }
                // Kept after a craft's last alarm goes, so a subscriber that
                // arrives later is told the list is empty rather than replayed
                // the last list it held.
                _craftKeys[craft] = key;
            }
            return publishes;
        }
    }

    /// <summary>What <see cref="GameAlarmPublication.Next"/> says to publish.</summary>
    public sealed class GameAlarmPublishes
    {
        /// <summary>The shared list, or null when it has not moved.</summary>
        public GameAlarmList? List { get; set; }

        /// <summary>Each craft's list that moved, by craft guid.</summary>
        public Dictionary<string, List<GameAlarm>> Crafts { get; } =
            new Dictionary<string, List<GameAlarm>>(StringComparer.Ordinal);
    }
}
