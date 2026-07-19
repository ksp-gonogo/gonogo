using System;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Replicates SCANsat's own query-time elevation-tiering rule
    /// (SCANmap.terrainElevation, SCANmap.cs:1373/1378 — see
    /// docs/superpowers/specs/2026-07-18-scansat-legit-integration.md
    /// §1.2): HiRes coverage samples the exact query point; LoRes-only
    /// coverage samples the point truncated to the whole degree
    /// containing it (truncation-toward-zero, not rounding); uncovered
    /// cells keep today's fallback (still sampled -
    /// the client's mask-gated reveal, not this method, withholds
    /// uncovered cells from the user). Pure, SCANsat/KSP-type-free: the
    /// hiRes/loRes booleans are the caller's job to resolve via
    /// SCANUtil.isCovered (untestable headlessly - see
    /// ScansatUplink.cs's CaptureOnMain).
    /// </summary>
    public static class TerrainTiering
    {
        /// <summary>
        /// SCANsat's own LoRes coordinate-snap idiom (`(int)(v * 5.0) / 5`
        /// in the decompiled source, SCANmap.cs 1373/1378). The divisor
        /// is a literal `5` (int), and `(int)(v * 5.0)` is already an
        /// int, so the whole expression is INTEGER division - it
        /// truncates a second time, discarding the *5 scaling entirely.
        /// Algebraically this collapses to plain whole-degree
        /// truncation-toward-zero: `(double)(int)v`. It is NOT a
        /// 0.2-degree grid snap (that misreading would require the
        /// divisor to be `5.0`, a float).
        /// </summary>
        public static double Snap02(double v) => (double)(int)v;

        public static (double Lon, double Lat) ResolveSampleCoordinate(
            double lon, double lat, bool hiResCovered, bool loResCovered)
        {
            if (hiResCovered) return (lon, lat);
            if (loResCovered) return (Snap02(lon), Snap02(lat));
            return (lon, lat);
        }
    }
}
