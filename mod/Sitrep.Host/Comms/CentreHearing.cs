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
            public Dictionary<string, CraftState> Heard { get; } = new Dictionary<string, CraftState>(StringComparer.Ordinal);

            public Dictionary<string, Action> Stop { get; } = new Dictionary<string, Action>(StringComparer.Ordinal);

            /// <summary>Whether each craft's radio answers, as last heard here, by node id.</summary>
            public Dictionary<string, bool> Link { get; } = new Dictionary<string, bool>(StringComparer.Ordinal);

            public long News { get; set; }
        }

        private readonly ICraftStateHost _host;
        private readonly Action<string, string>? _onHeard;
        private readonly Dictionary<string, Ear> _ears = new Dictionary<string, Ear>(StringComparer.Ordinal);
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
                    ear = new Ear();
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
                    var stopLink = _host.HearCraftLink(vesselId, centre, connected =>
                    {
                        if (!listeningEar.Link.TryGetValue(nodeId, out var was) || was != connected)
                        {
                            listeningEar.Link[nodeId] = connected;
                            listeningEar.News++;
                        }
                    });
                    ear.Stop[vesselId] = () =>
                    {
                        stopState();
                        stopLink();
                    };
                }
            }
        }

        /// <summary>The newest state <paramref name="centre"/> has received of each craft it has heard of, gone ones included.</summary>
        public IReadOnlyCollection<CraftState> HeardAt(string centre) =>
            _ears.TryGetValue(centre, out var ear) ? ear.Heard.Values : (IReadOnlyCollection<CraftState>)Array.Empty<CraftState>();

        /// <summary>
        /// Whether <paramref name="centre"/> has heard that the craft's radio
        /// answers: true or false as its last report said, or null when no
        /// report of it has reached the centre.
        /// </summary>
        public bool? LinkAt(string centre, string nodeId) =>
            _ears.TryGetValue(centre, out var ear) && ear.Link.TryGetValue(nodeId, out var connected) ? connected : (bool?)null;

        /// <summary>A count that moves each time news reaches <paramref name="centre"/>.</summary>
        public long NewsAt(string centre) => _ears.TryGetValue(centre, out var ear) ? ear.News : 0;

        /// <summary>Where every craft any centre has heard of is going, as each such centre last heard it: one <see cref="CraftState.Motion"/> each.</summary>
        public HashSet<object> EverythingHeard()
        {
            var all = new HashSet<object>();
            foreach (var ear in _ears.Values)
            {
                foreach (var state in ear.Heard.Values)
                {
                    all.Add(state.Motion);
                }
            }
            return all;
        }

        /// <summary>Everything every centre has heard, as it stands, for saving with the game.</summary>
        public HeardSnapshot Snapshot()
        {
            var centres = new List<HeardAtCentre>(_ears.Count);
            foreach (var ear in _ears)
            {
                centres.Add(new HeardAtCentre(
                    ear.Key,
                    new List<CraftState>(ear.Value.Heard.Values),
                    new Dictionary<string, bool>(ear.Value.Link, StringComparer.Ordinal)));
            }
            return new HeardSnapshot(centres);
        }

        /// <summary>
        /// Takes back what a save carried: each centre knows what it knew when
        /// the game was saved. Called after <see cref="Reset"/>, before the
        /// first <see cref="Listen"/> of the new timeline, which then listens
        /// for whatever each craft says from here on. A state heard later
        /// replaces a restored one only if it was read later.
        /// </summary>
        public void Restore(HeardSnapshot snapshot)
        {
            foreach (var centre in snapshot.Centres)
            {
                if (!_ears.TryGetValue(centre.Centre, out var ear))
                {
                    ear = new Ear();
                    _ears[centre.Centre] = ear;
                }
                foreach (var state in centre.States)
                {
                    Heard(ear, state);
                }
                foreach (var link in centre.Links)
                {
                    ear.Link[link.Key] = link.Value;
                }
                ear.News++;
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
            _craft.Clear();
        }

        private void Deafen(string centre)
        {
            foreach (var stop in _ears[centre].Stop.Values)
            {
                stop();
            }
            _ears.Remove(centre);
        }

        /// <summary>An older state arriving after a newer one, down a path that has since shortened, changes nothing: the centre keeps the newest news it has.</summary>
        private static bool Heard(Ear ear, CraftState state)
        {
            if (ear.Heard.TryGetValue(state.Id, out var held) && held.CapturedUt >= state.CapturedUt)
            {
                return false;
            }
            ear.Heard[state.Id] = state;
            ear.News++;
            return true;
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
