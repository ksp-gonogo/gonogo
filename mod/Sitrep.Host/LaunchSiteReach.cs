namespace Sitrep.Host
{
    /// <summary>
    /// How a sending vantage stands relative to the launch site a launch names:
    /// what <see cref="FlightOpsCommandProvider.HandleLaunch"/> decides a launch's
    /// proximity from.
    /// </summary>
    public sealed class LaunchSiteReach
    {
        public enum Standing
        {
            /// <summary>Both ends placed; <see cref="Seconds"/> is the one-way light-time between them.</summary>
            Measured,

            /// <summary>The save models no comms network, so there is no light-time between any two places.</summary>
            Unconstrained,

            /// <summary>The vantage is not an active command centre, so it stands nowhere.</summary>
            NoPlace,

            /// <summary>No launch site answers to the name.</summary>
            NoSuchSite,

            /// <summary>The site exists but has no placed spawn point to measure to.</summary>
            SiteUnplaced,

            /// <summary>Reading either end threw, so nothing was established.</summary>
            Unread,
        }

        private LaunchSiteReach(Standing kind, string vantageName, string siteName, double seconds)
        {
            Kind = kind;
            VantageName = vantageName;
            SiteName = siteName;
            Seconds = seconds;
        }

        public Standing Kind { get; }

        /// <summary>The vantage's display name, or its id when it has none to give.</summary>
        public string VantageName { get; }

        /// <summary>The site's display name, or the name it was asked by when it has none to give.</summary>
        public string SiteName { get; }

        /// <summary>One-way light-seconds between the two. Meaningful only when <see cref="Kind"/> is <see cref="Standing.Measured"/>.</summary>
        public double Seconds { get; }

        public static LaunchSiteReach Measured(string vantageName, string siteName, double seconds) =>
            new LaunchSiteReach(Standing.Measured, vantageName, siteName, seconds);

        public static LaunchSiteReach Unconstrained() =>
            new LaunchSiteReach(Standing.Unconstrained, "", "", 0.0);

        public static LaunchSiteReach NoPlace(string vantage, string siteName) =>
            new LaunchSiteReach(Standing.NoPlace, vantage, siteName, 0.0);

        public static LaunchSiteReach NoSuchSite(string vantageName, string site) =>
            new LaunchSiteReach(Standing.NoSuchSite, vantageName, site, 0.0);

        public static LaunchSiteReach Unread(string vantage, string site) =>
            new LaunchSiteReach(Standing.Unread, vantage, site, 0.0);

        public static LaunchSiteReach SiteUnplaced(string vantageName, string siteName) =>
            new LaunchSiteReach(Standing.SiteUnplaced, vantageName, siteName, 0.0);
    }
}
