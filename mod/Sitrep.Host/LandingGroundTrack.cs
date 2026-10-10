using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free geometry for the ground-track terrain strip on
    /// <c>vessel.landing</c>: where along the ground track the capture reads terrain
    /// height. The strip is the footprint of <see cref="LandingCone"/> along the
    /// vessel's line of travel, sampled at a fixed number of points, so the spacing
    /// is finer the narrower the footprint, which narrows as the vessel comes down.
    ///
    /// <para>The number of samples is fixed and small, which is the cost bound on
    /// the PQS reads the capture makes each tick.</para>
    /// </summary>
    public static class LandingGroundTrack
    {
        /// <summary>Terrain reads taken along the track each tick; the ceiling on this channel's PQS cost.</summary>
        public const int SampleCount = 48;

        /// <summary>The least ground the strip covers, metres, so a vessel about to touch down still gets terrain to read.</summary>
        public const double MinExtentMeters = 200.0;

        /// <summary>The least ground the strip holds either side of the point beneath the vessel, metres.</summary>
        public const double MinMarginMeters = 120.0;

        /// <summary>How much of the predicted site's distance the strip carries past the site, as a fraction, so a window around the craft and the site is covered end to end.</summary>
        public const double SiteReachFraction = 0.1;

        /// <summary>
        /// The stretch of ground the strip covers, metres from the point beneath the
        /// vessel (negative behind): the cone's footprint, widened so it always holds
        /// the ground directly beneath the vessel and a margin of one vessel height
        /// either side of it, and the predicted site with a tenth of its distance
        /// beyond. A shallow approach's cone meets the ground only ahead of the craft;
        /// without the widening the ground under the craft would be missing from the
        /// strip. A vessel about to touch down is held to <see cref="MinMarginMeters"/>.
        /// </summary>
        public static (double Behind, double Ahead) Extent(
            double footprintBehindMeters,
            double footprintAheadMeters,
            double heightMeters,
            double siteAheadMeters)
        {
            var height = Math.Max(0.0, double.IsNaN(heightMeters) || double.IsInfinity(heightMeters) ? 0.0 : heightMeters);
            var site = double.IsNaN(siteAheadMeters) || double.IsInfinity(siteAheadMeters) ? 0.0 : siteAheadMeters;
            var margin = Math.Max(height, MinMarginMeters);
            var reach = Math.Abs(site) * SiteReachFraction;
            var behind = Math.Min(Math.Min(footprintBehindMeters, footprintAheadMeters), -Math.Max(margin, reach));
            var ahead = Math.Max(Math.Max(footprintBehindMeters, footprintAheadMeters), Math.Max(margin, site * (1.0 + SiteReachFraction)));
            return (behind, ahead);
        }

        /// <summary>
        /// The distances along the track, metres, at which terrain is read:
        /// <see cref="SampleCount"/> evenly spaced values from
        /// <paramref name="behindMeters"/> to <paramref name="aheadMeters"/>, ascending.
        /// Distance 0 is the point beneath the vessel and the track runs the way the
        /// vessel travels. A footprint shorter than <see cref="MinExtentMeters"/> is
        /// widened to it about its middle.
        /// </summary>
        public static double[] Distances(double behindMeters, double aheadMeters)
        {
            var behind = double.IsNaN(behindMeters) ? 0.0 : behindMeters;
            var ahead = double.IsNaN(aheadMeters) ? 0.0 : aheadMeters;
            if (ahead < behind)
            {
                var swap = behind;
                behind = ahead;
                ahead = swap;
            }

            var shortfall = MinExtentMeters - (ahead - behind);
            if (shortfall > 0)
            {
                behind -= shortfall / 2;
                ahead += shortfall / 2;
            }

            var extent = ahead - behind;
            var distances = new double[SampleCount];
            for (var i = 0; i < SampleCount; i++)
            {
                distances[i] = behind + extent * i / (SampleCount - 1);
            }

            return distances;
        }

        /// <summary>Great-circle distance in metres between two lat/lon points (degrees) on a sphere of the given radius.</summary>
        public static double DistanceMeters(
            double fromLatDeg,
            double fromLonDeg,
            double toLatDeg,
            double toLonDeg,
            double radius)
        {
            var phi1 = fromLatDeg * Math.PI / 180.0;
            var phi2 = toLatDeg * Math.PI / 180.0;
            var dPhi = phi2 - phi1;
            var dLambda = (toLonDeg - fromLonDeg) * Math.PI / 180.0;
            var a = Math.Sin(dPhi / 2) * Math.Sin(dPhi / 2)
                + Math.Cos(phi1) * Math.Cos(phi2) * Math.Sin(dLambda / 2) * Math.Sin(dLambda / 2);
            return 2 * radius * Math.Asin(Math.Min(1.0, Math.Sqrt(a)));
        }

        /// <summary>Initial great-circle bearing in degrees clockwise from north, from the first point toward the second.</summary>
        public static double BearingDegrees(
            double fromLatDeg,
            double fromLonDeg,
            double toLatDeg,
            double toLonDeg)
        {
            var phi1 = fromLatDeg * Math.PI / 180.0;
            var phi2 = toLatDeg * Math.PI / 180.0;
            var dLambda = (toLonDeg - fromLonDeg) * Math.PI / 180.0;
            var y = Math.Sin(dLambda) * Math.Cos(phi2);
            var x = Math.Cos(phi1) * Math.Sin(phi2) - Math.Sin(phi1) * Math.Cos(phi2) * Math.Cos(dLambda);
            return (Math.Atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0;
        }

        /// <summary>The lat/lon (degrees) reached by travelling a distance along a bearing from a start point, on a sphere of the given radius.</summary>
        public static (double lat, double lon) Destination(
            double fromLatDeg,
            double fromLonDeg,
            double bearingDeg,
            double distanceMeters,
            double radius)
        {
            var delta = distanceMeters / radius;
            var theta = bearingDeg * Math.PI / 180.0;
            var phi1 = fromLatDeg * Math.PI / 180.0;
            var lambda1 = fromLonDeg * Math.PI / 180.0;
            var sinPhi2 = Math.Sin(phi1) * Math.Cos(delta) + Math.Cos(phi1) * Math.Sin(delta) * Math.Cos(theta);
            var phi2 = Math.Asin(Math.Max(-1.0, Math.Min(1.0, sinPhi2)));
            var lambda2 = lambda1 + Math.Atan2(
                Math.Sin(theta) * Math.Sin(delta) * Math.Cos(phi1),
                Math.Cos(delta) - Math.Sin(phi1) * sinPhi2);
            var lon = (lambda2 * 180.0 / Math.PI + 540.0) % 360.0 - 180.0;
            return (phi2 * 180.0 / Math.PI, lon);
        }
    }
}
