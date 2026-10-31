using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// The time a craft file's part tree is published at. A tree stamped zero
    /// sits at the start of the game's timeline, a reading no client takes as
    /// current, so a capture made with no snapshot falls back to the game clock
    /// as every other sampled source does.
    /// </summary>
    internal static class CraftCaptureStamp
    {
        public static double Ut(double? snapshotUt, Func<double> universalTime) =>
            snapshotUt ?? universalTime();
    }
}
