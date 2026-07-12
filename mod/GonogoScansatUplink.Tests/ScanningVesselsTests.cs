using System;
using System.Collections.Generic;
using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// Shape-tests the pure <c>scansat.scanningVessels</c> wire builder
    /// (<see cref="ScanningVessels"/>) — the exact camelCase keys, the sensor
    /// array shape, the trackColor packing, and the null-when-idle FoV-width
    /// rule the client contract (<c>Sitrep.Contract.ScanningVesselEntry</c> /
    /// the widget's <c>SCANScanningVessel</c>) reads. No live SCANsat/KSP: the
    /// builder takes plain scalars, so the SCANvessel-typed read is exercised
    /// separately on the Deck.
    /// </summary>
    public class ScanningVesselsTests
    {
        // Kerbin-scale body, a mapping sat at best-alt with two in-range
        // sensors — the common "actively scanning" case.
        private static Dictionary<string, object?> BuildActive(double subLat = 12.0)
        {
            var sensors = new List<ScanningVessels.SensorInput>
            {
                new ScanningVessels.SensorInput(type: 2, fov: 5, minAlt: 5000, maxAlt: 500_000, bestAlt: 250_000, inRange: true, bestRange: true),
                new ScanningVessels.SensorInput(type: 8, fov: 5, minAlt: 5000, maxAlt: 500_000, bestAlt: 250_000, inRange: true, bestRange: false),
            };
            return ScanningVessels.Build(
                vesselId: "scn-1",
                vesselName: "ScanSat-1",
                bodyName: "Kerbin",
                subLatitude: subLat,
                subLongitude: 35.0,
                altitude: 250_000,
                sensors: sensors,
                bodyRadius: 600_000,
                bodySoiRadius: 84_000_000,
                homeRadius: 600_000,
                trackColorR: 0,
                trackColorG: 255,
                trackColorB: 200,
                trackColorA: 255);
        }

        [Fact]
        public void EmitsExactTopLevelWireKeys()
        {
            var wire = BuildActive();

            Assert.Equal("scn-1", wire["vesselId"]);
            Assert.Equal("ScanSat-1", wire["vesselName"]);
            Assert.Equal("Kerbin", wire["body"]);
            Assert.Equal(12.0, wire["subLatitude"]);
            Assert.Equal(35.0, wire["subLongitude"]);
            Assert.Equal(250_000.0, wire["altitude"]);
            Assert.True(wire.ContainsKey("sensors"));
            Assert.True(wire.ContainsKey("groundTrackWidthDeg"));
            Assert.True(wire.ContainsKey("groundTrackLonHalfDeg"));
            Assert.True(wire.ContainsKey("trackColor"));
        }

        [Fact]
        public void SensorArray_MirrorsEachSensorWithExactKeys()
        {
            var wire = BuildActive();
            var sensors = Assert.IsType<List<object?>>(wire["sensors"]);
            Assert.Equal(2, sensors.Count);

            var first = Assert.IsType<Dictionary<string, object?>>(sensors[0]);
            Assert.Equal(2, first["type"]);
            Assert.Equal(5.0, first["fov"]);
            Assert.Equal(5000.0, first["minAlt"]);
            Assert.Equal(500_000.0, first["maxAlt"]);
            Assert.Equal(250_000.0, first["bestAlt"]);
            Assert.Equal(true, first["inRange"]);
            Assert.Equal(true, first["bestRange"]);

            var second = Assert.IsType<Dictionary<string, object?>>(sensors[1]);
            Assert.Equal(8, second["type"]);
            Assert.Equal(false, second["bestRange"]);
        }

        [Fact]
        public void TrackColor_PacksRgbaChannels()
        {
            var wire = BuildActive();
            var tc = Assert.IsType<Dictionary<string, object?>>(wire["trackColor"]);
            Assert.Equal(0, tc["r"]);
            Assert.Equal(255, tc["g"]);
            Assert.Equal(200, tc["b"]);
            Assert.Equal(255, tc["a"]);
        }

        [Fact]
        public void InRangeSensors_EmitFiniteGroundTrackWidths()
        {
            var wire = BuildActive();

            // At best-alt on the home body surfScale floors to 1, so the FoV
            // width passes through as the raw fov (5) — a concrete number, not null.
            var widthDeg = Assert.IsType<double>(wire["groundTrackWidthDeg"]);
            Assert.Equal(5.0, widthDeg, precision: 6);

            // Longitude half-width = widthDeg / cos(|subLat|) at 12°.
            var lonHalf = Assert.IsType<double>(wire["groundTrackLonHalfDeg"]);
            Assert.Equal(5.0 / Math.Cos(12.0 * Math.PI / 180.0), lonHalf, precision: 6);
        }

        [Fact]
        public void NoInRangeSensors_NullsBothGroundTrackWidths()
        {
            // Below every sensor's minAlt → getFOV returns 0 → nothing to paint.
            var sensors = new List<ScanningVessels.SensorInput>
            {
                new ScanningVessels.SensorInput(type: 2, fov: 5, minAlt: 100_000, maxAlt: 500_000, bestAlt: 250_000, inRange: false, bestRange: false),
            };
            var wire = ScanningVessels.Build(
                "scn-2", "LowSat", "Kerbin",
                subLatitude: 0, subLongitude: 0, altitude: 1000,
                sensors: sensors,
                bodyRadius: 600_000, bodySoiRadius: 84_000_000, homeRadius: 600_000,
                trackColorR: 1, trackColorG: 2, trackColorB: 3, trackColorA: 4);

            Assert.Null(wire["groundTrackWidthDeg"]);
            Assert.Null(wire["groundTrackLonHalfDeg"]);

            // The sensor is still listed (idle, but tracked).
            var listed = Assert.IsType<List<object?>>(wire["sensors"]);
            Assert.Single(listed);
        }

        [Fact]
        public void NoSensors_EmitsEmptySensorArray_AndNullWidths()
        {
            var wire = ScanningVessels.Build(
                "scn-3", "Bare", "Mun",
                subLatitude: 0, subLongitude: 0, altitude: 10_000,
                sensors: new List<ScanningVessels.SensorInput>(),
                bodyRadius: 200_000, bodySoiRadius: 2_400_000, homeRadius: 600_000,
                trackColorR: 0, trackColorG: 0, trackColorB: 0, trackColorA: 0);

            var listed = Assert.IsType<List<object?>>(wire["sensors"]);
            Assert.Empty(listed);
            Assert.Null(wire["groundTrackWidthDeg"]);
            Assert.Null(wire["groundTrackLonHalfDeg"]);
        }

        [Fact]
        public void LonHalfWidth_CapsAt120NearThePoles()
        {
            // cos(|subLat|) → 0 at the pole, so the raw 1/cos widening blows up;
            // the cap keeps it finite at 120°.
            double capped = ScanningVessels.LonHalfWidth(widthDeg: 5, subLatitude: 89.99);
            Assert.Equal(ScanningVessels.LonHalfWidthCapDeg, capped);

            double atPole = ScanningVessels.LonHalfWidth(widthDeg: 5, subLatitude: 90);
            Assert.Equal(ScanningVessels.LonHalfWidthCapDeg, atPole);
        }

        [Fact]
        public void LonHalfWidth_EqualsWidthAtEquator()
        {
            // cos(0) == 1 → longitude half-width equals the latitude half-width.
            Assert.Equal(5.0, ScanningVessels.LonHalfWidth(widthDeg: 5, subLatitude: 0), precision: 9);
        }

        [Fact]
        public void Build_NullSensors_Throws()
        {
            Assert.Throws<ArgumentNullException>(() => ScanningVessels.Build(
                "x", "x", "Kerbin", 0, 0, 0,
                sensors: null!,
                bodyRadius: 600_000, bodySoiRadius: 84_000_000, homeRadius: 600_000,
                trackColorR: 0, trackColorG: 0, trackColorB: 0, trackColorA: 0));
        }
    }
}
