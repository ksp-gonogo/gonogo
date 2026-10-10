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
    /// <para>In flight the game says so itself: <c>FlightGlobals.ready</c> is
    /// false from the request to change scene until the first physics frame
    /// that has a craft to fly, so once it is true the list is what exists,
    /// an empty one included, and a flight whose last craft is lost sees it
    /// go.</para>
    ///
    /// <para>The game clears that flag again when the craft being flown is
    /// lost, with the scene still up and the list intact. A list that stood
    /// earlier in this flight (see <see cref="VesselListWatch"/>) keeps
    /// standing until a scene load is requested, so the craft that was lost
    /// leaves the roster when the game removes it.</para>
    ///
    /// <para>Out of flight there is no such flag, and the sign is a list with
    /// no vessels in a game whose own state holds some. That state is as of
    /// the last save, and out of flight a craft leaves the list only by being
    /// recovered or terminated, each of which saves in the same call, so the
    /// two disagree only while a scene is filling its list.</para>
    /// </summary>
    public static class VesselListStanding
    {
        /// <param name="inFlight">Whether the loaded scene is flight.</param>
        /// <param name="flightReady">The game's own <c>FlightGlobals.ready</c>.</param>
        /// <param name="flightHeld">Whether the list stood earlier in this flight and no scene load has been requested since.</param>
        /// <param name="listed">How many vessels the live list holds.</param>
        /// <param name="inGameState">How many vessels the current game's own flight state holds, or null when it cannot be read.</param>
        public static bool Stands(bool inFlight, bool flightReady, bool flightHeld, int listed, int? inGameState)
        {
            if (inFlight)
            {
                return flightReady || flightHeld;
            }
            return listed > 0 || inGameState == null || inGameState.Value == 0;
        }
    }
}
