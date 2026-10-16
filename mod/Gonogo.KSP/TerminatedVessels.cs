using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// The craft the player ended from the Tracking Station. Stock then destroys the
    /// craft like any other, so every detector that reads a destruction asks here first:
    /// a terminated craft is neither lost nor a crash.
    ///
    /// <para>A termination and the destruction it causes happen at one instant, so a
    /// destruction counts as the termination's only when it falls within
    /// <see cref="WindowUt"/> of it. A craft of the same id destroyed after a quickload
    /// or a revert is a new event.</para>
    ///
    /// <para>Main thread only.</para>
    /// </summary>
    internal static class TerminatedVessels
    {
        internal const double WindowUt = 1.0;

        private static readonly Dictionary<string, double> Noted = new Dictionary<string, double>(StringComparer.Ordinal);

        internal static void Note(string vesselId, double ut) => Noted[vesselId] = ut;

        /// <summary>Whether a destruction of <paramref name="vesselId"/> at <paramref name="ut"/> is the termination the player made.</summary>
        internal static bool Covers(string vesselId, double ut) =>
            Noted.TryGetValue(vesselId, out var at) && Math.Abs(ut - at) <= WindowUt;

        /// <summary>Forgets <paramref name="vesselId"/>'s termination, once its destruction has been told apart.</summary>
        internal static void Forget(string vesselId) => Noted.Remove(vesselId);

        internal static void Clear() => Noted.Clear();
    }
}
