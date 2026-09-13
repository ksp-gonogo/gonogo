using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// One CommNet home as <see cref="HomeCentreIds.Mint"/> and the stock home-command
    /// claimant see it: its name, the game's own space-centre flag, and the station's
    /// position, which only ever breaks a tie between two homes that share a name.
    /// </summary>
    public readonly struct HomeNodeFacts
    {
        public HomeNodeFacts(bool isKsc, string? nodeName, double? latitude = null, double? longitude = null)
        {
            IsKsc = isKsc;
            NodeName = nodeName;
            Latitude = latitude;
            Longitude = longitude;
        }

        /// <summary>
        /// The home's own <c>CommNetHome.isKSC</c> flag, as the game reports it. Read by
        /// <see cref="StockHomeCommandProvider"/> alone: an id never depends on it.
        /// </summary>
        public bool IsKsc { get; }

        /// <summary>The home's <c>CommNetHome.nodeName</c>; null reads as <c>"unknown"</c>.</summary>
        public string? NodeName { get; }

        public double? Latitude { get; }

        public double? Longitude { get; }
    }

    /// <summary>
    /// Mints the command-centre id of every CommNet home in one pass, so that no
    /// two homes can ever share one.
    ///
    /// <para>Every home is <c>ground:&lt;nodeName&gt;</c>, the space centre
    /// included. Which of them is home is the elected home-command claimant's
    /// answer, published beside the id, so stock and a career overhaul differ only
    /// in which claimant answers and never in what a station is called.</para>
    ///
    /// <para>Two homes whose names would mint the same id are told apart with a
    /// <c>#&lt;n&gt;</c> suffix from 2 upwards, handed out by position so the same
    /// station keeps the same suffix from one pass to the next however the scene
    /// happens to enumerate them. A suffix never takes an id another home mints
    /// on its own name.</para>
    /// </summary>
    public static class HomeCentreIds
    {
        public const string GroundPrefix = "ground:";

        /// <summary>The ids for <paramref name="homes"/>, index for index.</summary>
        public static string[] Mint(IReadOnlyList<HomeNodeFacts> homes)
        {
            var bare = new string[homes.Count];
            for (var i = 0; i < homes.Count; i++)
            {
                bare[i] = GroundPrefix + (homes[i].NodeName ?? "unknown");
            }

            var reserved = new HashSet<string>(bare, StringComparer.Ordinal);
            var taken = new HashSet<string>(StringComparer.Ordinal);
            var ids = new string[homes.Count];
            var order = Enumerable.Range(0, homes.Count)
                .OrderBy(i => bare[i], StringComparer.Ordinal)
                .ThenBy(i => homes[i].Latitude ?? double.MaxValue)
                .ThenBy(i => homes[i].Longitude ?? double.MaxValue)
                .ThenBy(i => i);

            foreach (var i in order)
            {
                if (taken.Add(bare[i]))
                {
                    ids[i] = bare[i];
                    continue;
                }

                var n = 2;
                string candidate;
                do
                {
                    candidate = bare[i] + "#" + n;
                    n++;
                }
                while (reserved.Contains(candidate) || taken.Contains(candidate));

                taken.Add(candidate);
                ids[i] = candidate;
            }

            return ids;
        }
    }
}
