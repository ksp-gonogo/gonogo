using System;
using System.Collections.Generic;
using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// Pure grid-math + wire-payload shaping for height/biome/mask — the
    /// SCANsat/KSP reads are injected as samplers, so the cell order, the
    /// base64 packing, and the exact wire dict keys the client decoder reads
    /// (<c>packages/data/src/scansat/scanDecode.ts</c>) are all exercised
    /// headlessly.
    /// </summary>
    public class ScanGridsTests
    {
        [Fact]
        public void BuildHeightsWalksCellsAtDegPerCellDerivedFromWidthAndHeight()
        {
            // width=4 -> 90 deg/cell; height=2 -> 90 deg/cell. Deliberately NOT
            // 360x180, to prove the formula is width/height-driven, not a
            // hardcoded "ilon-180" 1-degree-per-cell shortcut.
            int w = 4, h = 2;
            Func<double, double, double> encode = (lon, lat) => lon * 10 + lat;
            var grid = ScanGrids.BuildHeights(w, h, encode);

            double degPerCellLon = 360.0 / w; // 90.0
            double degPerCellLat = 180.0 / h; // 90.0
            for (int ilon = 0; ilon < w; ilon++)
            {
                for (int ilat = 0; ilat < h; ilat++)
                {
                    double lon = ilon * degPerCellLon - 180.0;
                    double lat = ilat * degPerCellLat - 90.0;
                    Assert.Equal((short)Math.Round(encode(lon, lat)), grid.Metres[ilon * h + ilat]);
                }
            }
        }

        [Fact]
        public void BuildHeightsAtStandard360x180StillSamplesIntegerDegrees()
        {
            // Backward-compat guard: the production grid size (360x180) must
            // keep sampling exact integer degrees (degPerCell == 1.0), matching
            // every call site's existing assumption (SampleElevation etc.).
            var seen = new List<(double, double)>();
            ScanGrids.BuildHeights(360, 180, (lon, lat) => { seen.Add((lon, lat)); return 0.0; });

            Assert.Contains((-180.0, -90.0), seen); // ilon=0, ilat=0
            Assert.Contains((-179.0, -90.0), seen); // ilon=1, ilat=0
            Assert.Contains((179.0, 89.0), seen);   // ilon=359, ilat=179
        }

        [Fact]
        public void BuildBiomeIndicesAtNonStandardGridSamplesFractionalDegrees()
        {
            int w = 720, h = 360; // the V1 target size — 0.5 deg/cell.
            var seen = new List<(double, double)>();
            ScanGrids.BuildBiomeIndices(w, h, (lon, lat) => { seen.Add((lon, lat)); return -1; });

            Assert.Contains((-180.0, -90.0), seen);  // ilon=0, ilat=0
            Assert.Contains((-179.5, -90.0), seen);  // ilon=1, ilat=0 -> 0.5 deg step
            Assert.Contains((179.5, 89.5), seen);    // ilon=719, ilat=359
        }

        [Fact]
        public void BuildHeightsTracksMinAndMax()
        {
            // width=4 -> 90 deg/cell, so lon walks -180,-90,0,90 (NOT
            // integer-degree-contiguous — updated for the width-driven
            // degPerCell formula, see BuildHeightsWalksCellsAtDegPerCell...).
            var grid = ScanGrids.BuildHeights(4, 2, (lon, lat) => lon);
            Assert.Equal((short)-180, grid.MinMetres);
            Assert.Equal((short)90, grid.MaxMetres);
        }

        [Fact]
        public void BuildHeightsClampsToInt16AndRounds()
        {
            var grid = ScanGrids.BuildHeights(1, 1, (lon, lat) => 40000.6); // beyond Int16 max
            Assert.Equal(short.MaxValue, grid.Metres[0]);
        }

        [Fact]
        public void BuildBiomeIndicesMapsNegativeToFFAndSaturatesAt254()
        {
            // width=3 -> 120 deg/cell, so lon walks -180,-60,60 (NOT
            // integer-degree-contiguous — updated for the width-driven
            // degPerCell formula, see BuildHeightsWalksCellsAtDegPerCell...).
            var indices = ScanGrids.BuildBiomeIndices(3, 1, (lon, lat) =>
                lon == -180 ? -1 : lon == -60 ? 5 : 999);
            Assert.Equal(0xFF, indices[0]); // -1 -> 0xFF
            Assert.Equal(5, indices[1]);    // pass-through
            Assert.Equal(254, indices[2]);  // saturate
        }

        [Fact]
        public void Base64Int16LittleEndianRoundTrips()
        {
            var values = new short[] { 0, 1, -1, 258, short.MinValue, short.MaxValue };
            var b64 = ScanGrids.Base64Int16LittleEndian(values);
            var bytes = Convert.FromBase64String(b64);
            Assert.Equal(values.Length * 2, bytes.Length);
            for (int i = 0; i < values.Length; i++)
            {
                short reconstructed = (short)(bytes[i * 2] | (bytes[i * 2 + 1] << 8));
                Assert.Equal(values[i], reconstructed);
            }
        }

        [Fact]
        public void BuildMaskPayloadHasClientDecoderKeysAndBase64Bits()
        {
            var packed = new byte[] { 0xAB, 0xCD };
            var payload = ScanGrids.BuildMaskPayload(360, 180, 256, packed);

            Assert.Equal(360, payload["width"]);
            Assert.Equal(180, payload["height"]);
            Assert.Equal(256, payload["type"]);
            Assert.Equal(Convert.ToBase64String(packed), payload["bits"]);
        }

        [Fact]
        public void BuildHeightPayloadHasClientDecoderKeys()
        {
            var grid = new ScanGrids.HeightGrid(new short[] { 1, 2 }, -5, 42);
            var payload = ScanGrids.BuildHeightPayload(360, 180, grid);

            Assert.Equal(360, payload["width"]);
            Assert.Equal(180, payload["height"]);
            Assert.Equal(-5, payload["minMetres"]);
            Assert.Equal(42, payload["maxMetres"]);
            Assert.Equal(ScanGrids.Base64Int16LittleEndian(grid.Metres), payload["heights"]);
        }

        [Fact]
        public void BuildBiomePayloadHasClientDecoderKeys()
        {
            var biomes = new List<object?> { ScanGrids.BuildBiomeEntry("grasslands", "Grasslands", 0x00FF00) };
            var indices = new byte[] { 0, 0xFF };
            var payload = ScanGrids.BuildBiomePayload(360, 180, biomes, indices);

            Assert.Equal(360, payload["width"]);
            Assert.Equal(180, payload["height"]);
            Assert.Same(biomes, payload["biomes"]);
            Assert.Equal(Convert.ToBase64String(indices), payload["indices"]);
        }

        [Fact]
        public void BuildBiomeEntryHasNameDisplayNameColour()
        {
            var entry = ScanGrids.BuildBiomeEntry("shores", "Shores", 0x112233);
            Assert.Equal("shores", entry["name"]);
            Assert.Equal("Shores", entry["displayName"]);
            Assert.Equal(0x112233, entry["colour"]);
        }
    }
}
