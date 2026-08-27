using System.Globalization;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The decision <see cref="GonogoDevAntenna"/>'s result file reports about whether
    /// its boost is still standing, carved out of the addon so it carries no KSP/Unity
    /// type and can be exercised headlessly. Same reasoning as
    /// <see cref="CurrencyProbeVerdicts"/>: the addon is a MonoBehaviour reading a live
    /// CommNet graph, so not one line of it runs outside a game, and this is the part a
    /// reader actually reasons from.
    /// </summary>
    internal static class AntennaProbeVerdicts
    {
        /// <summary>
        /// What the boost's state is, from whether it stands, how many lapses this
        /// request saw, and how many times this craft's boost has been re-asserted.
        ///
        /// <para><b>Why this is not a boolean.</b> The boost is a set of KSPField writes
        /// on a live module, and a vessel reload re-instantiates that module from the
        /// save, so the boost vanishes silently. A lapsed boost and a boost that never
        /// worked produce the same unroutable craft, which is what made one run
        /// unreadable. Three distinct answers, because the operator does three different
        /// things with them: HOLDING means the reading stands, LAPSED means any reading
        /// taken across the lapse is suspect, and NOT WATCHED means the tool is not
        /// guarding this craft at all.</para>
        ///
        /// <para>NOT WATCHED is the one worth being careful about. A request that was
        /// refused, or that parsed and changed nothing, applies no standing boost, so
        /// nothing re-asserts it and a revert would go unreported. Reporting that as
        /// HOLDING would be the tool claiming to guard something it is not, which is the
        /// exact shape of instrument this whole probe family exists to refuse.</para>
        /// </summary>
        internal static string BoostState(bool standing, int lapsesThisRequest, int reassertions, double verifyIntervalSeconds)
        {
            if (!standing)
            {
                return "NOT WATCHED - this request applied no standing boost (it was refused, or it changed nothing),"
                    + " so nothing is re-asserting it and a revert would go unreported";
            }

            if (lapsesThisRequest <= 0 && reassertions <= 0)
            {
                return "HOLDING - checked every " + Interval(verifyIntervalSeconds)
                    + " against what the antenna actually holds, and it has not reverted";
            }

            // Re-assertions are counted per craft and lapses per request, so a boost
            // re-asserted before this request's watch began still reports LAPSED. That
            // is deliberate: the transience is a property of the craft's session, and a
            // request that happens to have missed a revert has no business calling the
            // boost sound.
            var count = reassertions > 0 ? reassertions : lapsesThisRequest;
            return "LAPSED AND RE-ASSERTED " + count.ToString(CultureInfo.InvariantCulture)
                + " time(s) - the boost does not survive a vessel reload, so any reading taken across one is suspect;"
                + " see the LAPSE nodes for when";
        }

        private static string Interval(double seconds) =>
            seconds > 0.0
                ? seconds.ToString("F0", CultureInfo.InvariantCulture) + "s"
                : "(unreadable interval, which means the verify cadence itself could not be stated)";
    }
}
