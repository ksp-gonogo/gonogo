using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// One CommNet home as <see cref="HomeCentreIds.Mint"/> sees it: the two facts
    /// its id is built from, plus the station's position, which only ever breaks a
    /// tie between two homes that share a name.
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

        /// <summary>The home's own <c>CommNetHome.isKSC</c> flag, as the game reports it.</summary>
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
    /// <para><c>isKSC</c> names the home only when exactly one home carries it,
    /// which is stock CommNet: that home is <see cref="Ksc"/> and every other is
    /// <c>ground:&lt;nodeName&gt;</c>. A comms mod can set the flag on every
    /// station it configures, and a flag every station carries identifies none of them,
    /// so when more than one home carries it (or none does) NO home is minted
    /// <see cref="Ksc"/>. Picking which of those stations is home is a decision
    /// this function deliberately does not make.</para>
    ///
    /// <para>Two homes whose names would mint the same id are told apart with a
    /// <c>#&lt;n&gt;</c> suffix from 2 upwards, handed out by position so the same
    /// station keeps the same suffix from one pass to the next however the scene
    /// happens to enumerate them. A suffix never takes an id another home mints
    /// on its own name.</para>
    /// </summary>
    public static class HomeCentreIds
    {
        public const string Ksc = "ksc";
        public const string GroundPrefix = "ground:";

        /// <summary>The ids for <paramref name="homes"/>, index for index.</summary>
        public static string[] Mint(IReadOnlyList<HomeNodeFacts> homes)
        {
            var kscIndex = SoleKscIndex(homes);
            var bare = new string[homes.Count];
            for (var i = 0; i < homes.Count; i++)
            {
                bare[i] = i == kscIndex ? Ksc : GroundPrefix + (homes[i].NodeName ?? "unknown");
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

        private static int SoleKscIndex(IReadOnlyList<HomeNodeFacts> homes)
        {
            var found = -1;
            for (var i = 0; i < homes.Count; i++)
            {
                if (!homes[i].IsKsc)
                {
                    continue;
                }

                if (found >= 0)
                {
                    return -1;
                }

                found = i;
            }

            return found;
        }
    }
}
