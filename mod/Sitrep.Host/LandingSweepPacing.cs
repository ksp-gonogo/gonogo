using System;

namespace Sitrep.Host
{
    /// <summary>
    /// How much of a terrain sweep one sample reads, so the reads are spread over the
    /// samples a sweep spans rather than taken in one long frame, and the sweep still
    /// finishes within its time at whatever rate the game is being sampled.
    /// </summary>
    public static class LandingSweepPacing
    {
        /// <summary>
        /// The items (bearings, rows) of <paramref name="total"/> to read this sample, at
        /// one sample every <paramref name="sampleIntervalSeconds"/>, to finish within
        /// <paramref name="sweepSeconds"/>. All of them when the interval is unknown or
        /// already as long as the sweep may take.
        /// </summary>
        public static int PerSample(int total, double sampleIntervalSeconds, double sweepSeconds)
        {
            if (total <= 0)
            {
                return 0;
            }
            if (!(sampleIntervalSeconds > 0) || !(sweepSeconds > 0) || double.IsInfinity(sampleIntervalSeconds))
            {
                return total;
            }

            var share = Math.Ceiling(total * sampleIntervalSeconds / sweepSeconds);
            return (int)Math.Max(1, Math.Min(total, share));
        }
    }
}
