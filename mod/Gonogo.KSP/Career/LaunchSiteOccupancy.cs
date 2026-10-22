using System.Collections.Generic;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// One saved vessel as the launch-site rule sees it: where the save says it
    /// is landed, what it is called, and whether it is debris.
    /// </summary>
    internal readonly struct SiteVessel
    {
        public SiteVessel(string? landedAt, string? name, bool isDebris, string? id = null)
        {
            LandedAt = landedAt;
            Name = name;
            IsDebris = isDebris;
            Id = id;
        }

        public string? LandedAt { get; }
        public string? Name { get; }
        public bool IsDebris { get; }

        /// <summary>The vessel's <c>Vessel.id</c> guid as a string, the id the vessel commands take.</summary>
        public string? Id { get; }
    }

    /// <summary>
    /// Whether a launch site is held, by the rule stock's launch admission uses.
    ///
    /// <para><c>PreFlightTests.LaunchSiteClear.Test</c> calls
    /// <c>ShipConstruction.FindVesselsLandedAt(flightState, site, ...)</c> over
    /// the save's vessel list. A vessel counts when its <c>landedAt</c> contains
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
            var holder = HolderVessel(site, vessels);
            return holder == null ? null : holder.Value.Name ?? "";
        }

        /// <summary>
        /// The id of the vessel <see cref="Holder"/> names, or null when the
        /// site is clear or the holder carries no id.
        /// </summary>
        public static string? HolderId(string? site, IEnumerable<SiteVessel> vessels) =>
            HolderVessel(site, vessels)?.Id;

        private static SiteVessel? HolderVessel(string? site, IEnumerable<SiteVessel> vessels)
        {
            if (string.IsNullOrEmpty(site) || vessels == null) return null;

            SiteVessel? holder = null;
            foreach (var vessel in vessels)
            {
                if (vessel.LandedAt == null || !vessel.LandedAt.Contains(site)) continue;
                if (vessel.IsDebris) continue;
                holder = vessel;
            }
            return holder;
        }
    }
}
