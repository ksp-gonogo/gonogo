using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Remembers every command centre the registry has listed, with its name and
    /// the universal time it was last listed, so a centre that has left can still
    /// be named and dated.
    ///
    /// <para>Fed once per pass from the registry's active enumeration, whether or
    /// not anything is subscribed, so the stamp is the last pass that really saw
    /// the centre rather than the last pass anybody was watching. Held in memory
    /// only: a centre not seen since the mod started has no entry.</para>
    ///
    /// <para>MAIN-THREAD-ONLY, like the registry it is fed from.</para>
    /// </summary>
    public sealed class CentreMemory
    {
        /// <summary>Bounds the memory against a long career of short-lived vessel centres; the oldest departures are forgotten first.</summary>
        public const int Capacity = 256;

        private readonly Dictionary<string, Remembered> _byId = new Dictionary<string, Remembered>(StringComparer.Ordinal);

        public void Observe(IEnumerable<ICommandCentre> active, double ut)
        {
            foreach (var centre in active)
            {
                _byId[centre.Id] = new Remembered(centre.DisplayName, centre.Kind.ToString(), ut);
            }

            if (_byId.Count > Capacity)
            {
                var drop = _byId.OrderBy(p => p.Value.LastReachableUt).Take(_byId.Count - Capacity).Select(p => p.Key).ToList();
                foreach (var id in drop)
                {
                    _byId.Remove(id);
                }
            }
        }

        /// <summary>The remembered centres whose id is not in <paramref name="activeIds"/>, in ordinal id order.</summary>
        public List<UnreachableCentreEntry> Unreachable(ISet<string> activeIds) =>
            _byId
                .Where(p => !activeIds.Contains(p.Key))
                .OrderBy(p => p.Key, StringComparer.Ordinal)
                .Select(p => new UnreachableCentreEntry
                {
                    Id = p.Key,
                    DisplayName = p.Value.DisplayName,
                    Kind = p.Value.Kind,
                    LastReachableUt = p.Value.LastReachableUt,
                })
                .ToList();

        private readonly struct Remembered
        {
            public Remembered(string displayName, string kind, double lastReachableUt)
            {
                DisplayName = displayName;
                Kind = kind;
                LastReachableUt = lastReachableUt;
            }

            public string DisplayName { get; }

            public string Kind { get; }

            public double LastReachableUt { get; }
        }
    }
}
