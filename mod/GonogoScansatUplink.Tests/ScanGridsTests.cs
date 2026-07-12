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
        public void BuildHeightsWalksCellsInIlonTimesHeightPlusIlatOrderWithLonMinus180LatMinus90()
        {
            // Encode (lon,lat) into the sample so we can prove the exact cell
            // the builder handed each index. Use a small grid for clarity.
            int w = 4, h = 2;
            // Encode (lon,lat) into a small, distinct, in-Int16-range value.
            Func<int, int, int> encode = (lon, lat) => (lon + 200) * 100 + (lat + 100);
            var grid = ScanGrids.BuildHeights(w, h, (lon, lat) => encode(lon, lat));

            // index = ilon*h + ilat; lon = ilon-180; lat = ilat-90.
            for (int ilon = 0; ilon < w; ilon++)
            {
                for (int ilat = 0; ilat < h; ilat++)
                {
                    int lon = ilon - 180;
                    int lat = ilat - 90;
                    Assert.Equal((short)encode(lon, lat), grid.Metres[ilon * h + ilat]);
                }
            }
        }

        [Fact]
        public void BuildHeightsTracksMinAndMax()
        {
            var grid = ScanGrids.BuildHeights(4, 2, (lon, lat) => lon); // lon ∈ [-180,-177]
            Assert.Equal((short)-180, grid.MinMetres);
            Assert.Equal((short)-177, grid.MaxMetres);
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
            // sampler: index = lon for the first cell region, -1 sentinel, big value
            var indices = ScanGrids.BuildBiomeIndices(3, 1, (lon, lat) =>
                lon == -180 ? -1 : lon == -179 ? 5 : 999);
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
