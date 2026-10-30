using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>The directions a whole route carries a signal in, from what each of its hops carries.</summary>
    public static class RouteDirection
    {
        /// <summary>
        /// The directions every hop of <paramref name="hops"/> carries. A route with
        /// no hop to judge carries both, and a route that was not found carries
        /// neither.
        /// </summary>
        /// <param name="hops">The hops of the route in the order it runs, or null when it was not found.</param>
        public static CommsDirection Of(IReadOnlyList<CommsRouteHop>? hops)
        {
            if (hops == null)
            {
                return CommsDirection.None;
            }
            var carried = CommsDirection.Both;
            foreach (var hop in hops)
            {
                carried &= hop.Carries;
            }
            return carried;
        }

        /// <summary>
        /// The directions <see cref="Of"/> leaves out only because a hop's rate
        /// could not be read: no hop is known not to carry them, and at least one
        /// is unread. A route that was not found has none.
        /// </summary>
        /// <param name="hops">The hops of the route in the order it runs, or null when it was not found.</param>
        public static CommsDirection Unknown(IReadOnlyList<CommsRouteHop>? hops)
        {
            if (hops == null)
            {
                return CommsDirection.None;
            }
            var broken = CommsDirection.None;
            var unread = CommsDirection.None;
            foreach (var hop in hops)
            {
                unread |= hop.Unread;
                broken |= CommsDirection.Both & ~hop.Carries & ~hop.Unread;
            }
            return unread & ~broken;
        }

        /// <summary>The same route read from its last node back to its first.</summary>
        public static CommsDirection Flip(CommsDirection carried) =>
            (carried.HasFlag(CommsDirection.Forward) ? CommsDirection.Reverse : CommsDirection.None)
            | (carried.HasFlag(CommsDirection.Reverse) ? CommsDirection.Forward : CommsDirection.None);
    }
}
