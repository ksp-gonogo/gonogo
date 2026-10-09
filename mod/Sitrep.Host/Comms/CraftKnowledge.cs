using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>What a craft knows of one other craft, how it came to know it and how old that is.</summary>
    public sealed class KnownCraft
    {
        public KnownCraft(CraftState state, double asOfUt, TargetKnowledge source, string? via)
        {
            State = state;
            AsOfUt = asOfUt;
            Source = source;
            Via = via;
        }

        public CraftState State { get; }

        /// <summary>When what is known was true: now for a craft in range, else when the word or sighting of it was made.</summary>
        public double AsOfUt { get; }

        public TargetKnowledge Source { get; }

        /// <summary>The centre that told of it, by name, for <see cref="TargetKnowledge.CommandCentre"/>.</summary>
        public string? Via { get; }

        /// <summary>How late a live link is known to have brought nothing newer than this, or null where none has: see <see cref="CraftKnowledge.HeardNothingNewTo"/>.</summary>
        public double? UnchangedToUt { get; set; }
    }

    /// <summary>
    /// What each thing said, by when it was said, so that what had been said
    /// by an earlier instant can be asked for: what a centre knew a route's
    /// light-time ago is what a craft at the end of that route knows now.
    /// Asking for an instant forgets everything said before the answer, so an
    /// instant earlier than one already asked for is not to be asked.
    /// Courier thread only.
    /// </summary>
    public sealed class SaidByWhen
    {
        private readonly Dictionary<string, List<(double Ut, CraftState State)>> _said =
            new Dictionary<string, List<(double, CraftState)>>(StringComparer.Ordinal);

        /// <summary>The state last noted of each thing, as it was handed in: what is kept may be a copy of it carrying an older list entry.</summary>
        private readonly Dictionary<string, CraftState> _noted = new Dictionary<string, CraftState>(StringComparer.Ordinal);

        public IEnumerable<string> Ids => _said.Keys;

        /// <summary>Notes that <paramref name="state"/> of <paramref name="id"/> was said, or became known, at <paramref name="ut"/>. A state already noted last is not noted twice.</summary>
        public void Note(string id, double ut, CraftState state)
        {
            if (!_said.TryGetValue(id, out var said))
            {
                said = new List<(double, CraftState)>();
                _said[id] = said;
            }
            if (_noted.TryGetValue(id, out var noted) && ReferenceEquals(noted, state))
            {
                return;
            }
            _noted[id] = state;
            said.Add((ut, said.Count > 0 ? state.ListedAsBefore(said[said.Count - 1].State) : state));
        }

        /// <summary>The newest thing said of <paramref name="id"/> at or before <paramref name="ut"/>, or null when nothing had been.</summary>
        public CraftState? AsOf(string id, double ut)
        {
            if (!_said.TryGetValue(id, out var said))
            {
                return null;
            }
            var newest = -1;
            for (var i = 0; i < said.Count && said[i].Ut <= ut; i++)
            {
                newest = i;
            }
            if (newest < 0)
            {
                return null;
            }
            if (newest > 0)
            {
                said.RemoveRange(0, newest);
            }
            return said[0].State;
        }

        /// <summary>When the state <see cref="AsOf"/> answers with for <paramref name="ut"/> was noted, or null where it answers with none.</summary>
        public double? NotedAt(string id, double ut)
        {
            if (!_said.TryGetValue(id, out var said))
            {
                return null;
            }
            double? noted = null;
            for (var i = 0; i < said.Count && said[i].Ut <= ut; i++)
            {
                noted = said[i].Ut;
            }
            return noted;
        }

        public void Clear()
        {
            _said.Clear();
            _noted.Clear();
        }
    }

    /// <summary>
    /// Whether each craft's link was up, by when that was known, so that what
    /// was known by an earlier instant can be asked for. A command centre's
    /// belief about a craft's link reaches a craft at the end of its control
    /// route one light-time of that route later, as everything else the centre
    /// knows does. Asking for an instant forgets what was known before the
    /// answer. Courier thread only.
    /// </summary>
    public sealed class LinkByWhen
    {
        private readonly Dictionary<string, List<(double Ut, bool Up)>> _known =
            new Dictionary<string, List<(double, bool)>>(StringComparer.Ordinal);

        /// <summary>Notes that the craft's link was known to be up, or down, at <paramref name="ut"/>. Knowing the same thing again is not noted.</summary>
        public void Note(string id, double ut, bool up)
        {
            if (!_known.TryGetValue(id, out var known))
            {
                known = new List<(double, bool)>();
                _known[id] = known;
            }
            if (known.Count > 0 && known[known.Count - 1].Up == up)
            {
                return;
            }
            known.Add((ut, up));
        }

        /// <summary>Whether the craft's link was known to be up by <paramref name="ut"/>, or null where nothing of it was known by then.</summary>
        public bool? AsOf(string id, double ut)
        {
            if (!_known.TryGetValue(id, out var known))
            {
                return null;
            }
            var newest = -1;
            for (var i = 0; i < known.Count && known[i].Ut <= ut; i++)
            {
                newest = i;
            }
            if (newest < 0)
            {
                return null;
            }
            if (newest > 0)
            {
                known.RemoveRange(0, newest);
            }
            return known[0].Up;
        }

        public void Clear() => _known.Clear();
    }

    /// <summary>
    /// What one craft knows of every other, kept as it learns it.
    ///
    /// <para>A craft learns of another in three ways, and holds whichever
    /// told it the newest thing: the other is within physics range, and is
    /// seen as it is; the other's radio reaches it directly, and what it said
    /// one light-time of that link ago has arrived; or its command centre
    /// knows of the other and what the centre knew one light-time of the
    /// control route ago has arrived. A craft with none of the three learns
    /// nothing and keeps what it has, which ages. Courier thread only.</para>
    /// </summary>
    public sealed class CraftKnowledge
    {
        private readonly Dictionary<string, KnownCraft> _known = new Dictionary<string, KnownCraft>(StringComparer.Ordinal);

        public IReadOnlyCollection<KnownCraft> Known => _known.Values;

        public KnownCraft? Of(string id) => _known.TryGetValue(id, out var known) ? known : null;

        /// <summary>
        /// Takes in something learned of a craft, which stands when it is
        /// newer than what is held. Being told a craft is gone forgets it.
        /// </summary>
        public void Learn(CraftState state, double asOfUt, TargetKnowledge source, string? via)
        {
            if (_known.TryGetValue(state.Id, out var held)
                && (held.AsOfUt > asOfUt || (held.AsOfUt == asOfUt && !IsMoreDirect(source, held.Source))))
            {
                return;
            }
            if (!state.Exists)
            {
                _known.Remove(state.Id);
                return;
            }
            _known[state.Id] = new KnownCraft(state, asOfUt, source, via);
        }

        /// <summary>Whether <paramref name="source"/> is a nearer way of knowing than <paramref name="than"/>: the same word heard on the craft's own link outranks the centre's telling of it, because only the link's silence says the craft is unchanged.</summary>
        private static bool IsMoreDirect(TargetKnowledge source, TargetKnowledge than) => source < than;

        /// <summary>
        /// Takes in that a link held as up has brought nothing newer than what
        /// the craft said at <paramref name="saidUt"/>, as late as
        /// <paramref name="toUt"/>: the last instant a word could have left the
        /// craft and already be in. A craft says so when its state changes, so
        /// silence on a link that is up is word that it has not. It counts only
        /// while what is held is that same word, learned <paramref name="over"/>
        /// the same way: the craft's own live link, or its command centre's
        /// hearing as the craft has been told of it.
        /// </summary>
        public void HeardNothingNewTo(string id, double saidUt, double toUt, TargetKnowledge over = TargetKnowledge.DirectLink)
        {
            if (!_known.TryGetValue(id, out var held)
                || held.Source != over
                || held.AsOfUt != saidUt
                || toUt <= held.AsOfUt
                || toUt <= held.UnchangedToUt)
            {
                return;
            }
            held.UnchangedToUt = toUt;
        }

        /// <summary>A craft that was in range and is no longer in the game was seen to go.</summary>
        public void ForgetIfLastSeenInRange(string id)
        {
            if (_known.TryGetValue(id, out var held) && held.Source == TargetKnowledge.InRange)
            {
                _known.Remove(id);
            }
        }

        /// <summary>
        /// The <c>target.available</c> entries for the craft: the game's own
        /// parts and bodies, and each other craft as this craft knows it.
        /// </summary>
        /// <param name="game">The game's own list this instant, as <c>SystemViewProvider.BuildTargetAvailable</c> maps it, or null.</param>
        /// <param name="inRange">The bare guids of the craft within physics range.</param>
        public List<object?> Entries(IReadOnlyList<object?>? game, ICollection<string> inRange)
        {
            var entries = new List<object?>();
            var gameCraft = new Dictionary<string, IDictionary<string, object?>>(StringComparer.Ordinal);
            if (game != null)
            {
                foreach (var item in game)
                {
                    if (!(item is IDictionary<string, object?> entry) || !(entry.TryGetValue("kind", out var rawKind) && rawKind is int kind))
                    {
                        continue;
                    }
                    var vesselId = entry.TryGetValue("vesselId", out var rawId) ? rawId as string : null;
                    switch ((TargetKind)kind)
                    {
                        case TargetKind.Vessel:
                            if (vesselId != null)
                            {
                                gameCraft[vesselId] = entry;
                            }
                            break;
                        case TargetKind.Part:
                            // A port can only be picked out on a craft that is loaded beside this one.
                            if (vesselId != null && inRange.Contains(vesselId))
                            {
                                entries.Add(entry);
                            }
                            break;
                        default:
                            entries.Add(entry);
                            break;
                    }
                }
            }

            var known = new List<KnownCraft>(_known.Values);
            known.Sort((a, b) => string.CompareOrdinal(a.State.Id, b.State.Id));
            foreach (var craft in known)
            {
                var listed = craft.State.Roster;
                var type = Whole(listed, "vesselType");
                if (type == null || Unpickable((VesselType)type.Value))
                {
                    continue;
                }
                var guid = CraftStateRecorder.GuidOf(craft.State.Id);
                gameCraft.TryGetValue(guid, out var asTheGameHasIt);
                var near = craft.Source == TargetKnowledge.InRange && inRange.Contains(guid);
                entries.Add(new Dictionary<string, object?>
                {
                    ["kind"] = (int)TargetKind.Vessel,
                    ["name"] = craft.State.Name ?? (listed != null && listed.TryGetValue("name", out var name) ? name as string : null) ?? "",
                    ["vesselId"] = guid,
                    ["bodyIndex"] = null,
                    ["partId"] = null,
                    ["vesselType"] = type,
                    ["situation"] = near && asTheGameHasIt != null ? Seen(asTheGameHasIt, "situation") : Whole(listed, "situation"),
                    // A range is something the craft measures, and it can only measure to what is beside it.
                    ["distance"] = near && asTheGameHasIt != null && asTheGameHasIt.TryGetValue("distance", out var distance) ? distance : null,
                    // Which craft it is pointed at is the craft's own to say.
                    ["isCurrent"] = asTheGameHasIt != null && asTheGameHasIt.TryGetValue("isCurrent", out var current) && current is bool yes && yes,
                    ["source"] = (int)craft.Source,
                    ["asOfUt"] = craft.AsOfUt,
                    ["unchangedToUt"] = craft.UnchangedToUt,
                    ["via"] = craft.Via,
                    // Beside it, the orbit is as the game has it this instant. Otherwise it is as the craft was last told.
                    ["orbit"] = near && asTheGameHasIt != null ? Seen(asTheGameHasIt, "orbit") : Orbit(listed),
                    ["orbitBodyIndex"] = near && asTheGameHasIt != null
                        ? Seen(asTheGameHasIt, "orbitBodyIndex")
                        : Orbit(listed) == null ? null : (object?)Whole(listed, "bodyIndex"),
                });
            }
            return entries;
        }

        private static object? Seen(IDictionary<string, object?> entry, string key) =>
            entry.TryGetValue(key, out var value) ? value : null;

        private static object? Orbit(IReadOnlyDictionary<string, object?>? listed) =>
            listed != null && listed.TryGetValue("orbit", out var orbit) ? orbit : null;

        private static int? Whole(IReadOnlyDictionary<string, object?>? listed, string key) =>
            listed != null && listed.TryGetValue(key, out var value) && value is int whole ? whole : (int?)null;

        /// <summary>The kinds the target list has always left out: flags, kerbals on EVA, debris and the unclassified.</summary>
        private static bool Unpickable(VesselType type) =>
            type == VesselType.Flag || type == VesselType.EVA || type == VesselType.Debris || type == VesselType.Unknown;
    }
}
