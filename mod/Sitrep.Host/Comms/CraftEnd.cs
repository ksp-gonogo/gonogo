namespace Sitrep.Host.Comms
{
    /// <summary>How a craft left the game.</summary>
    public enum CraftEnd
    {
        /// <summary>
        /// It left with no word of how: docked into another craft, which the game
        /// raises no event for, or removed some other way the game gave no sign of.
        /// </summary>
        Absorbed,

        /// <summary>It was destroyed.</summary>
        Destroyed,

        /// <summary>It was recovered.</summary>
        Recovered,
    }
}
