using System;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Replicates SCANsat's own query-time elevation-tiering rule
    /// (SCANmap.terrainElevation, SCANmap.cs:1373/1378 — see
    /// docs/superpowers/specs/2026-07-18-scansat-legit-integration.md
    /// §1.2): HiRes coverage samples the exact query point; LoRes-only
    /// coverage samples the point snapped to the nearest 0.2 deg
    /// lat/lon; uncovered cells keep today's fallback (still sampled -
    /// the client's mask-gated reveal, not this method, withholds
    /// uncovered cells from the user). Pure, SCANsat/KSP-type-free: the
    /// hiRes/loRes booleans are the caller's job to resolve via
    /// SCANUtil.isCovered (untestable headlessly - see
    /// ScansatUplink.cs's CaptureOnMain).
    /// </summary>
    public static class TerrainTiering
    {
        /// <summary>
        /// SCANsat's own 0.2-degree grid-line truncation idiom
        /// (`(int)(v * 5.0) / 5` in the decompiled source, SCANmap.cs
        /// 1373/1378): truncate-toward-zero after scaling by 5, THEN
        /// divide by 5.0 as a float division to land back on a multiple
        /// of 0.2 - a literal "/5" integer division would collapse to a
        /// whole degree, not a 0.2-degree snap.
        /// </summary>
        public static double Snap02(double v) => (int)(v * 5.0) / 5.0;

        public static (double Lon, double Lat) ResolveSampleCoordinate(
            double lon, double lat, bool hiResCovered, bool loResCovered)
        {
            if (hiResCovered) return (lon, lat);
            if (loResCovered) return (Snap02(lon), Snap02(lat));
            return (lon, lat);
        }
    }
}
