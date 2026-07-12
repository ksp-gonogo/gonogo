namespace Sitrep.Host
{
    /// <summary>
    /// Pure wall-clock cadence gate for <c>GonogoAddon.FixedUpdate</c>'s
    /// periodic recording flush: decides whether enough REAL (not in-game)
    /// time has passed since the last flush to justify writing the session
    /// file again.
    ///
    /// Wall-clock, not UT, is deliberately the measure here - the opposite
    /// choice from <see cref="SampleCadence"/>, which is UT-driven so
    /// sampling density tracks game time under warp. A flush is a
    /// "the file actually grew recently" guarantee for a user watching real
    /// elapsed minutes tick by in-game, so it must stay steady under
    /// time-warp (when UT can advance orders of magnitude faster than real
    /// time) instead of firing far too often, or effectively never, while
    /// warped.
    /// </summary>
    public static class FlushCadence
    {
        /// <summary>
        /// True once <paramref name="elapsedSinceLastFlushSeconds"/> of real
        /// time has reached <paramref name="intervalSeconds"/>. A
        /// non-positive interval always flushes, rather than deadlocking the
        /// periodic flush on a misconfiguration.
        /// </summary>
        public static bool ShouldFlush(double elapsedSinceLastFlushSeconds, double intervalSeconds)
        {
            return elapsedSinceLastFlushSeconds >= intervalSeconds;
        }
    }
}
