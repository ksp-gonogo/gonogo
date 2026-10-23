using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// The kerbals who boarded a craft. Stock fires <c>onCrewBoardVessel</c> and then kills
    /// the kerbal's own vessel, so every detector that reads a destruction asks here first:
    /// a kerbal who got back in neither crashed nor was lost, and the vessel stops being
    /// worth listing.
    ///
    /// <para>The boarding and the destruction it causes happen in one call, so a
    /// destruction counts as the boarding's only when it falls within
    /// <see cref="WindowUt"/> of it. The catalog keeps hiding the vessel for
    /// <see cref="LingerUt"/>, since stock can leave it listed for a few frames.</para>
    ///
    /// <para>Main thread only.</para>
    /// </summary>
    internal static class BoardedVessels
    {
        internal const double WindowUt = 1.0;

        internal const double LingerUt = 30.0;

        private static readonly Dictionary<string, double> Noted = new Dictionary<string, double>(StringComparer.Ordinal);

        internal static void Note(string vesselId, double ut) => Noted[vesselId] = ut;

        /// <summary>
        /// Whether a destruction of <paramref name="vesselId"/> at <paramref name="ut"/> is the one
        /// boarding causes. Reading does not consume the note, so every detector answers the same.
        /// </summary>
        internal static bool Covers(string vesselId, double ut) =>
            Noted.TryGetValue(vesselId, out var at) && Math.Abs(ut - at) <= WindowUt;

        /// <summary>Whether the vessel is one a kerbal boarded from a moment ago, and so is not to be listed.</summary>
        internal static bool Boarded(string vesselId, double ut) =>
            Noted.TryGetValue(vesselId, out var at) && ut >= at && ut - at <= LingerUt;

        internal static void Clear() => Noted.Clear();
    }
}
