using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// A solved route as the hops <c>comms.path</c> carries, so the path a centre
    /// is shown and the delay it is priced by are one list.
    /// </summary>
    public static class ActiveRoute
    {
        /// <summary>
        /// The route's hops with their ends named, or null where the route has
        /// no hop or a hop cannot be told apart from its neighbours: a route that
        /// cannot be shown is none, never a path of nameless hops.
        /// </summary>
        /// <param name="route">The backend's hops, each carrying its two node handles.</param>
        /// <param name="nameOf">The id and home-ness of the node a handle wraps, or null for a node it cannot name.</param>
        public static IReadOnlyList<CommsHop>? Hops(
            IReadOnlyList<CommsRouteHop>? route,
            Func<CommsNodeHandle?, (string Id, bool IsHome)?> nameOf)
        {
            if (route == null || route.Count == 0)
            {
                return null;
            }

            var hops = new List<CommsHop>(route.Count);
            foreach (var hop in route)
            {
                var from = nameOf(hop.FromHandle);
                var to = nameOf(hop.ToHandle);
                if (from == null || to == null)
                {
                    return null;
                }

                hops.Add(new CommsHop
                {
                    From = from.Value.Id,
                    To = to.Value.Id,
                    FromIsHome = from.Value.IsHome,
                    ToIsHome = to.Value.IsHome,
                    Kind = hop.TouchesHome ? CommsHopKind.Home : CommsHopKind.Relay,
                    DistanceMeters = hop.DistanceMeters,
                });
            }
            return hops;
        }
    }
}
