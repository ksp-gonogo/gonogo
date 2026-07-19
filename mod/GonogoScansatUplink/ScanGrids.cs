using System;
using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Pure (SCANsat/KSP-type-free) builders for the bulk grid payloads the
    /// client decodes (<c>packages/data/src/scansat/scanDecode.ts</c>):
    /// mask (<c>SCANCoverageBitmap</c>), height (<c>SCANHeightGrid</c>), and
    /// biome (<c>SCANBiomeGrid</c>). Every function takes already-sampled
    /// data (or an injected per-cell sampler), so the KSP/stock reads
    /// (<c>pqsController.GetSurfaceHeight</c>, <c>BiomeMap.GetAtt</c>) stay in
    /// <see cref="ScansatUplink"/> and the grid math is unit-testable
    /// headlessly (net10.0, no KSP DLLs), the same split
    /// <see cref="CoverageHash"/>/<see cref="CoveragePlane"/> already use.
    ///
    /// <para><b>Cell order matches the wire contract verbatim</b>
    /// (<c>telemachus.ts</c> + scansat-migration-spec.md §2.3): row-major
    /// index <c>ilon * height + ilat</c>, walked at <c>degPerCellLon =
    /// 360/width</c>, <c>degPerCellLat = 180/height</c> so that <c>lon =
    /// ilon*degPerCellLon - 180</c> and <c>lat = ilat*degPerCellLat - 90</c>
    /// — for the standard 360×180 grid this is exactly 1°/cell (<c>lon =
    /// ilon-180</c> ∈ [-180,179], <c>lat = ilat-90</c> ∈ [-90,89]), and
    /// <c>ilat=0</c> is the south-pole row. A sampler is called once per
    /// cell in that exact order.</para>
    /// </summary>
    public static class ScanGrids
    {
        public const int Width = 720;
        public const int Height = 360;

        /// <summary>Decoded pieces of a built height grid — see <see cref="BuildHeightPayload"/> for the wire dict this feeds.</summary>
        public readonly struct HeightGrid
        {
            public readonly short[] Metres;
            public readonly short MinMetres;
            public readonly short MaxMetres;

            public HeightGrid(short[] metres, short minMetres, short maxMetres)
            {
                Metres = metres;
                MinMetres = minMetres;
                MaxMetres = maxMetres;
            }
        }

        /// <summary>
        /// Builds the row-major Int16 elevation grid by calling
        /// <paramref name="sampleMetres"/>(lon, lat) once per cell (lon/lat in
        /// integer degrees, per the cell-order note above). The sampler is
        /// expected to already apply the §0E convention
        /// (<c>Round(GetSurfaceHeight(rad) - pqsController.radius, 1)</c>);
        /// this method only clamps to Int16 range and tracks min/max.
        /// </summary>
        public static HeightGrid BuildHeights(int width, int height, Func<double, double, double> sampleMetres)
        {
            if (sampleMetres == null) throw new ArgumentNullException(nameof(sampleMetres));

            var metres = new short[width * height];
            short min = short.MaxValue;
            short max = short.MinValue;
            double degPerCellLon = 360.0 / width;
            double degPerCellLat = 180.0 / height;

            for (int ilon = 0; ilon < width; ilon++)
            {
                for (int ilat = 0; ilat < height; ilat++)
                {
                    double lon = ilon * degPerCellLon - 180.0;
                    double lat = ilat * degPerCellLat - 90.0;
                    double m = sampleMetres(lon, lat);
                    short clamped = ClampToInt16(m);
                    metres[ilon * height + ilat] = clamped;
                    if (clamped < min) min = clamped;
                    if (clamped > max) max = clamped;
                }
            }

            if (min > max)
            {
                // width*height is always > 0 here, so this only trips if a
                // caller passes a zero-size grid — keep a sane, non-inverted
                // pair rather than leaving the sentinels.
                min = 0;
                max = 0;
            }

            return new HeightGrid(metres, min, max);
        }

        /// <summary>
        /// Builds the row-major byte-per-cell biome-index grid by calling
        /// <paramref name="sampleIndex"/>(lon, lat) once per cell. A returned
        /// index of <c>-1</c> (null biome / no BiomeMap) becomes
        /// <c>0xFF</c>; indices saturate at 254 (matching the client's
        /// documented ">254 biomes collapse the tail" behavior).
        /// </summary>
        public static byte[] BuildBiomeIndices(int width, int height, Func<double, double, int> sampleIndex)
        {
            if (sampleIndex == null) throw new ArgumentNullException(nameof(sampleIndex));

            var indices = new byte[width * height];
            double degPerCellLon = 360.0 / width;
            double degPerCellLat = 180.0 / height;
            for (int ilon = 0; ilon < width; ilon++)
            {
                for (int ilat = 0; ilat < height; ilat++)
                {
                    double lon = ilon * degPerCellLon - 180.0;
                    double lat = ilat * degPerCellLat - 90.0;
                    int idx = sampleIndex(lon, lat);
                    indices[ilon * height + ilat] = idx < 0 ? (byte)0xFF : (byte)Math.Min(idx, 254);
                }
            }
            return indices;
        }

        /// <summary>Base64 of a little-endian Int16 array — the wire shape <c>SCANHeightGrid.heights</c> decodes.</summary>
        public static string Base64Int16LittleEndian(short[] values)
        {
            if (values == null) throw new ArgumentNullException(nameof(values));
            var bytes = new byte[values.Length * 2];
            for (int i = 0; i < values.Length; i++)
            {
                bytes[i * 2] = (byte)(values[i] & 0xFF);
                bytes[i * 2 + 1] = (byte)((values[i] >> 8) & 0xFF);
            }
            return Convert.ToBase64String(bytes);
        }

        // ----------------------------------------------------------------
        // Wire payload dicts — Dictionary<string, object?> keyed with the
        // EXACT camelCase field names the client decoder reads (JsonWriter
        // emits a dict's keys verbatim, no auto-casing — see its
        // AppendObject). Values are primitives/strings/lists the JsonWriter
        // already handles.
        // ----------------------------------------------------------------

        /// <summary><c>SCANCoverageBitmap</c>: {width, height, type, bits(base64)}.</summary>
        public static Dictionary<string, object?> BuildMaskPayload(int width, int height, short scanTypeBit, byte[] packedPlane)
        {
            if (packedPlane == null) throw new ArgumentNullException(nameof(packedPlane));
            return new Dictionary<string, object?>
            {
                ["width"] = width,
                ["height"] = height,
                ["type"] = (int)scanTypeBit,
                ["bits"] = Convert.ToBase64String(packedPlane),
            };
        }

        /// <summary><c>SCANHeightGrid</c>: {width, height, minMetres, maxMetres, heights(base64 Int16 LE)}.</summary>
        public static Dictionary<string, object?> BuildHeightPayload(int width, int height, HeightGrid grid)
        {
            return new Dictionary<string, object?>
            {
                ["width"] = width,
                ["height"] = height,
                ["minMetres"] = (int)grid.MinMetres,
                ["maxMetres"] = (int)grid.MaxMetres,
                ["heights"] = Base64Int16LittleEndian(grid.Metres),
            };
        }

        /// <summary>One <c>SCANBiomeEntry</c>: {name, displayName, colour}.</summary>
        public static Dictionary<string, object?> BuildBiomeEntry(string name, string displayName, int colour) =>
            new Dictionary<string, object?>
            {
                ["name"] = name,
                ["displayName"] = displayName,
                ["colour"] = colour,
            };

        /// <summary><c>SCANBiomeGrid</c>: {width, height, biomes[], indices(base64 byte-per-cell)}.</summary>
        public static Dictionary<string, object?> BuildBiomePayload(int width, int height, List<object?> biomes, byte[] indices)
        {
            if (biomes == null) throw new ArgumentNullException(nameof(biomes));
            if (indices == null) throw new ArgumentNullException(nameof(indices));
            return new Dictionary<string, object?>
            {
                ["width"] = width,
                ["height"] = height,
                ["biomes"] = biomes,
                ["indices"] = Convert.ToBase64String(indices),
            };
        }

        private static short ClampToInt16(double value)
        {
            if (double.IsNaN(value)) return 0;
            if (value <= short.MinValue) return short.MinValue;
            if (value >= short.MaxValue) return short.MaxValue;
            return (short)Math.Round(value);
        }
    }
}
