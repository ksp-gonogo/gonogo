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
    ///
    /// <para>The way to the craft is a command's: any node holding it may turn
    /// an idle dish to send it on. The way back is a reply's, which only the
    /// craft turns a dish for, as the delivery network sends each.</para>
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
        /// <param name="home">The home centre, or null.</param>
        /// <param name="antennas">Every ground station, each of which is the home centre's own antenna: see <see cref="GroundNetwork"/>.</param>
        /// <param name="retarget">How a route may use the plan's retarget windows, or null to route on the dishes' own aims alone.</param>
        public static CommsRoutes RoutesFor(
            ContactPlan plan,
            string activeCraft,
            IReadOnlyList<string> centres,
            double sentUt,
            double lightFactor = 1.0,
            string? home = null,
            IReadOnlyCollection<string>? antennas = null,
            RetargetRouting? retarget = null)
        {
            var routes = new CommsRoutes();
            foreach (var centre in centres)
            {
                if (string.Equals(centre, activeCraft, StringComparison.Ordinal))
                {
                    continue;
                }
                routes.Routes.Add(Row(plan, centre, activeCraft, sentUt, lightFactor, home, antennas, retarget?.WithOnTheWay(true)));
                routes.Routes.Add(Row(plan, activeCraft, centre, sentUt, lightFactor, home, antennas, retarget?.WithOnTheWay(false)));
            }
            return routes;
        }

        private static CommsRoute Row(
            ContactPlan plan, string from, string to, double sentUt, double lightFactor, string? home, IReadOnlyCollection<string>? antennas, RetargetRouting? retarget)
        {
            var route = ContactRouter.EarliestArrivalBetween(
                plan, GroundNetwork.EndsOf(from, home, antennas), GroundNetwork.EndsOf(to, home, antennas), sentUt, null, lightFactor, retarget);
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
                    // A message waiting for one of home's antennas to have a window is waiting at home.
                    var waitsAt = hop.From == route.Source ? from : hop.From;
                    row.Holds.Add(new CommsRouteHold { At = waitsAt, ArriveUt = at, DepartUt = hop.DepartUt });
                }
                at = hop.ArriveUt;
            }
            return row;
        }

        /// <summary>Waits shorter than this are rounding, not holds.</summary>
        private const double HoldTolerance = 1e-6;
    }
}
