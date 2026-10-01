using System.Collections.Generic;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// One saved vessel as the launch-site rule sees it: where the save says it
    /// is landed, what it is called, and whether it is debris.
    /// </summary>
    internal readonly struct SiteVessel
    {
        public SiteVessel(string? landedAt, string? name, bool isDebris)
        {
            LandedAt = landedAt;
            Name = name;
            IsDebris = isDebris;
        }

        public string? LandedAt { get; }
        public string? Name { get; }
        public bool IsDebris { get; }
    }

    /// <summary>
    /// Whether a launch site is held, by the rule stock's launch admission uses.
    ///
    /// <para><c>PreFlightTests.LaunchSiteClear.Test</c> calls
    /// <c>ShipConstruction.FindVesselsLandedAt(flightState, site, ...)</c> over
    /// the save's vessel list. A vessel counts when its <c>landedAt</c> CONTAINS
    /// the site name (a substring test, not equality), whatever its situation.
    /// Debris never holds a site. Of several matches the reported one is the
    /// last non-debris vessel, or the first match when all are debris.</para>
    /// </summary>
    internal static class LaunchSiteOccupancy
    {
        /// <summary>
        /// The name of the vessel holding <paramref name="site"/>, or null when
        /// the site is clear. A holder with no name yields an empty string, so
        /// "held" and "clear" stay distinguishable.
        /// </summary>
        public static string? Holder(string? site, IEnumerable<SiteVessel> vessels)
        {
            if (string.IsNullOrEmpty(site) || vessels == null) return null;

            string? holder = null;
            foreach (var vessel in vessels)
            {
                if (vessel.LandedAt == null || !vessel.LandedAt.Contains(site)) continue;
                if (vessel.IsDebris) continue;
                holder = vessel.Name ?? "";
            }
            return holder;
        }
    }
}
