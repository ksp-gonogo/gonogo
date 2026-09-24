using System;
using System.Linq;
using Gonogo.KSP.CommandCentres;
using Sitrep.Host;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Where a command centre stands relative to a launch site, for the
    /// proximity rule on <c>ksp.launch</c>.
    ///
    /// <para>The light-time is a STRAIGHT LINE from the centre to the site's
    /// spawn point, which is a lower bound on any routed delay between them and
    /// so errs permissive: a launch site is not a comms node, so no backend can
    /// route to it, and every route between two places is a chain of straight
    /// hops whose total cannot be shorter than the line itself. A vantage the
    /// line puts beyond the limit is beyond it by any route.</para>
    ///
    /// <para>Measured at the configured light-speed scale whether or not delay is
    /// switched on, so the rule does not change with a setting about timing.</para>
    ///
    /// <para>Main-thread only: it enumerates the live centres and reads the
    /// site's body.</para>
    /// </summary>
    internal static class LaunchSiteProximity
    {
        internal static LaunchSiteReach Between(string vantage, string siteName)
        {
            try
            {
                return Read(vantage, siteName);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] LaunchSiteProximity failed (refusing as unread): " + ex.Message);
                return LaunchSiteReach.Unread(vantage, siteName);
            }
        }

        private static LaunchSiteReach Read(string vantage, string siteName)
        {
            var config = CommsCoreUplink.SignalDelayConfig;
            if (config != null && config.CutForNoCommsModel)
            {
                return LaunchSiteReach.Unconstrained();
            }

            var site = FindSite(siteName);
            var siteLabel = site != null ? SiteDisplayName(site, siteName) : siteName;

            var centre = CommsCoreUplink.CommandCentres?.EnumerateActive()
                .OfType<KspCommandCentre>()
                .FirstOrDefault(c => c.Id == vantage);
            if (centre == null)
            {
                return LaunchSiteReach.NoPlace(vantage, siteLabel);
            }

            var centreLabel = string.IsNullOrEmpty(centre.DisplayName) ? centre.Id : centre.DisplayName;
            if (site == null)
            {
                return LaunchSiteReach.NoSuchSite(centreLabel, siteName);
            }

            var effectiveC = SignalDelay.EffectiveC(config);
            if (effectiveC == null || !TrySpawnPosition(site, out var position))
            {
                return LaunchSiteReach.SiteUnplaced(centreLabel, siteLabel);
            }

            return LaunchSiteReach.Measured(centreLabel, siteLabel, (centre.Position - position).magnitude / effectiveC.Value);
        }

        private static LaunchSite? FindSite(string siteName)
        {
            var sites = PSystemSetup.Instance?.LaunchSites;
            if (sites == null || string.IsNullOrEmpty(siteName))
            {
                return null;
            }
            return sites.FirstOrDefault(s => s != null && s.name == siteName);
        }

        private static string SiteDisplayName(LaunchSite site, string siteName)
        {
            try
            {
                var shown = PSystemSetup.Instance?.GetLaunchSiteDisplayName(siteName);
                return string.IsNullOrEmpty(shown) ? (site.launchSiteName ?? siteName) : shown!;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] LaunchSiteProximity could not read a site's display name: " + ex.Message);
                return siteName;
            }
        }

        /// <summary>
        /// Where a launch from this site spawns, in the same world frame
        /// <see cref="KspCommandCentre.Position"/> is in. The spawn point's own
        /// surface coordinate first; where the game has not set one, the spawn
        /// point's transform, then the site's own. False only when the site has
        /// none of the three, which leaves nothing to measure to.
        /// </summary>
        private static bool TrySpawnPosition(LaunchSite site, out Vector3d position)
        {
            position = Vector3d.zero;
            if (site.Body == null)
            {
                return false;
            }
            if (site.spawnPoints != null)
            {
                foreach (var spawn in site.spawnPoints)
                {
                    if (spawn != null && spawn.latlonaltSet)
                    {
                        position = site.Body.GetWorldSurfacePosition(spawn.latitude, spawn.longitude, spawn.altitude);
                        return true;
                    }
                }
                foreach (var spawn in site.spawnPoints)
                {
                    var transform = spawn?.GetSpawnPointTransform();
                    if (transform != null)
                    {
                        position = transform.position;
                        return true;
                    }
                }
            }
            if (site.launchSiteTransform != null)
            {
                position = site.launchSiteTransform.position;
                return true;
            }
            return false;
        }
    }
}
