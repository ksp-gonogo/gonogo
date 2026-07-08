using System;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Extracts a single SCANtype's bit-plane out of a snapshotted
    /// <c>SCANdata.Coverage</c> grid and packs it byte-identically to the
    /// fork's <c>SCANCoverageBitmap</c> wire shape (MSB-first,
    /// <c>ilon*height+ilat</c>, south-pole row first — scansat-migration-
    /// spec.md §2.3). Pure functions over caller-supplied data; no SCANsat
    /// or KSP types involved, so this is unit-testable headlessly.
    /// </summary>
    public static class CoveragePlane
    {
        /// <summary>
        /// Packs one bit per (ilon,ilat) cell — 1 when
        /// <c>(coverage[ilon,ilat] &amp; scanType) != 0</c> — MSB-first
        /// within each byte, row-major over ilon then ilat
        /// (<c>ilon*height+ilat</c>).
        /// </summary>
        public static byte[] Pack(short[,] snapshot, short scanType)
        {
            if (snapshot == null) throw new ArgumentNullException(nameof(snapshot));

            int width = snapshot.GetLength(0);
            int height = snapshot.GetLength(1);
            int totalBits = width * height;
            byte[] packed = new byte[(totalBits + 7) >> 3];

            for (int ilon = 0; ilon < width; ilon++)
            {
                for (int ilat = 0; ilat < height; ilat++)
                {
                    if ((snapshot[ilon, ilat] & scanType) == 0) continue;
                    int bitIndex = ilon * height + ilat;
                    packed[bitIndex >> 3] |= (byte)(0x80 >> (bitIndex & 7));
                }
            }
            return packed;
        }

        /// <summary>
        /// True when the packed planes differ (either direction — bits set
        /// OR cleared, per the R7 keyframe-on-change model that must
        /// represent shrink/reset/quickload, spec §2.3 step 3/§2.3
        /// "why keyframe-on-change and not a set-only delta").
        /// </summary>
        public static bool PlaneChanged(byte[]? lastEmitted, byte[] current)
        {
            if (lastEmitted == null) return true;
            if (lastEmitted.Length != current.Length) return true;
            for (int i = 0; i < current.Length; i++)
            {
                if (lastEmitted[i] != current[i]) return true;
            }
            return false;
        }
    }
}
