using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The <c>comms.route</c> rows: the earliest-arrival route each way between
    /// every command centre and the active craft, from the current contact plan.
    /// </summary>
    public static class ContactRouting
    {
        /// <summary>
        /// Both directions between each of <paramref name="centres"/> and
        /// <paramref name="activeCraft"/> for a message sent at
        /// <paramref name="sentUt"/>, the centre-to-craft row first in each pair.
        /// A centre that is the active craft itself has no route to plan and gets
        /// no row.
        /// </summary>
        public static CommsRoutes RoutesFor(ContactPlan plan, string activeCraft, IReadOnlyList<string> centres, double sentUt)
        {
            var routes = new CommsRoutes();
            foreach (var centre in centres)
            {
                if (string.Equals(centre, activeCraft, StringComparison.Ordinal))
                {
                    continue;
                }
                routes.Routes.Add(Row(plan, centre, activeCraft, sentUt));
                routes.Routes.Add(Row(plan, activeCraft, centre, sentUt));
            }
            return routes;
        }

        /// <summary>
        /// The rows a session at <paramref name="viewer"/>'s vantage may see: those
        /// that start or end there. Another centre's routes say where it can reach,
        /// which this vantage has no way to know. A session aboard the active craft
        /// sees none, since every row ends at it and all of them are other centres'.
        /// </summary>
        public static object? ForViewer(object payload, ViewerContext viewer)
        {
            if (!(payload is CommsRoutes routes))
            {
                return payload;
            }
            var mine = new CommsRoutes();
            if (routes.Routes.Count > 0 && string.Equals(routes.Routes[0].To, viewer.Vantage, StringComparison.Ordinal))
            {
                return mine;
            }
            foreach (var route in routes.Routes)
            {
                if (string.Equals(route.From, viewer.Vantage, StringComparison.Ordinal)
                    || string.Equals(route.To, viewer.Vantage, StringComparison.Ordinal))
                {
                    mine.Routes.Add(route);
                }
            }
            return mine;
        }

        private static CommsRoute Row(ContactPlan plan, string from, string to, double sentUt)
        {
            var route = ContactRouter.EarliestArrival(plan, from, to, sentUt);
            var row = new CommsRoute
            {
                From = from,
                To = to,
                SentUt = sentUt,
                ArrivalUt = route?.ArrivalUt,
                Live = route != null && route.Live,
            };
            if (route == null)
            {
                return row;
            }
            var at = sentUt;
            foreach (var hop in route.Hops)
            {
                if (hop.DepartUt > at + HoldTolerance)
                {
                    row.Holds.Add(new CommsRouteHold { At = hop.From, ArriveUt = at, DepartUt = hop.DepartUt });
                }
                at = hop.ArriveUt;
            }
            return row;
        }

        /// <summary>Waits shorter than this are rounding, not holds.</summary>
        private const double HoldTolerance = 1e-6;
    }
}
