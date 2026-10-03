namespace Gonogo.KSP
{
    /// <summary>
    /// Whether the game knows a vessel's orbit, which is what stock's own map
    /// and Tracking Station ask before they draw one: an untracked asteroid or
    /// comet is a signal with no state vectors until the player tracks it, and
    /// the Tracking Station's level caps how many can be tracked at once. A
    /// roster that published every space object would show what the player
    /// cannot see.
    /// </summary>
    internal static class OrbitKnowledge
    {
        /// <param name="level">The vessel's <c>DiscoveryInfo.Level</c>. An owned craft is <c>Owned</c>, every bit set.</param>
        public static bool Known(DiscoveryLevels level) =>
            (level & DiscoveryLevels.StateVectors) == DiscoveryLevels.StateVectors;
    }
}
