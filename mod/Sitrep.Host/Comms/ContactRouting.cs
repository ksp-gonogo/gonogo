using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The <c>comms.route</c> rows: the earliest-arrival route each way between
    /// every command centre and the active craft, from the current contact plan,
    /// on the light times the game is set to model.
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
        /// <param name="lightFactor">What a real light time is multiplied by: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        public static CommsRoutes RoutesFor(
            ContactPlan plan, string activeCraft, IReadOnlyList<string> centres, double sentUt, double lightFactor = 1.0)
        {
            var routes = new CommsRoutes();
            foreach (var centre in centres)
            {
                if (string.Equals(centre, activeCraft, StringComparison.Ordinal))
                {
                    continue;
                }
                routes.Routes.Add(Row(plan, centre, activeCraft, sentUt, lightFactor));
                routes.Routes.Add(Row(plan, activeCraft, centre, sentUt, lightFactor));
            }
            return routes;
        }

        private static CommsRoute Row(ContactPlan plan, string from, string to, double sentUt, double lightFactor)
        {
            var route = ContactRouter.EarliestArrival(plan, from, to, sentUt, null, lightFactor);
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
