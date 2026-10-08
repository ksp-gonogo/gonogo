using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free geometry for the ground-track terrain strip on
    /// <c>vessel.landing</c>: where along the predicted ground track the capture
    /// reads terrain height. The track runs along the great circle from the point
    /// beneath the vessel to the predicted touchdown site and on past it; the
    /// distances are scaled to how far the vessel still has to travel, so the strip
    /// narrows toward the site as the vessel descends.
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

        /// <summary>How far past the site the strip runs, as a share of the distance still to travel.</summary>
        public const double BeyondSiteFraction = 0.25;

        /// <summary>The least the strip runs past the site, metres.</summary>
        public const double MinBeyondSiteMeters = 100.0;

        /// <summary>
        /// The distances along the track, metres from the point beneath the vessel,
        /// at which terrain is read: <see cref="SampleCount"/> evenly spaced values,
        /// ascending from 0 to the end of the strip. The strip ends past the site by
        /// <see cref="BeyondSiteFraction"/> of <paramref name="distanceToSiteMeters"/>
        /// (never less than <see cref="MinBeyondSiteMeters"/>), and is never shorter than
        /// <see cref="MinExtentMeters"/>.
        /// </summary>
        public static double[] Distances(double distanceToSiteMeters)
        {
            var toSite = double.IsNaN(distanceToSiteMeters) || distanceToSiteMeters < 0
                ? 0.0
                : distanceToSiteMeters;
            var beyond = Math.Max(MinBeyondSiteMeters, toSite * BeyondSiteFraction);
            var extent = Math.Max(MinExtentMeters, toSite + beyond);
            var distances = new double[SampleCount];
            for (var i = 0; i < SampleCount; i++)
            {
                distances[i] = extent * i / (SampleCount - 1);
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
