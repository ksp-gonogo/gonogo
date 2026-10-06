namespace Gonogo.KSP
{
    /// <summary>
    /// Which parts of the game a sample can read.
    ///
    /// <para>The active vessel exists only in flight, once the game says
    /// flight is ready. The bodies and the roster of every vessel exist in
    /// every scene of a loaded game: the space centre, the tracking station
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
            return VesselListStanding.Stands(inFlight, flightReady, listed, inGameState);
        }
    }
}
