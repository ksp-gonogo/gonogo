namespace Sitrep.Core
{
    /// <summary>
    /// The stock Kerbin day, in seconds, written down once for the C# side.
    ///
    /// <para>The TypeScript side already had one of these
    /// (<c>STOCK_KERBIN_CALENDAR</c> in the sdk's unit-system); C# did not, so
    /// three separate policy defaults each spelled a day as 86,400. That is an
    /// EARTH day: a stock Kerbin day is a quarter of it, so every one of them
    /// meant four days rather than the one their doc comments claimed.</para>
    ///
    /// <para>A DEFAULT, not a measurement. Where a live calendar is available
    /// (the game's homeworld rotation period, which RSS and friends change) read
    /// that instead: this is what a policy falls back to when it has to answer
    /// before any game exists, which is the case for every field initialiser
    /// here.</para>
    /// </summary>
    public static class GameDayDefaults
    {
        /// <summary>Stock Kerbin's rotation, 6 hours.</summary>
        public const double StockDaySeconds = 21_600.0;
    }
}
