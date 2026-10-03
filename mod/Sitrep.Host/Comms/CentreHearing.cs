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
                    ear.Stop[vesselId] = _host.HearCraftState(vesselId, centre, state =>
                    {
                        if (Heard(listeningEar, state))
                        {
                            _onHeard?.Invoke(listeningCentre, state.Id);
                        }
                    });
                }
            }
        }

        /// <summary>The newest state <paramref name="centre"/> has received of each craft it has heard of, gone ones included.</summary>
        public IReadOnlyCollection<CraftState> HeardAt(string centre) =>
            _ears.TryGetValue(centre, out var ear) ? ear.Heard.Values : (IReadOnlyCollection<CraftState>)Array.Empty<CraftState>();

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
