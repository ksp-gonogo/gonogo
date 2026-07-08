using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Pure (SCANsat/KSP-type-free) channel-topic conventions for the
    /// dynamic SCANsat channels — the sub-topic strings and the SCANtype
    /// set the CLIENT actually consumes.
    ///
    /// <para><b>The sub-topic type component is the NUMERIC SCANtype bit
    /// value, not the enum name.</b> The client subscribes to
    /// <c>scansat.coverage.Kerbin.1</c> / <c>scansat.mask.Kerbin.256</c>
    /// (see <c>packages/core/src/schemas/telemachus.ts</c>'s <c>SCAN_TYPE</c>
    /// map and <c>packages/components/src/{Scanning,MapView}/index.tsx</c>'s
    /// <c>scansat.coverage.${bodyName}.${scanType}</c>), so the mod MUST
    /// publish under the same numeric strings — an earlier pass published
    /// <c>.AltimetryLoRes</c> (the name), which no client ever subscribes to.
    /// </para>
    /// </summary>
    public static class ScanChannels
    {
        /// <summary>
        /// The SCANtype bit values the client's <c>SCAN_TYPE</c> map exposes
        /// and the Scanning/MapView widgets request coverage/mask for —
        /// AltimetryLoRes(1), AltimetryHiRes(2), Biome(8), Anomaly(16),
        /// ResourceLoRes(128), ResourceHiRes(256). Kept in sync with
        /// <c>packages/core/src/schemas/telemachus.ts</c>'s <c>SCAN_TYPE</c>
        /// and asserted at the enum-value level by <see cref="VersionGuard"/>
        /// (AltimetryLoRes=1 / ResourceHiRes=256).
        /// </summary>
        public static readonly IReadOnlyList<short> ClientScanTypes = new short[]
        {
            1,   // AltimetryLoRes
            2,   // AltimetryHiRes
            8,   // Biome
            16,  // Anomaly
            128, // ResourceLoRes
            256, // ResourceHiRes
        };

        public const string CoveragePrefix = "scansat.coverage.";
        public const string MaskPrefix = "scansat.mask.";
        public const string HeightPrefix = "scansat.height.";
        public const string BiomePrefix = "scansat.biome.";

        /// <summary>Sub-topic (relative to <see cref="CoveragePrefix"/>/<see cref="MaskPrefix"/>) for one (body, numeric type): <c>"&lt;body&gt;.&lt;typeBit&gt;"</c>.</summary>
        public static string BodyTypeSubTopic(string bodyName, short scanTypeBit) => bodyName + "." + scanTypeBit;

        /// <summary>Sub-topic (relative to <see cref="HeightPrefix"/>/<see cref="BiomePrefix"/>) for one body: just the body name (height/biome are per-body, not per-type).</summary>
        public static string BodySubTopic(string bodyName) => bodyName;
    }
}
