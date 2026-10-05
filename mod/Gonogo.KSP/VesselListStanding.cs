namespace Gonogo.KSP
{
    /// <summary>
    /// Whether the game's list of vessels can be read as what exists.
    ///
    /// <para>While a scene loads the game empties its vessel list and fills it
    /// again from the save, over several seconds. A list read in that gap says
    /// nothing exists, and taken at its word every craft would be recorded as
    /// seen to go, each command centre learning of it one light-time later and
    /// of its return a scene-load after that. Not being able to see is not
    /// seeing nothing, so nothing is read from the list until it stands.</para>
    ///
    /// <para>Two signs it is not standing. In flight the game says so itself
    /// (<c>FlightGlobals.ready</c> is false from the request to change scene
    /// until the first physics frame of the next). In every scene, a list
    /// with no vessels in a game whose own state holds some has not been
    /// filled yet.</para>
    ///
    /// <para>The game's own state is as of its last save. A game whose last
    /// vessel has just been lost therefore reads as not standing until the
    /// game next saves, which it does on recovery and on every scene change:
    /// until then the lost craft is not reported as gone.</para>
    /// </summary>
    public static class VesselListStanding
    {
        /// <param name="inFlight">Whether the loaded scene is flight.</param>
        /// <param name="flightReady">The game's own <c>FlightGlobals.ready</c>.</param>
        /// <param name="listed">How many vessels the live list holds.</param>
        /// <param name="inGameState">How many vessels the current game's own flight state holds, or null when it cannot be read.</param>
        public static bool Stands(bool inFlight, bool flightReady, int listed, int? inGameState)
        {
            if (inFlight && !flightReady)
            {
                return false;
            }
            return listed > 0 || inGameState == null || inGameState.Value == 0;
        }
    }
}
