using System.Collections.Generic;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// One body in the hierarchy, as the chain walk needs it: what it orbits,
    /// on what elements, and how big it is to a radio wave.
    /// </summary>
    public readonly struct ChainBody
    {
        /// <param name="parentIndex">Index of the body this one orbits, or -1 for the root.</param>
        /// <param name="orbit">This body's elements about its parent. Null for the root.</param>
        public ChainBody(int parentIndex, OrbitElements? orbit, double occludingRadiusMeters)
        {
            ParentIndex = parentIndex;
            Orbit = orbit;
            OccludingRadiusMeters = occludingRadiusMeters;
        }

        public int ParentIndex { get; }

        public OrbitElements? Orbit { get; }

        public double OccludingRadiusMeters { get; }
    }

    /// <summary>
    /// Walks the body hierarchy between a station's body and a vessel's parent,
    /// producing the ordered links <see cref="OrbitToRemoteStationGeometry"/>
    /// sums.
    ///
    /// <para>Lifted out of the KSP-facing factory deliberately. It was
    /// previously expressed against <c>CelestialBody</c>, which meant the only
    /// way to exercise it was to launch the game — a ten-minute cycle per
    /// question, against logic whose failure mode is a plausible-looking wrong
    /// number. Expressed against indices and elements it is pure, and a wrong
    /// chain can be demonstrated in milliseconds.</para>
    ///
    /// <para>The walk goes UP from the station's body to the common ancestor,
    /// then DOWN to the vessel's parent. Both directions occur constantly: a
    /// craft at a moon of the station's planet only descends, while anything
    /// interplanetary must first climb to the star.</para>
    /// </summary>
    public static class PatchedConicChain
    {
        /// <summary>
        /// The links from <paramref name="stationBodyIndex"/> to
        /// <paramref name="vesselParentIndex"/>, nearest the station first, or
        /// null when no chain exists (different systems, or a malformed
        /// hierarchy). An empty list means the two are the same body.
        /// </summary>
        public static List<OrbitToRemoteStationGeometry.ChainLink> Between(
            int stationBodyIndex,
            int vesselParentIndex,
            IReadOnlyList<ChainBody> bodies)
        {
            var links = new List<OrbitToRemoteStationGeometry.ChainLink>();
            if (bodies == null
                || stationBodyIndex < 0 || stationBodyIndex >= bodies.Count
                || vesselParentIndex < 0 || vesselParentIndex >= bodies.Count)
            {
                return null;
            }
            if (stationBodyIndex == vesselParentIndex)
            {
                return links;
            }

            var stationBranch = AncestorsOf(stationBodyIndex, bodies);
            var vesselBranch = AncestorsOf(vesselParentIndex, bodies);
            if (stationBranch == null || vesselBranch == null)
            {
                return null;
            }

            var meetAt = -1;
            var ancestor = -1;
            for (var i = 0; i < stationBranch.Count && ancestor < 0; i++)
            {
                if (vesselBranch.Contains(stationBranch[i]))
                {
                    ancestor = stationBranch[i];
                    meetAt = i;
                }
            }
            if (ancestor < 0)
            {
                return null;
            }

            // Climb. An ascending link SUBTRACTS: the frame sits on the far
            // side of the body being climbed past, so its own orbit is walked
            // backwards. The link arrives at the body one step up, which is the
            // occluder that then sits at the accumulated position.
            for (var i = 0; i < meetAt; i++)
            {
                var body = bodies[stationBranch[i]];
                if (body.Orbit == null || body.ParentIndex < 0)
                {
                    return null;
                }
                links.Add(new OrbitToRemoteStationGeometry.ChainLink(
                    body.Orbit.Value,
                    bodies[body.ParentIndex].OccludingRadiusMeters,
                    descending: false));
            }

            // Descend, nearest the ancestor first.
            var descent = new List<int>();
            for (var i = 0; i < vesselBranch.Count && vesselBranch[i] != ancestor; i++)
            {
                descent.Add(vesselBranch[i]);
            }
            descent.Reverse();
            foreach (var index in descent)
            {
                var body = bodies[index];
                if (body.Orbit == null)
                {
                    return null;
                }
                links.Add(new OrbitToRemoteStationGeometry.ChainLink(
                    body.Orbit.Value, body.OccludingRadiusMeters, descending: true));
            }

            return links;
        }

        /// <summary>
        /// Whether every link can actually be propagated. The root body's
        /// stored elements are typically not an orbit at all (KSP gives the Sun
        /// <c>ecc = 1</c>, <c>sma = 0</c>), and feeding that to a Kepler solver
        /// throws rather than degrading.
        /// </summary>
        public static bool IsPropagatable(IReadOnlyList<OrbitToRemoteStationGeometry.ChainLink> links)
        {
            if (links == null) return false;
            foreach (var link in links)
            {
                if (link.Orbit.Ecc >= 1.0 || !(link.Orbit.Sma > 0.0) || !(link.Orbit.Mu > 0.0))
                {
                    return false;
                }
            }
            return true;
        }

        private static List<int> AncestorsOf(int index, IReadOnlyList<ChainBody> bodies)
        {
            var chain = new List<int>();
            var walker = index;
            var guard = bodies.Count + 1;
            while (walker >= 0 && guard-- > 0)
            {
                chain.Add(walker);
                walker = bodies[walker].ParentIndex;
            }
            return guard > 0 ? chain : null;
        }
    }
}
