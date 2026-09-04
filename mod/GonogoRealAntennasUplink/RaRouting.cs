using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// RealAntennas' own route between two nodes, which is the ONLY router on an
    /// RA install that answers the way the game does.
    ///
    /// <para>RA replaces stock's pathfinding by overriding <c>FindClosestWhere</c>
    /// and nothing else. Stock's <c>FindHome</c> and
    /// <c>FindClosestControlSource</c> both call through it, which is why every
    /// vessel's <c>ControlPath</c> is RA-correct without anyone doing anything.
    /// <c>FindPath</c> is a SEPARATE stock method with its own
    /// <c>CreateShortestPathTree</c> walk, and RA does not touch it: verified
    /// against the shipped assembly, whose only overrides are Add,
    /// SetNodeConnection, TryConnect, Connect, PostUpdateNodes, UpdateNetwork,
    /// Rebuild and FindClosestWhere.</para>
    ///
    /// <para>So a two-node route is asked for as "the closest node that IS the
    /// destination". The predicate is what carries the destination, and it also
    /// does real work inside RA's gate: RA admits a neighbour to the frontier
    /// only when its receiving antenna clears <c>minRelayTL</c> OR the predicate
    /// already accepts it, so a below-minimum antenna can still be the END of a
    /// route while never carrying anyone else's traffic. That is exactly the
    /// distinction stock's solver cannot make, and on an RSS/RO career
    /// <c>minRelayTL</c> is 2, so it is not a corner case.</para>
    /// </summary>
    internal static class RaRouting
    {
        /// <summary>
        /// Ordered hop geometry, or null when RA will not route between the two
        /// nodes. Fail-soft: a torn-down node mid-solve is "no route" rather
        /// than an exception, which is the same graceful meaning and keeps a
        /// telemetry read from taking the uplink down.
        /// </summary>
        internal static IReadOnlyList<CommsRouteHop>? Between(object? from, object? to)
        {
            try
            {
                if (from is not CommNode start || to is not CommNode end || ReferenceEquals(start, end))
                {
                    return null;
                }

                var net = start.Net;
                if (net == null)
                {
                    return null;
                }

                var path = new CommPath();
                if (net.FindClosestWhere(start, path, (_, node) => ReferenceEquals(node, end)) == null)
                {
                    return null;
                }

                var hops = new List<CommsRouteHop>();
                foreach (var link in path)
                {
                    if (link?.a == null || link.b == null)
                    {
                        continue;
                    }
                    hops.Add(new CommsRouteHop(
                        (link.a.precisePosition - link.b.precisePosition).magnitude,
                        link.b.isHome || link.a.isHome));
                }
                return hops;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
