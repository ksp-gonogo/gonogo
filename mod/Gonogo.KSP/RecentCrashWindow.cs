using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// How long a crash already reported is kept for the debris that may still add to
    /// it, and when it belongs to no timeline the game is on.
    /// </summary>
    internal static class RecentCrashWindow
    {
        /// <summary>UT seconds either side of a crash in which its debris is still added to it.</summary>
        internal const double SpanUt = 30.0;

        /// <summary>
        /// Whether a crash at <paramref name="crashUt"/> is ahead of the game's clock at
        /// <paramref name="nowUt"/>: the game was loaded or reverted to before it, so it
        /// happened on a timeline that no longer exists.
        /// </summary>
        internal static bool Abandoned(double crashUt, double nowUt) => crashUt > nowUt + 0.001;

        /// <summary>Whether a crash at <paramref name="crashUt"/> is outside the span its debris is added to it in.</summary>
        internal static bool Expired(double crashUt, double nowUt) => Math.Abs(nowUt - crashUt) > SpanUt;
    }
}
