using System;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Coarse poll-hash of a snapshotted <c>SCANdata.Coverage</c>
    /// (<c>Int16[360,180]</c>) plane — the R7 change-detection signal
    /// (scansat-migration-spec.md §0A/§2.1). This is a pure function over a
    /// caller-supplied snapshot; it does not touch SCANsat or KSP types, so
    /// it is unit-testable headlessly (net10.0, no SCANsat.dll needed).
    ///
    /// FNV-1a over the raw Int16 bytes (little-endian) — fast, non-crypto,
    /// good-enough avalanche for a change signal (we only ever compare
    /// equality, never trust it as a security hash).
    /// </summary>
    public static class CoverageHash
    {
        private const ulong FnvOffsetBasis = 14695981039346656037UL;
        private const ulong FnvPrime = 1099511628211UL;

        public static ulong Hash(short[,] snapshot)
        {
            if (snapshot == null) throw new ArgumentNullException(nameof(snapshot));

            ulong hash = FnvOffsetBasis;
            int width = snapshot.GetLength(0);
            int height = snapshot.GetLength(1);
            for (int i = 0; i < width; i++)
            {
                for (int j = 0; j < height; j++)
                {
                    short v = snapshot[i, j];
                    hash ^= (byte)(v & 0xFF);
                    hash *= FnvPrime;
                    hash ^= (byte)((v >> 8) & 0xFF);
                    hash *= FnvPrime;
                }
            }
            return hash;
        }

        /// <summary>
        /// True when <paramref name="snapshot"/>'s hash differs from
        /// <paramref name="lastHash"/> (or there was no previous hash) —
        /// the body-level "did anything change" gate before per-type plane
        /// extraction (spec §2.3 step 2).
        /// </summary>
        public static bool HasChanged(short[,] snapshot, ulong? lastHash, out ulong newHash)
        {
            newHash = Hash(snapshot);
            return lastHash == null || newHash != lastHash.Value;
        }
    }
}
