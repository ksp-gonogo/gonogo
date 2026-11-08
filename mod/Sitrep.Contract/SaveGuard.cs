namespace Sitrep.Contract
{
    /// <summary>
    /// The capability id an <see cref="ISaveGuard"/> registers under. Shared, so
    /// any number of Uplinks can each forbid saving for their own reason.
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class SaveGuardCapability
    {
        /// <summary>The capability id, <c>"saveGuard"</c>.</summary>
        public const string Id = "saveGuard";
    }

    /// <summary>
    /// Lets an Uplink forbid a quicksave from mission control while its mod is in
    /// a state the game would not save through, such as a simulated flight. The
    /// operator is told only that the game cannot save right now. Register a
    /// provider under <see cref="SaveGuardCapability.Id"/>.
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface ISaveGuard : ISitrepProvider
    {
        /// <summary>
        /// Whether a quicksave must be refused now. Read on the main thread each
        /// time the mod decides, so it may read live game state. A guard that
        /// throws counts as forbidding.
        /// </summary>
        bool ForbidsSaving { get; }
    }
}
