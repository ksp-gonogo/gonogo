using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What each command centre has heard of each craft: the newest
    /// <see cref="CraftState"/> to have reached it, kept as it arrives.
    ///
    /// <para>It listens at every centre for every craft that has ever been
    /// recorded, whether or not anyone is planning for that centre yet, so a
    /// centre someone sits down at later already knows what it has been
    /// told. Courier thread only.</para>
    /// </summary>
    public sealed class CentreHearing
    {
        private sealed class Ear
        {
            /// <summary>The newest state each craft has been heard to say, by node id.</summary>
            public Dictionary<string, CraftState> Heard { get; } = new Dictionary<string, CraftState>(StringComparer.Ordinal);

            /// <summary>The newest sighting of each object, by node id.</summary>
            public Dictionary<string, CraftSighting> Seen { get; } = new Dictionary<string, CraftSighting>(StringComparer.Ordinal);

            /// <summary>What is known of each craft from the two together: see <see cref="CraftSighting.Known"/>.</summary>
            public Dictionary<string, CraftState> Known { get; } = new Dictionary<string, CraftState>(StringComparer.Ordinal);

            public Dictionary<string, Action> Stop { get; } = new Dictionary<string, Action>(StringComparer.Ordinal);

            /// <summary>Whether each craft's radio answers, as last heard here, by node id.</summary>
            public Dictionary<string, bool> Link { get; } = new Dictionary<string, bool>(StringComparer.Ordinal);

            /// <summary>The newest reading of each craft's radio to have arrived here, by node id.</summary>
            public Dictionary<string, ContactRadio> Radio { get; } = new Dictionary<string, ContactRadio>(StringComparer.Ordinal);

            public long News { get; set; }

            /// <summary>How many radio readings have arrived here. Apart from <see cref="News"/>, which a plan is checked against: a reading changes no plan.</summary>
            public long Readings { get; set; }
        }

        private readonly ICraftStateHost _host;
        private readonly Action<string, string>? _onHeard;
        private readonly Dictionary<string, Ear> _ears = new Dictionary<string, Ear>(StringComparer.Ordinal);

        /// <summary>
        /// What each centre that is not listed just now had heard when it was
        /// last listened at, or was restored with. A centre is missing from
        /// the game's list for the first ticks of a resumed game, while its
        /// ground stations and crewed craft are still being built, and through
        /// any moment it has no pilot. It is the same centre when it is listed
        /// again, and knows what it knew.
        /// </summary>
        private readonly Dictionary<string, Ear> _away = new Dictionary<string, Ear>(StringComparer.Ordinal);
        private readonly HashSet<string> _craft = new HashSet<string>(StringComparer.Ordinal);

        /// <param name="host">Where each craft's states are heard.</param>
        /// <param name="onHeard">Told the centre and the craft each time news of that craft reaches that centre.</param>
        public CentreHearing(ICraftStateHost host, Action<string, string>? onHeard = null)
        {
            _host = host;
            _onHeard = onHeard;
        }

        /// <summary>
        /// Listens at each of <paramref name="centres"/> for every known craft
        /// and for each of <paramref name="craft"/>, and stops listening at a
        /// centre that is no longer one.
        /// </summary>
        /// <param name="centres">Every active command centre.</param>
        /// <param name="craft">Craft recorded this pass, by bare guid.</param>
        public void Listen(IReadOnlyCollection<string> centres, IEnumerable<string> craft)
        {
            foreach (var vesselId in craft)
            {
                _craft.Add(vesselId);
            }
            foreach (var centre in new List<string>(_ears.Keys))
            {
                if (!Contains(centres, centre))
                {
                    Deafen(centre);
                }
            }
            foreach (var centre in centres)
            {
                if (!_ears.TryGetValue(centre, out var ear))
                {
                    if (_away.TryGetValue(centre, out ear))
                    {
                        _away.Remove(centre);
                        // Listed again: whatever is planned for it is planned from what it knows.
                        ear.News++;
                    }
                    else
                    {
                        ear = new Ear();
                    }
                    _ears[centre] = ear;
                }
                foreach (var vesselId in _craft)
                {
                    if (ear.Stop.ContainsKey(vesselId))
                    {
                        continue;
                    }
                    // Placed before the subscribe, which may deliver at once.
                    ear.Stop[vesselId] = () => { };
                    var listeningEar = ear;
                    var listeningCentre = centre;
                    var stopState = _host.HearCraftState(vesselId, centre, state =>
                    {
                        if (Heard(listeningEar, state))
                        {
                            _onHeard?.Invoke(listeningCentre, state.Id);
                        }
                    });
                    var nodeId = CraftStateRecorder.VesselPrefix + vesselId;
                    // Seeing a craft is not hearing from it: nothing that waits for the craft's own word is told.
                    var stopSeen = _host.HearCraftSighting(vesselId, centre, sighting => Seen(listeningEar, sighting));
                    var stopLink = _host.HearCraftLink(vesselId, centre, connected =>
                    {
                        if (!listeningEar.Link.TryGetValue(nodeId, out var was) || was != connected)
                        {
                            listeningEar.Link[nodeId] = connected;
                            listeningEar.News++;
                        }
                    });
                    var stopRadio = _host.HearCraftRadio(vesselId, centre, radio =>
                    {
                        // An older reading arriving after a newer one, down a path that has since shortened, changes nothing.
                        if (!listeningEar.Radio.TryGetValue(nodeId, out var held) || held.CapturedUt < radio.CapturedUt)
                        {
                            listeningEar.Radio[nodeId] = radio;
                            listeningEar.Readings++;
                        }
                    });
                    ear.Stop[vesselId] = () =>
                    {
                        stopState();
                        stopSeen();
                        stopLink();
                        stopRadio();
                    };
                }
            }
        }

        /// <summary>
        /// What <paramref name="centre"/> knows of each craft it has heard from
        /// or seen, gone ones included: where each is as it was last seen or
        /// heard, whichever is newer, and the rest as it was last heard.
        /// </summary>
        public IReadOnlyCollection<CraftState> HeardAt(string centre) =>
            _ears.TryGetValue(centre, out var ear) ? ear.Known.Values : (IReadOnlyCollection<CraftState>)Array.Empty<CraftState>();

        /// <summary>
        /// Whether <paramref name="centre"/> has heard that the craft's radio
        /// answers: true or false as its last report said, or null when no
        /// report of it has reached the centre.
        /// </summary>
        public bool? LinkAt(string centre, string nodeId) =>
            _ears.TryGetValue(centre, out var ear) && ear.Link.TryGetValue(nodeId, out var connected) ? connected : (bool?)null;

        /// <summary>The newest reading of the craft's radio to have reached <paramref name="centre"/>, or null when none has.</summary>
        public ContactRadio? RadioAt(string centre, string nodeId) =>
            _ears.TryGetValue(centre, out var ear) && ear.Radio.TryGetValue(nodeId, out var radio) ? radio : null;

        /// <summary>A count that moves each time a radio reading reaches <paramref name="centre"/>.</summary>
        public long ReadingsAt(string centre) => _ears.TryGetValue(centre, out var ear) ? ear.Readings : 0;

        /// <summary>A count that moves each time news reaches <paramref name="centre"/>.</summary>
        public long NewsAt(string centre) => _ears.TryGetValue(centre, out var ear) ? ear.News : 0;

        /// <summary>Where every craft any centre has heard of is going, as each such centre last heard it: one <see cref="CraftState.Motion"/> each.</summary>
        public HashSet<object> EverythingHeard()
        {
            var all = new HashSet<object>();
            foreach (var ear in _ears.Values)
            {
                foreach (var state in ear.Known.Values)
                {
                    all.Add(state.Motion);
                }
            }
            return all;
        }

        /// <summary>Everything every centre has heard, as it stands, for saving with the game: the centres listed now and those that are not.</summary>
        public HeardSnapshot Snapshot()
        {
            var centres = new List<HeardAtCentre>(_ears.Count + _away.Count);
            var all = new List<KeyValuePair<string, Ear>>(_ears);
            all.AddRange(_away);
            foreach (var ear in all)
            {
                centres.Add(new HeardAtCentre(
                    ear.Key,
                    new List<CraftState>(ear.Value.Heard.Values),
                    new Dictionary<string, bool>(ear.Value.Link, StringComparer.Ordinal),
                    new List<ContactRadio>(ear.Value.Radio.Values),
                    new List<CraftSighting>(ear.Value.Seen.Values)));
            }
            return new HeardSnapshot(centres);
        }

        /// <summary>
        /// Takes back what a save carried: each centre knows what it knew when
        /// the game was saved. Called after <see cref="Reset"/>, before the
        /// first <see cref="Listen"/> of the new timeline, which then listens
        /// for whatever each craft says from here on. A state heard later
        /// replaces a restored one only if it was read later. A centre the
        /// first passes do not list keeps what it is given here until it is.
        /// </summary>
        public void Restore(HeardSnapshot snapshot)
        {
            foreach (var centre in snapshot.Centres)
            {
                if (!_ears.TryGetValue(centre.Centre, out var ear) && !_away.TryGetValue(centre.Centre, out ear))
                {
                    // Not listened at until the game lists it, which Listen then finds here.
                    ear = new Ear();
                    _away[centre.Centre] = ear;
                }
                foreach (var state in centre.States)
                {
                    Heard(ear, state);
                }
                foreach (var sighting in centre.Sightings)
                {
                    Seen(ear, sighting);
                }
                foreach (var link in centre.Links)
                {
                    ear.Link[link.Key] = link.Value;
                }
                // A reading heard after the load replaces a restored one only if it was taken later, as a state does.
                foreach (var radio in centre.Radios)
                {
                    ear.Radio[radio.CraftId] = radio;
                }
                ear.News++;
                ear.Readings++;
            }
        }

        /// <summary>
        /// Forgets everything heard and every craft, and stops listening: the
        /// timeline was reset, and what was heard on the old one may never have
        /// happened on this one. Craft are listened for again as they are
        /// recorded again.
        /// </summary>
        public void Reset()
        {
            foreach (var centre in new List<string>(_ears.Keys))
            {
                Deafen(centre);
            }
            _away.Clear();
            _craft.Clear();
        }

        /// <summary>
        /// Forgets each centre that is not listed and is a craft the game no
        /// longer has: recovered, destroyed, or docked into another. It cannot
        /// be listed again, so what it had heard is of no further use and is
        /// not carried in another save. A centre that is not a craft is kept,
        /// since nothing says a ground station has gone for good; there are
        /// only ever as many of those as the game has had stations.
        /// </summary>
        /// <param name="vesselsInGame">Every vessel the game lists, by bare guid, read from a list that stands.</param>
        /// <returns>How many centres were forgotten.</returns>
        public int ForgetGone(IReadOnlyCollection<string> vesselsInGame)
        {
            var inGame = vesselsInGame as HashSet<string> ?? new HashSet<string>(vesselsInGame, StringComparer.Ordinal);
            var gone = new List<string>();
            foreach (var centre in _away.Keys)
            {
                if (centre.StartsWith(CraftStateRecorder.VesselPrefix, StringComparison.Ordinal)
                    && !inGame.Contains(centre.Substring(CraftStateRecorder.VesselPrefix.Length)))
                {
                    gone.Add(centre);
                }
            }
            foreach (var centre in gone)
            {
                _away.Remove(centre);
            }
            return gone.Count;
        }

        /// <summary>Stops listening at a centre the game no longer lists, and keeps what it had heard for when it is listed again.</summary>
        private void Deafen(string centre)
        {
            var ear = _ears[centre];
            foreach (var stop in ear.Stop.Values)
            {
                stop();
            }
            ear.Stop.Clear();
            _ears.Remove(centre);
            _away[centre] = ear;
        }

        /// <summary>An older state arriving after a newer one, down a path that has since shortened, changes nothing: the centre keeps the newest news it has.</summary>
        private static bool Heard(Ear ear, CraftState state)
        {
            if (ear.Heard.TryGetValue(state.Id, out var held) && held.CapturedUt >= state.CapturedUt)
            {
                return false;
            }
            ear.Heard[state.Id] = state.ListedAsBefore(held);
            Know(ear, state.Id);
            ear.News++;
            return true;
        }

        /// <summary>A sighting older than the newest one held changes nothing.</summary>
        private static bool Seen(Ear ear, CraftSighting sighting)
        {
            if (ear.Seen.TryGetValue(sighting.Id, out var held) && held.CapturedUt >= sighting.CapturedUt)
            {
                return false;
            }
            ear.Seen[sighting.Id] = sighting;
            Know(ear, sighting.Id);
            ear.News++;
            return true;
        }

        private static void Know(Ear ear, string id)
        {
            ear.Heard.TryGetValue(id, out var heard);
            ear.Seen.TryGetValue(id, out var seen);
            var known = CraftSighting.Known(heard, seen);
            if (known == null)
            {
                ear.Known.Remove(id);
                return;
            }
            ear.Known[id] = known;
        }

        private static bool Contains(IReadOnlyCollection<string> centres, string centre)
        {
            foreach (var candidate in centres)
            {
                if (candidate == centre)
                {
                    return true;
                }
            }
            return false;
        }
    }
}
