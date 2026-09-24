using System;
using System.Linq;
using Gonogo.KSP.CommandCentres;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// One-way light-time from a command centre to a launch site, for the
    /// proximity rule on <c>ksp.launch</c>.
    ///
    /// <para>Straight-line, not routed: the question is how close the vantage
    /// stands to the pad, which a relay chain would only lengthen. Measured at
    /// the configured light-speed scale whether or not delay is switched on, so
    /// the rule does not change with a setting that is about timing.</para>
    ///
    /// <para>Main-thread only: it enumerates the live centres and reads the
    /// site's body.</para>
    /// </summary>
    internal static class LaunchSiteProximity
    {
        /// <summary>
        /// Null when the vantage is not an active centre, the site does not
        /// resolve to a placed spawn point, or the scale cannot give a
        /// light-time.
        /// </summary>
        internal static double? SecondsBetween(string vantage, string siteName)
        {
            try
            {
                var effectiveC = SignalDelay.EffectiveC(CommsCoreUplink.SignalDelayConfig);
                var registry = CommsCoreUplink.CommandCentres;
                if (effectiveC == null || registry == null || string.IsNullOrEmpty(vantage))
                {
                    return null;
                }

                var centre = registry.EnumerateActive()
                    .OfType<KspCommandCentre>()
                    .FirstOrDefault(c => c.Id == vantage);
                if (centre == null || !TrySitePosition(siteName, out var site))
                {
                    return null;
                }

                return (centre.Position - site).magnitude / effectiveC.Value;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] LaunchSiteProximity failed (treating as unmeasured): " + ex.Message);
                return null;
            }
        }

        private static bool TrySitePosition(string siteName, out Vector3d position)
        {
            position = Vector3d.zero;
            var sites = PSystemSetup.Instance?.LaunchSites;
            if (sites == null || string.IsNullOrEmpty(siteName))
            {
                return false;
            }

            foreach (var site in sites)
            {
                if (site == null || site.name != siteName || site.Body == null || site.spawnPoints == null)
                {
                    continue;
                }
                foreach (var spawn in site.spawnPoints)
                {
                    if (spawn != null && spawn.latlonaltSet)
                    {
                        position = site.Body.GetWorldSurfacePosition(spawn.latitude, spawn.longitude, spawn.altitude);
                        return true;
                    }
                }
            }
            return false;
        }
    }
}
