using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free geometry for the horizon profile on <c>vessel.landing</c>: for
    /// each of a fixed set of compass bearings, the highest angle above the level at
    /// which the vessel sees terrain. A view from the vessel uses it to draw the
    /// relief beyond the terrain grid as a skyline, and to tell far ground from sky.
    ///
    /// <para>The number of bearings and of reads along each is fixed, which is the
    /// cost bound on the terrain reads a profile makes. It is many more reads than
    /// the ground-track strip or the site grid, so <see cref="NeedsRefresh"/> holds
    /// it to a profile every couple of seconds and the last one is sent again in
    /// between.</para>
    /// </summary>
    public static class LandingHorizon
    {
        /// <summary>Bearings in the profile, evenly spaced clockwise from north, so entry <c>i</c> looks along <c>i * 360 / AzimuthCount</c> degrees.</summary>
        public const int AzimuthCount = 72;

        /// <summary>Terrain reads taken along each bearing.</summary>
        public const int RangeSamples = 40;

        /// <summary>The nearest ground read along a bearing, metres.</summary>
        public const double MinRangeMeters = 30.0;

        /// <summary>The farthest ground read along a bearing, metres, or the horizon if that is nearer.</summary>
        public const double MaxRangeMeters = 30_000.0;

        /// <summary>The longest a profile is kept, seconds, however little has changed.</summary>
        public const double RefreshSeconds = 2.0;

        /// <summary>The shortest time between two profiles, seconds, however far the vessel has moved.</summary>
        public const double MinRefreshSeconds = 1.0;

        /// <summary>How far the vessel may move, as a fraction of its height above the eye of the last profile, before the profile is retaken early.</summary>
        public const double MoveFractionOfHeight = 0.1;

        /// <summary>The bearing, degrees, of profile entry <paramref name="index"/>.</summary>
        public static double AzimuthDegrees(int index) => index * 360.0 / AzimuthCount;

        /// <summary>
        /// The distances read along each bearing, metres: <see cref="RangeSamples"/>
        /// values spaced evenly in their logarithm from <see cref="MinRangeMeters"/>
        /// to <paramref name="maxMeters"/>, so ground near the vessel is read closely
        /// and far ground coarsely.
        /// </summary>
        public static double[] Ranges(double maxMeters)
        {
            var max = Math.Max(MinRangeMeters * 2, Finite(maxMeters));
            var ranges = new double[RangeSamples];
            var ratio = Math.Log(max / MinRangeMeters);
            for (var i = 0; i < RangeSamples; i++)
            {
                ranges[i] = MinRangeMeters * Math.Exp(ratio * i / (RangeSamples - 1));
            }

            return ranges;
        }

        /// <summary>The distance to the horizon from <paramref name="eyeHeightMeters"/> above a sphere of the given radius, capped at <see cref="MaxRangeMeters"/>.</summary>
        public static double RangeLimit(double eyeHeightMeters, double radius)
        {
            var h = Math.Max(0.0, Finite(eyeHeightMeters));
            var horizon = Math.Sqrt(2 * radius * h + h * h);
            return Math.Min(MaxRangeMeters, Math.Max(MinRangeMeters * 2, horizon));
        }

        /// <summary>
        /// The angle above the level, degrees, at which terrain at
        /// <paramref name="terrainAltitude"/>, <paramref name="rangeMeters"/> away along
        /// the ground, is seen from <paramref name="eyeAltitude"/>. The ground curves
        /// away below the level by <c>range / (2 * radius)</c>, so a far point sits lower
        /// than a flat-earth angle says.
        /// </summary>
        public static double ElevationAngleDegrees(
            double terrainAltitude,
            double eyeAltitude,
            double rangeMeters,
            double radius)
        {
            var range = Math.Max(1.0, Finite(rangeMeters));
            var tan = (terrainAltitude - eyeAltitude) / range - range / (2 * radius);
            return Math.Atan(tan) * 180.0 / Math.PI;
        }

        /// <summary>
        /// The profile: for each bearing, the greatest elevation angle over the ranges.
        /// <paramref name="terrainAt"/> gives the terrain altitude, metres, at a bearing
        /// (degrees clockwise from north) and a distance along the ground.
        /// </summary>
        public static double[] Profile(
            Func<double, double, double> terrainAt,
            double eyeAltitude,
            double radius,
            double maxRangeMeters)
        {
            var sweep = new Sweep(terrainAt, eyeAltitude, radius, maxRangeMeters);
            sweep.Advance(AzimuthCount);
            return sweep.Angles!;
        }

        /// <summary>
        /// One profile taken a few bearings at a time, so its terrain reads can be spread
        /// over several samples. Every read is from the place and eye height the sweep
        /// started at, and the terrain does not move, so the finished profile is the one
        /// <see cref="Profile"/> gives for that place.
        /// </summary>
        public sealed class Sweep
        {
            private readonly Func<double, double, double> _terrainAt;
            private readonly double _eyeAltitude;
            private readonly double _radius;
            private readonly double[] _ranges;
            private readonly double[] _angles = new double[AzimuthCount];
            private int _next;

            /// <param name="terrainAt">The terrain altitude, metres, at a bearing (degrees clockwise from north) and a distance along the ground, from the sweep's own place.</param>
            public Sweep(Func<double, double, double> terrainAt, double eyeAltitude, double radius, double maxRangeMeters)
            {
                _terrainAt = terrainAt;
                _eyeAltitude = eyeAltitude;
                _radius = radius;
                _ranges = Ranges(maxRangeMeters);
            }

            /// <summary>The finished profile, or null while bearings are left to read.</summary>
            public double[]? Angles => _next == AzimuthCount ? _angles : null;

            /// <summary>Reads up to <paramref name="bearings"/> more bearings and returns the terrain reads that took.</summary>
            public int Advance(int bearings)
            {
                var reads = 0;
                for (var done = 0; done < bearings && _next < AzimuthCount; done++, _next++)
                {
                    var azimuth = AzimuthDegrees(_next);
                    var best = double.NegativeInfinity;
                    for (var r = 0; r < _ranges.Length; r++)
                    {
                        var angle = ElevationAngleDegrees(_terrainAt(azimuth, _ranges[r]), _eyeAltitude, _ranges[r], _radius);
                        if (angle > best) best = angle;
                    }

                    _angles[_next] = best;
                    reads += _ranges.Length;
                }
                return reads;
            }
        }

        /// <summary>
        /// Whether the profile should be taken again. Never faster than
        /// <see cref="MinRefreshSeconds"/>; at once after that when the vessel has moved
        /// <see cref="MoveFractionOfHeight"/> of its height; and always after
        /// <see cref="RefreshSeconds"/>.
        /// </summary>
        public static bool NeedsRefresh(
            bool haveProfile,
            double secondsSinceLast,
            double movedMeters,
            double heightMeters)
        {
            if (!haveProfile) return true;
            if (secondsSinceLast < MinRefreshSeconds) return false;
            if (secondsSinceLast >= RefreshSeconds) return true;
            return movedMeters > MoveFractionOfHeight * Math.Max(1.0, Finite(heightMeters));
        }

        private static double Finite(double value) =>
            double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
    }
}
