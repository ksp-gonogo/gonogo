using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Routed comms reads over the live CommNet graph. Two entry points, one
    /// primitive: <see cref="ReadVessel"/> reads a vessel's own solved path home
    /// (the graph KSP already maintains for every vessel, loaded or not), and
    /// <see cref="ReadNodePath"/> solves a path between ANY two nodes. Both map
    /// the resulting links through <see cref="ToHops"/> and hand them to
    /// <see cref="RoutedPathDelay"/>, so a vessel's light-time and a
    /// centre-to-centre light-time are computed by the same arithmetic.
    ///
    /// <para>THREADING: reads live KSP state, MAIN-THREAD only (the capture half
    /// of the fleet <c>AddSampledSource</c>).</para>
    /// </summary>
    internal static class FleetCommsReader
    {
        /// <summary>
        /// Routed one-way light-time (null = no measurable path) + connectivity
        /// for a single vessel. Fail-soft: any torn-down-state throw yields
        /// (null, false), the correct "no live link" meaning.
        /// </summary>
        internal static (double? OneWaySeconds, bool Connected) ReadVessel(Vessel vessel, SignalDelayConfig config)
        {
            try
            {
                if (vessel == null)
                {
                    return (null, false);
                }

                var conn = vessel.connection;
                if (conn == null)
                {
                    return (null, false);
                }

                // A null ControlPath is an EMPTY path, not an ABSENT one: the
                // vessel has a connection object, there is simply nothing on it
                // to measure. That distinction is what the nullable hop list
                // carries, and it is why this passes an empty list rather than
                // null (which would mean "unroutable" and is a different claim).
                var quality = vessel.loaded ? Quality.Loaded : Quality.OnRails;
                var oneWay = RoutedPathDelay.OneWaySeconds(ToHops(conn.ControlPath), config, quality);
                return (oneWay, conn.IsConnected);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] FleetCommsReader.ReadVessel failed (treating as no path): " + ex.Message);
                return (null, false);
            }
        }

        /// <summary>
        /// Routed one-way light-time between two arbitrary CommNet nodes, or
        /// null when they are not routable to each other. Unlike
        /// <see cref="ReadVessel"/>, which can only ever answer "how far is this
        /// vessel from home", this solves the graph between a named start and a
        /// named end, which is what a command centre addressing another centre
        /// (or a subject that is not its own home) needs.
        ///
        /// <para>Stock's <c>CommNetwork.FindPath</c> runs Dijkstra from
        /// <paramref name="from"/> over the network's whole node list and walks
        /// back from <paramref name="to"/>, so it is not vessel-rooted and needs
        /// no special casing for a ground-station start. RealAntennas overrides
        /// only link CONSTRUCTION, never the pathfinder, so this reads RA's link
        /// set through stock's solver unmodified.</para>
        ///
        /// <para>Null covers every not-a-number case and never collapses to
        /// zero: a missing node, the same node at both ends (a path to yourself
        /// is not a route), and an unreachable end. A caller that wants "no
        /// delay because it is the same place" has to say so itself.</para>
        /// </summary>
        internal static double? ReadNodePath(CommNode? from, CommNode? to, SignalDelayConfig? config)
        {
            try
            {
                if (from == null || to == null || ReferenceEquals(from, to))
                {
                    return null;
                }

                var net = from.Net;
                if (net == null)
                {
                    return null;
                }

                var path = new CommPath();
                if (!net.FindPath(from, path, to))
                {
                    return null;
                }

                // Quality is meta-only and discarded here (see RoutedPathDelay):
                // a node-to-node path has no on-rails/loaded state of its own.
                return RoutedPathDelay.OneWaySeconds(ToHops(path), config, Quality.Loaded);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] FleetCommsReader.ReadNodePath failed (treating as no path): " + ex.Message);
                return null;
            }
        }

        /// <summary>
        /// The solved links of a path as measured hops. A null path is an empty
        /// hop list, not a null one: only the caller knows whether "no links"
        /// means unroutable. Links with a torn-down endpoint are skipped rather
        /// than contributing a zero-length hop.
        /// </summary>
        private static List<RoutedHop> ToHops(IEnumerable<CommLink>? path)
        {
            var hops = new List<RoutedHop>();
            if (path == null)
            {
                return hops;
            }

            foreach (var link in path)
            {
                if (link?.a == null || link.b == null)
                {
                    continue;
                }
                hops.Add(new RoutedHop(
                    (link.a.precisePosition - link.b.precisePosition).magnitude,
                    link.b.isHome || link.a.isHome));
            }
            return hops;
        }
    }
}
