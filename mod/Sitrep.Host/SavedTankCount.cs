namespace Sitrep.Host
{
    /// <summary>
    /// Which of a craft's tanks count towards its vessel-wide resource total, read
    /// the way the game reads a loaded craft: a tank whose resource flows between
    /// parts counts while its flow is enabled and it can give the resource up; a
    /// resource that never flows between parts (solid fuel, ablator, most life
    /// support supplies) counts in every part that carries it.
    /// </summary>
    public static class SavedTankCount
    {
        /// <param name="flowsBetweenParts">Whether the part's tank of this resource takes part in flow at all.</param>
        /// <param name="flowsOut">Whether the tank can give the resource up.</param>
        /// <param name="flowEnabled">Whether its flow is enabled, the switch an operator can lock a tank with.</param>
        public static bool Counts(bool flowsBetweenParts, bool flowsOut, bool flowEnabled) =>
            !flowsBetweenParts || (flowEnabled && flowsOut);
    }
}
