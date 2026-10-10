using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free geometry of the ground a vessel is taken to see: a circular
    /// cone of <see cref="HalfAngleDegrees"/> either side of the vessel's travel
    /// vector, where its edges meet the ground. In the plane of the vessel's motion
    /// the cone's two edges are two rays, and the stretch of ground between where
    /// they meet it is the cone's footprint: the line the cross-section is sampled
    /// along.
    ///
    /// <para>Everything is flat ground a given height below the vessel, with
    /// distances measured along the ground in the direction of travel from the
    /// point beneath the vessel (positive ahead, negative behind). A ray that never
    /// meets the ground is cut at <see cref="MaxRangeMeters"/>.</para>
    /// </summary>
    public static class LandingCone
    {
        /// <summary>The half angle of the cone, degrees from the travel vector: a 120 degree field of view.</summary>
        public const double HalfAngleDegrees = 60.0;

        /// <summary>The farthest the footprint reaches in any case, metres.</summary>
        public const double AbsoluteMaxRangeMeters = 100_000.0;

        /// <summary>Where a cone's footprint begins and ends along the ground.</summary>
        public struct Footprint
        {
            /// <summary>The edge of the footprint farthest behind the vessel, metres; negative behind, positive when the whole footprint is ahead.</summary>
            public double Behind;

            /// <summary>The edge of the footprint farthest ahead of the vessel, metres.</summary>
            public double Ahead;

            /// <summary>Whether the edge behind was cut at the maximum range because its ray never meets the ground.</summary>
            public bool BehindCapped;

            /// <summary>Whether the edge ahead was cut at the maximum range because its ray never meets the ground.</summary>
            public bool AheadCapped;
        }

        /// <summary>
        /// How far a vessel at the given height sees along the ground before the
        /// horizon hides it: the tangent distance to a sphere of the given radius,
        /// never more than <see cref="AbsoluteMaxRangeMeters"/>. A ray flatter than
        /// this meets no ground the vessel could see, so the footprint stops here.
        /// </summary>
        public static double MaxRangeMeters(double heightMeters, double bodyRadiusMeters)
        {
            var height = Math.Max(0.0, Finite(heightMeters, 0.0));
            var radius = Finite(bodyRadiusMeters, 0.0);
            var horizon = radius > 0
                ? Math.Sqrt(2 * radius * height + height * height)
                : AbsoluteMaxRangeMeters;
            return Math.Min(horizon, AbsoluteMaxRangeMeters);
        }

        /// <summary>
        /// The footprint of a cone about the travel vector, for a vessel
        /// <paramref name="heightMeters"/> above the ground that is descending at
        /// <paramref name="descentRate"/> (m/s, positive down) while moving
        /// <paramref name="horizontalSpeed"/> (m/s, positive ahead). A vessel
        /// that is not moving looks straight down.
        /// </summary>
        public static Footprint FootprintOf(
            double heightMeters,
            double descentRate,
            double horizontalSpeed,
            double bodyRadiusMeters)
        {
            var height = Math.Max(0.0, Finite(heightMeters, 0.0));
            var down = Finite(descentRate, 0.0);
            var ahead = Math.Max(0.0, Finite(horizontalSpeed, 0.0));
            // Degrees below the horizontal the vessel travels at: straight down is 90, level is 0, climbing is negative.
            var axis = down == 0.0 && ahead == 0.0
                ? 90.0
                : Math.Atan2(down, ahead) * 180.0 / Math.PI;
            var max = MaxRangeMeters(height, bodyRadiusMeters);
            var steep = Reach(axis + HalfAngleDegrees, height, max, out var steepCapped);
            var shallow = Reach(axis - HalfAngleDegrees, height, max, out var shallowCapped);
            return new Footprint
            {
                Behind = steep,
                BehindCapped = steepCapped,
                Ahead = shallow,
                AheadCapped = shallowCapped,
            };
        }

        /// <summary>
        /// Where a ray leaving the vessel at the given angle below the horizontal
        /// (0 level ahead, 90 straight down, 180 level behind) meets the ground,
        /// metres ahead of the point beneath it. A ray that points level or up never
        /// does, and nor does one that points level or up behind; both are cut at
        /// <paramref name="maxRange"/>, as is any that meets the ground farther
        /// than that.
        /// </summary>
        private static double Reach(double angleDegrees, double height, double maxRange, out bool capped)
        {
            if (angleDegrees <= 0.0)
            {
                capped = true;
                return maxRange;
            }

            if (angleDegrees >= 180.0)
            {
                capped = true;
                return -maxRange;
            }

            var reach = height / Math.Tan(angleDegrees * Math.PI / 180.0);
            if (reach > maxRange)
            {
                capped = true;
                return maxRange;
            }

            if (reach < -maxRange)
            {
                capped = true;
                return -maxRange;
            }

            capped = false;
            return reach;
        }

        private static double Finite(double value, double otherwise) =>
            double.IsNaN(value) || double.IsInfinity(value) ? otherwise : value;
    }
}
