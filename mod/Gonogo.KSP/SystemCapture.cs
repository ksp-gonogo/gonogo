namespace Gonogo.KSP
{
    /// <summary>
    /// Which parts of the game a sample can read.
    ///
    /// <para>The active vessel exists only in flight, once the game says
    /// flight is ready. The bodies exist in every scene of a loaded game, and
    /// are read there whatever the vessel list holds. The roster of every
    /// vessel exists in every scene of a loaded game too: the space centre, the tracking station
    /// and the editor hold the same vessels a flight does, unloaded. Read
    /// only in flight, a command centre's list stood still for as long as the
    /// player was out of it, and a craft that had never been seen in flight
    /// was on no list at all.</para>
    ///
    /// <para>The roster is read only from a vessel list that stands (see
    /// <see cref="VesselListStanding"/>): a list still being filled, as in an
    /// editor entered by reverting a flight, lists no craft, and that is not
    /// the same as there being none.</para>
    /// </summary>
    public static class SystemCapture
    {
        /// <param name="globalsPresent">Whether the game's flight globals exist at all.</param>
        /// <param name="flightReady">The game's own <c>FlightGlobals.ready</c>.</param>
        public static bool ReadsTheActiveVessel(bool globalsPresent, bool flightReady) => globalsPresent && flightReady;

        /// <summary>
        /// Whether the celestial bodies are read: in every scene of a loaded
        /// game, whatever the vessel list holds. The game loads the bodies once
        /// and no scene empties them. A vessel list that does not stand holds
        /// back the roster alone: in an editor a list with no vessels, in a save
        /// that holds some, does not stand for as long as the editor is open.
        /// </summary>
        /// <param name="globalsPresent">Whether the game's flight globals exist at all.</param>
        /// <param name="inAGame">Whether a game is loaded and the scene is one of its own: flight, the space centre, the tracking station or an editor.</param>
        public static bool ReadsTheBodies(bool globalsPresent, bool inAGame) => globalsPresent && inAGame;

        /// <param name="globalsPresent">Whether the game's flight globals exist at all.</param>
        /// <param name="inAGame">Whether a game is loaded and the scene is one of its own: flight, the space centre, the tracking station or an editor.</param>
        /// <param name="inFlight">Whether the loaded scene is flight.</param>
        /// <param name="flightReady">The game's own <c>FlightGlobals.ready</c>.</param>
        /// <param name="listed">How many vessels the live list holds.</param>
        /// <param name="inGameState">How many vessels the current game's own flight state holds, or null when it cannot be read.</param>
        public static bool ReadsTheSystem(bool globalsPresent, bool inAGame, bool inFlight, bool flightReady, int listed, int? inGameState)
        {
            if (!globalsPresent || !inAGame)
            {
                return false;
            }
            return VesselListStanding.Stands(inFlight, flightReady, false, listed, inGameState);
        }

        /// <summary>
        /// Whether the planted flags are listed: wherever the system is read, since a flag is a
        /// vessel the save holds whether or not it is loaded.
        /// </summary>
        /// <param name="readsTheSystem">The verdict of <see cref="ReadsTheSystem"/>.</param>
        public static bool ReadsPlantedFlags(bool readsTheSystem) => readsTheSystem;
    }
}
