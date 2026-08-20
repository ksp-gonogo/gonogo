using System;
using Sitrep.Propagation.Visibility;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Propagation.Tests.Visibility
{
    public class ChordOcclusionTests
    {
        private static readonly Vector3d Origin = new Vector3d(0.0, 0.0, 0.0);

        [Fact]
        public void ClearanceIsExactlyZeroOnTheTangent()
        {
            // The chord runs along y = 600 km, so its nearest point to the origin
            // is (0, 600 km, 0): grazing a 600 km sphere exactly. Every quantity
            // here is exactly representable in binary64, so this is a true
            // equality and not an epsilon comparison dressed up as one.
            var a = new Vector3d(-1_000_000.0, 600_000.0, 0.0);
            var b = new Vector3d(1_000_000.0, 600_000.0, 0.0);

            Assert.Equal(0.0, ChordOcclusion.Clearance(a, b, Origin, 600_000.0));
        }

        [Fact]
        public void TangentCountsAsClearBecauseGrazingIsNotPenetrating()
        {
            var a = new Vector3d(-1_000_000.0, 600_000.0, 0.0);
            var b = new Vector3d(1_000_000.0, 600_000.0, 0.0);

            Assert.True(ChordOcclusion.IsClear(a, b, Origin, 600_000.0));
        }

        [Fact]
        public void AStationStandingOnTheOccluderIsNotPermanentlyDark()
        {
            // The case that fixes the sign convention: a zero-altitude ground
            // station sits exactly on a bare-radius occluder, so the nearest point
            // of the chord to the centre is the station itself, at exactly the
            // radius, for the whole time the vessel is above its horizon.
            var station = new Vector3d(600_000.0, 0.0, 0.0);
            var overhead = new Vector3d(700_000.0, 0.0, 0.0);
            var overTheHorizon = new Vector3d(-700_000.0, 0.0, 0.0);

            Assert.Equal(0.0, ChordOcclusion.Clearance(overhead, station, Origin, 600_000.0));
            Assert.True(ChordOcclusion.IsClear(overhead, station, Origin, 600_000.0));
            Assert.False(ChordOcclusion.IsClear(overTheHorizon, station, Origin, 600_000.0));
        }

        [Fact]
        public void AChordStraightThroughTheCentreIsBlockedByTheFullRadius()
        {
            var a = new Vector3d(-1_000_000.0, 0.0, 0.0);
            var b = new Vector3d(1_000_000.0, 0.0, 0.0);

            Assert.Equal(-600_000.0, ChordOcclusion.Clearance(a, b, Origin, 600_000.0));
            Assert.False(ChordOcclusion.IsClear(a, b, Origin, 600_000.0));
        }

        [Fact]
        public void ShrinkingTheOccluderOpensAPathTheBareRadiusBlocks()
        {
            // The whole dispute in one assertion: the same two points, blocked at
            // Kerbin's bare 600 km and clear at stock's 0.75x atmospheric occluder.
            var a = new Vector3d(-1_000_000.0, 500_000.0, 0.0);
            var b = new Vector3d(1_000_000.0, 500_000.0, 0.0);

            Assert.False(ChordOcclusion.IsClear(a, b, Origin, 600_000.0));
            Assert.True(ChordOcclusion.IsClear(a, b, Origin, 450_000.0));
        }

        [Fact]
        public void AnOccluderBeyondTheFarEndpointDoesNotBlockTheSegment()
        {
            // Both endpoints sit on the +x side of the sphere. The infinite LINE
            // through them passes through the origin, so a line test would call
            // this blocked; the segment stops well short of the sphere.
            var a = new Vector3d(2_000_000.0, 0.0, 0.0);
            var b = new Vector3d(1_000_000.0, 0.0, 0.0);

            Assert.True(ChordOcclusion.IsClear(a, b, Origin, 600_000.0));
            Assert.Equal(400_000.0, ChordOcclusion.Clearance(a, b, Origin, 600_000.0));
        }

        [Fact]
        public void CoincidentEndpointsCollapseToAPointToSphereDistance()
        {
            var a = new Vector3d(1_000_000.0, 0.0, 0.0);

            Assert.Equal(400_000.0, ChordOcclusion.Clearance(a, a, Origin, 600_000.0));
        }

        [Theory]
        [InlineData(600_000.0)]
        [InlineData(450_000.0)]
        [InlineData(540_000.0)]
        public void TheTwoFormsNeverDisagreeAboutWhetherThePathIsClear(double occluderRadius)
        {
            // The metres form and the search form have to be the same predicate,
            // or the sweep would be refining a crossing of something other than
            // the thing being reported. The one place they are allowed to differ
            // is the exact tangent, where the metres form sits pinned at zero;
            // that is a boundary both call clear.
            var station = new Vector3d(600_000.0, 0.0, 0.0);

            for (int degrees = 0; degrees < 360; degrees++)
            {
                double angle = degrees * Math.PI / 180.0;
                var vessel = new Vector3d(700_000.0 * Math.Cos(angle), 700_000.0 * Math.Sin(angle), 0.0);

                bool byClearance = ChordOcclusion.Clearance(vessel, station, Origin, occluderRadius) >= 0.0;
                bool byMargin = ChordOcclusion.IsClear(vessel, station, Origin, occluderRadius);

                Assert.True(byClearance == byMargin, $"disagreement at {degrees} deg, R={occluderRadius}");
            }
        }

        [Fact]
        public void TheSearchFormIsNotPinnedToZeroWhereTheMetresFormIs()
        {
            // Exactly the degeneracy the second form exists to dodge: a station on
            // the surface, a vessel visibly above it, and a metres-of-clearance
            // that cannot tell 5 degrees above the horizon from 80.
            var station = new Vector3d(600_000.0, 0.0, 0.0);
            var high = new Vector3d(700_000.0, 0.0, 0.0);
            var low = new Vector3d(700_000.0 * Math.Cos(0.5), 700_000.0 * Math.Sin(0.5), 0.0);

            Assert.Equal(0.0, ChordOcclusion.Clearance(high, station, Origin, 600_000.0));
            Assert.Equal(0.0, ChordOcclusion.Clearance(low, station, Origin, 600_000.0));

            double marginHigh = ChordOcclusion.HorizonMargin(high, station, Origin, 600_000.0);
            double marginLow = ChordOcclusion.HorizonMargin(low, station, Origin, 600_000.0);

            Assert.True(marginHigh > 0.0);
            Assert.True(marginLow > 0.0);
            Assert.True(marginHigh > marginLow, "the margin must fall away as the vessel approaches the horizon");
        }

        [Fact]
        public void TheSearchFormIsZeroExactlyOnTheHorizon()
        {
            // A station on the surface sees a vessel at radius p down to
            // acos(R/p) from the zenith. At that angle the margin is zero; a
            // degree either side flips the sign.
            var station = new Vector3d(600_000.0, 0.0, 0.0);
            double horizonAngle = Math.Acos(600_000.0 / 700_000.0);

            Vector3d atHorizon = AtAngle(horizonAngle);
            Vector3d above = AtAngle(horizonAngle - 0.01);
            Vector3d below = AtAngle(horizonAngle + 0.01);

            Assert.Equal(0.0, ChordOcclusion.HorizonMargin(atHorizon, station, Origin, 600_000.0), 3);
            Assert.True(ChordOcclusion.IsClear(above, station, Origin, 600_000.0));
            Assert.False(ChordOcclusion.IsClear(below, station, Origin, 600_000.0));
        }

        [Fact]
        public void ClearanceIsMeasuredFromTheOccluderCentreNotTheFrameOrigin()
        {
            var centre = new Vector3d(0.0, 0.0, 10_000_000.0);
            var a = new Vector3d(-1_000_000.0, 0.0, 10_000_000.0);
            var b = new Vector3d(1_000_000.0, 0.0, 10_000_000.0);

            Assert.Equal(-600_000.0, ChordOcclusion.Clearance(a, b, centre, 600_000.0));
            Assert.True(ChordOcclusion.IsClear(a, b, Origin, 600_000.0));
        }

        /// <summary>A point on a 700 km circle, <paramref name="angle"/> radians round from +x.</summary>
        private static Vector3d AtAngle(double angle)
        {
            return new Vector3d(700_000.0 * Math.Cos(angle), 700_000.0 * Math.Sin(angle), 0.0);
        }

    }
}
