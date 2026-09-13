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
    /// <item><b>Otherwise the first active ground station in ordinal id
    /// order.</b> A home that is not identified still leaves the operator at a
    /// real place rather than at a phantom one, and ordinal order picks the same
    /// station however the scene enumerates them. Nothing is marked home in this
    /// case: the roster says the home was not identified, and the engine logs
    /// it.</item>
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
        /// <param name="groundIds">The active centres that are ground stations, in any order.</param>
        /// <param name="home">The elected claimant's answer.</param>
        public static string Choose(
            ICollection<string> activeIds,
            IEnumerable<string> groundIds,
            HomeCommand home)
        {
            if (activeIds == null) throw new ArgumentNullException(nameof(activeIds));
            if (groundIds == null) throw new ArgumentNullException(nameof(groundIds));
            if (home == null) throw new ArgumentNullException(nameof(home));

            if (home.IsIdentified && activeIds.Contains(home.CentreId!))
            {
                return home.CentreId!;
            }

            string? first = null;
            foreach (var id in groundIds)
            {
                if (first == null || string.CompareOrdinal(id, first) < 0)
                {
                    first = id;
                }
            }

            return first ?? None;
        }
    }
}
