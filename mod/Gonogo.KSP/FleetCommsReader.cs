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
    /// <see cref="ReadNodePath"/> measures a route between ANY two nodes, asked
    /// of the ELECTED BACKEND rather than solved here. Both hand their hops to
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
        /// Routed one-way light-time between two arbitrary comms nodes, or null
        /// when the ELECTED BACKEND does not route between them. Unlike
        /// <see cref="ReadVessel"/>, which can only ever answer "how far is this
        /// vessel from home", this is a route between a named start and a named
        /// end, which is what a command centre addressing another centre (or a
        /// subject that is not its own home) needs.
        ///
        /// <para><b>The route is the BACKEND's, never stock's.</b> This used to
        /// call <c>CommNetwork.FindPath</c> itself, on the stated premise that
        /// "RealAntennas overrides only link CONSTRUCTION, never the pathfinder".
        /// That premise was false and it hid a live wrong number for as long as
        /// it stood. RA overrides <c>FindClosestWhere</c>, not <c>FindPath</c>.
        /// <c>FindHome</c> and <c>FindClosestControlSource</c> both call through
        /// <c>FindClosestWhere</c>, which is why a vessel's <c>ControlPath</c>
        /// (and therefore <c>comms.delay</c>) is RA-correct with nobody doing
        /// anything, and why the two look interchangeable. They are not:
        /// <c>FindPath</c> has its own <c>CreateShortestPathTree</c> walk that RA
        /// never touches, so it solved RA's link set by STOCK's rules, which know
        /// nothing of RA's minimum relay tech level (2 on an RSS/RO career) and
        /// nothing of its directional forward/reverse link costs. The delay that
        /// came back was a real light-time over real links, and it was measured
        /// along a route the game itself refuses to carry.</para>
        ///
        /// <para>So the question goes to <see cref="ICommsBackend.RouteBetween"/>,
        /// the same way occlusion geometry goes to
        /// <see cref="ICommsBackend.OcclusionModel"/>: each backend routes in its
        /// own terms, and core measures whatever comes back.</para>
        ///
        /// <para>Null covers every not-a-number case and never collapses to
        /// zero: no elected backend, a missing node, the same node at both ends
        /// (a path to yourself is not a route), and an unreachable end. A caller
        /// that wants "no delay because it is the same place" has to say so
        /// itself.</para>
        /// </summary>
        internal static double? ReadNodePath(
            ICommsBackend? backend,
            CommNode? from,
            CommNode? to,
            SignalDelayConfig? config)
        {
            try
            {
                if (backend == null || from == null || to == null || ReferenceEquals(from, to))
                {
                    return null;
                }

                // Quality is meta-only and discarded here (see RoutedPathDelay):
                // a node-to-node path has no on-rails/loaded state of its own.
                return RoutedPathDelay.OneWaySeconds(backend.RouteBetween(from, to), config, Quality.Loaded);
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
        private static List<CommsRouteHop> ToHops(IEnumerable<CommLink>? path)
        {
            var hops = new List<CommsRouteHop>();
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
                hops.Add(new CommsRouteHop(
                    (link.a.precisePosition - link.b.precisePosition).magnitude,
                    link.b.isHome || link.a.isHome));
            }
            return hops;
        }
    }
}
