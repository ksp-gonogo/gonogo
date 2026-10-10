using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// The route the active craft's samples actually take to each centre,
    /// the home centre included: the hops of the game's own solved route, the same ones the
    /// delay ledger times by.
    ///
    /// <para>Off <c>IUplinkHost</c> because its only writer is gonogo's own
    /// command-centre pass, which already references this assembly.</para>
    /// </summary>
    public interface IActiveRouteHost
    {
        /// <summary>
        /// Replace the whole set. Each key is a centre as a vantage; a centre
        /// with no route is left out, never listed with no hops.
        /// </summary>
        void SetActiveVesselRoutes(IReadOnlyDictionary<string, IReadOnlyList<CommsHop>> routes);

        /// <summary>The hops of the route the active craft's samples take to <paramref name="centre"/>, or null when none is known.</summary>
        IReadOnlyList<CommsHop>? ActiveVesselRoute(string centre);
    }
}
