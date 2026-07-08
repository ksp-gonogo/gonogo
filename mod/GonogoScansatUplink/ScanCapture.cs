using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// The opaque payload the SCANsat uplink's MAIN-THREAD capture produces
    /// and hands to its COURIER-THREAD handle (see
    /// <see cref="Sitrep.Contract.IUplinkHost.AddSampledSource"/> and
    /// <see cref="ScansatUplink"/>'s <c>CaptureOnMain</c>/<c>HandleOnCourier</c>).
    /// This is deliberately PLAIN, self-contained data — no live KSP/Unity
    /// object references (no <c>CelestialBody</c>, no SCANsat handles) — so
    /// every KSP-facing read has already happened on the main thread by the
    /// time the Courier-side handle (<see cref="ScanPublications.Compute"/>)
    /// runs. That KSP-free-ness is what lets the whole Courier-side path be
    /// compiled and exercised in the headless test project with no SCANsat/KSP
    /// DLLs present at all.
    /// </summary>
    internal sealed class ScanCapture
    {
        /// <summary>UT the capture was taken at (from the tick's snapshot) — every publication rides this timestamp.</summary>
        public double Ut;

        /// <summary>The active vessel's main body name — the sub-topic body component for every channel.</summary>
        public string BodyName = "";

        /// <summary>
        /// A per-read SNAPSHOT of the body's SCANdata coverage grid (already
        /// copied off the live array on the main thread), or null when SCANsat
        /// has no data for this body yet (never scanned) — in which case no
        /// coverage/mask is published.
        /// </summary>
        public short[,]? Coverage;

        /// <summary>
        /// Per client SCANtype bit -> coverage PERCENTAGE [0,100]
        /// (<c>SCANUtil.GetCoverage</c>), captured on the main thread. Null iff
        /// <see cref="Coverage"/> is null.
        /// </summary>
        public Dictionary<short, double>? CoveragePercents;

        /// <summary>
        /// True the FIRST time this body is visited: the (expensive, ~64800-
        /// point) stock PQS height + BiomeMap grids were built on the main
        /// thread and are carried below for a one-shot keyframe. False on every
        /// later visit (near-static, per spec §2.2) so the grids are neither
        /// rebuilt nor re-published.
        /// </summary>
        public bool IncludeHeightBiome;

        /// <summary>Valid iff <see cref="IncludeHeightBiome"/>: the packed stock-PQS elevation grid.</summary>
        public ScanGrids.HeightGrid HeightGrid;

        /// <summary>Valid iff <see cref="IncludeHeightBiome"/>: the body's biome legend entries.</summary>
        public List<object?>? BiomeEntries;

        /// <summary>Valid iff <see cref="IncludeHeightBiome"/>: the packed per-cell biome index grid.</summary>
        public byte[]? BiomeIndices;
    }
}
