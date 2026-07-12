using System.Collections.Generic;
using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// Exercises the getFOV replication (GroundTrackFov.cs) against the
    /// formula transcribed from SCANcontroller.cs:1916-1963. No independent
    /// numeric fixture from a live SCANsat capture exists yet (that
    /// requires launching KSP, out of scope here - see the report's gaps
    /// section), so these assert the formula's documented properties
    /// directly rather than a recorded "known good" output value.
    /// </summary>
    public class GroundTrackFovTests
    {
        [Fact]
        public void NoSensorsInRange_ReturnsZero()
        {
            var sensors = new List<SensorFovInputs>
            {
                new SensorFovInputs(fov: 5, minAlt: 1000, maxAlt: 2000, bestAlt: 1500),
            };

            double result = GroundTrackFov.Compute(
                sensors, altitude: 500, bodyRadius: 600_000, bodySoiRadius: 84_000_000, homeRadius: 600_000);

            Assert.Equal(0, result);
        }

        [Fact]
        public void HomeBody_SurfScaleFloorsAtOne_NoInflation()
        {
            // surfscale = sqrt(max(1, homeRadius/bodyRadius)); on the home
            // body (bodyRadius == homeRadius) that floors to 1, so fov
            // passes through unchanged (below the 20 cap).
            var sensors = new List<SensorFovInputs>
            {
                new SensorFovInputs(fov: 5, minAlt: 0, maxAlt: 1_000_000, bestAlt: 50_000),
            };

            double result = GroundTrackFov.Compute(
                sensors, altitude: 100_000, bodyRadius: 600_000, bodySoiRadius: 84_000_000, homeRadius: 600_000);

            Assert.Equal(5, result, precision: 6);
        }

        [Fact]
        public void SmallerBody_SurfScaleInflatesFov()
        {
            // A body smaller than Home inflates fov by sqrt(homeRadius/bodyRadius) > 1.
            var sensors = new List<SensorFovInputs>
            {
                new SensorFovInputs(fov: 5, minAlt: 0, maxAlt: 1_000_000, bestAlt: 50_000),
            };

            double result = GroundTrackFov.Compute(
                sensors, altitude: 100_000, bodyRadius: 200_000, bodySoiRadius: 2_500_000, homeRadius: 600_000);

            Assert.True(result > 5);
        }

        [Fact]
        public void FovCapsAtTwenty()
        {
            var sensors = new List<SensorFovInputs>
            {
                new SensorFovInputs(fov: 50, minAlt: 0, maxAlt: 1_000_000, bestAlt: 500_000),
            };

            double result = GroundTrackFov.Compute(
                sensors, altitude: 100_000, bodyRadius: 100_000, bodySoiRadius: 2_500_000, homeRadius: 600_000);

            Assert.Equal(20, result);
        }

        [Fact]
        public void BelowBestAltitude_ScalesFovLinearly()
        {
            // fov = (alt/bestAlt) * fov when alt < bestAlt.
            var sensors = new List<SensorFovInputs>
            {
                new SensorFovInputs(fov: 10, minAlt: 0, maxAlt: 1_000_000, bestAlt: 200_000),
            };

            double result = GroundTrackFov.Compute(
                sensors, altitude: 100_000, bodyRadius: 600_000, bodySoiRadius: 84_000_000, homeRadius: 600_000);

            Assert.Equal(5, result, precision: 6); // (100_000/200_000)*10
        }

        [Fact]
        public void MaxOverMultipleSensors()
        {
            var sensors = new List<SensorFovInputs>
            {
                new SensorFovInputs(fov: 2, minAlt: 0, maxAlt: 1_000_000, bestAlt: 50_000),
                new SensorFovInputs(fov: 8, minAlt: 0, maxAlt: 1_000_000, bestAlt: 50_000),
            };

            double result = GroundTrackFov.Compute(
                sensors, altitude: 100_000, bodyRadius: 600_000, bodySoiRadius: 84_000_000, homeRadius: 600_000);

            Assert.Equal(8, result, precision: 6);
        }
    }
}
