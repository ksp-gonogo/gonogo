namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// When the scene's ground stations must be searched for again rather than taken
    /// from the list last found. A station is a command centre once it has a CommNet
    /// node (the space centre is one without), and a station built after the scene
    /// loaded joins the CommNet network with its node, so while the network holds as
    /// many station nodes as it did when the list was found, no station can have been
    /// added that would be a centre. The list is also searched again on a scene change, when one
    /// of its stations is destroyed, and every <see cref="FallbackSeconds"/> whatever
    /// else holds.
    /// </summary>
    internal static class HomeSearchRule
    {
        /// <summary>The longest a found list is kept, real seconds, however steady the network.</summary>
        public const float FallbackSeconds = 60f;

        /// <param name="haveList">Whether a list was found before, and it held at least one station.</param>
        /// <param name="intact">Whether every station on it still exists.</param>
        /// <param name="sameScene">Whether it was found in the scene now loaded.</param>
        /// <param name="ageSeconds">Real seconds since it was found; negative when the clock went back.</param>
        /// <param name="stationNodesNow">Station nodes in the CommNet network now, or null with no network.</param>
        /// <param name="stationNodesKept">Station nodes the network held when the list was found, or null with no network then.</param>
        public static bool SearchAgain(bool haveList, bool intact, bool sameScene, float ageSeconds, int? stationNodesNow, int? stationNodesKept)
        {
            if (!haveList || !intact || !sameScene)
            {
                return true;
            }
            if (ageSeconds < 0f || ageSeconds >= FallbackSeconds)
            {
                return true;
            }
            return stationNodesNow != stationNodesKept;
        }
    }
}
