using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// The craft the books tied each kerbal's death to, by name, for a death
    /// that leaves its craft standing. Whatever else reports the death names
    /// the same craft. Main thread only.
    /// </summary>
    internal static class CrewDeathTies
    {
        private static readonly Dictionary<string, Vessel> TiedTo = new Dictionary<string, Vessel>(StringComparer.Ordinal);

        internal static void Tie(string kerbalName, Vessel craft) => TiedTo[kerbalName] = craft;

        /// <summary>The craft the kerbal's death was tied to, handed over once, or null when the books tied it to none.</summary>
        internal static Vessel? Take(string? kerbalName)
        {
            if (string.IsNullOrEmpty(kerbalName) || !TiedTo.TryGetValue(kerbalName!, out var craft))
            {
                return null;
            }
            TiedTo.Remove(kerbalName!);
            return craft;
        }

        internal static void Clear() => TiedTo.Clear();
    }
}
