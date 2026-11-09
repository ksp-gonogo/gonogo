namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Whether a crewed craft is a command centre, as a rule with no game type in
    /// it so it can be tested without KSP.
    ///
    /// <para>Two ways in. A craft CommNet counts as a control source that
    /// something can reach is a centre others may command from or through. And
    /// the craft being flown, with crew aboard, is a seat that commands that
    /// craft itself with no signal delay, whatever antennas it carries: the crew
    /// need no route to their own craft. The second way covers that one craft
    /// only; it reaches any other craft over the routes CommNet has, like any
    /// centre.</para>
    /// </summary>
    public static class CrewedSeatRule
    {
        public static bool QualifiesAsSeat(bool isActiveCraft, int crewAboard, bool isControlSource, bool reachable) =>
            (isControlSource && reachable) || (isActiveCraft && crewAboard > 0);

        /// <summary>
        /// The same rule for a craft CommNet has not built a node for yet, as in the
        /// first seconds after a flight loads: with no node there is no control-source
        /// or reach to ask, but the crew aboard the craft being flown are a seat all
        /// the same, so it is listed from the first tick instead of being refused as
        /// an unknown vantage until the network catches up.
        /// </summary>
        public static bool QualifiesAsSeat(bool hasNode, bool isActiveCraft, int crewAboard, bool isControlSource, bool reachable) =>
            hasNode
                ? QualifiesAsSeat(isActiveCraft, crewAboard, isControlSource, reachable)
                : isActiveCraft && crewAboard > 0;
    }
}
