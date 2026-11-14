using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Says whether a craft's bounds-path line is worth writing: once for each
    /// craft, and again only when its part count changes. The parts scan runs
    /// every few seconds for every craft in the game, so the last line written
    /// cannot be a single slot shared by all of them, or two craft in physics
    /// range write a line each at every scan.
    /// </summary>
    internal sealed class BoundsPathLogGate
    {
        private readonly Dictionary<string, int> partCounts = new Dictionary<string, int>();

        /// <summary>True the first time <paramref name="craftId"/> is seen and whenever its <paramref name="partCount"/> differs from the last one it was asked with.</summary>
        public bool ShouldLog(string craftId, int partCount)
        {
            if (partCounts.TryGetValue(craftId, out var last) && last == partCount)
            {
                return false;
            }

            partCounts[craftId] = partCount;
            return true;
        }
    }
}
