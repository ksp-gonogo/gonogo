using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Where a connection that has never chosen a vantage observes from and
    /// dispatches from.
    ///
    /// <list type="number">
    /// <item><b>Home</b>, when the home-command claimant names a centre that is
    /// active.</item>
    /// <item><b>Otherwise the active ground station nearest the space
    /// centre.</b> A home that is not identified still leaves the operator at a
    /// real place rather than at a phantom one, and the place the career is
    /// actually run from is the best evidence of which station that is. Where
    /// no position is known for the space centre or for a station, ordinal id
    /// order breaks the tie, which picks the same station however the scene
    /// enumerates them. The roster marks the stand-in home with
    /// <see cref="CommandCentreEntry.IsHomeFallback"/> set, so a client can show
    /// it as home and still say it stands in, and the engine logs it.</item>
    /// <item><b>Otherwise <see cref="None"/></b>, which is the main menu: no
    /// centre exists to stand at, and every delay falls through to its node
    /// default.</item>
    /// </list>
    /// </summary>
    public static class FreshConnectionVantage
    {
        /// <summary>No command centre is active, so a connection is at none.</summary>
        public const string None = "";

        /// <param name="activeIds">Every active centre's id.</param>
        /// <param name="ground">The active centres that are ground stations, in any order.</param>
        /// <param name="home">The elected claimant's answer.</param>
        /// <param name="spaceCentre">Where the space centre stands, or null when it is not known.</param>
        public static string Choose(
            ICollection<string> activeIds,
            IEnumerable<GroundSite> ground,
            HomeCommand home,
            SurfaceSite? spaceCentre)
        {
            if (activeIds == null) throw new ArgumentNullException(nameof(activeIds));
            if (ground == null) throw new ArgumentNullException(nameof(ground));
            if (home == null) throw new ArgumentNullException(nameof(home));

            if (home.IsIdentified && activeIds.Contains(home.CentreId!))
            {
                return home.CentreId!;
            }

            string? best = null;
            var bestAngle = double.PositiveInfinity;
            foreach (var station in ground)
            {
                var angle = spaceCentre.HasValue && station.Site.HasValue
                    ? spaceCentre.Value.AngleTo(station.Site.Value)
                    : double.PositiveInfinity;
                if (best == null
                    || angle < bestAngle
                    || (angle == bestAngle && string.CompareOrdinal(station.Id, best) < 0))
                {
                    best = station.Id;
                    bestAngle = angle;
                }
            }

            return best ?? None;
        }
    }
}
