using System.Globalization;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The decisions <see cref="GonogoDevCurrency"/>'s result file reports, carved out
    /// of the addon so they carry no KSP/Unity type and can be exercised headlessly.
    /// The addon itself is a MonoBehaviour polling live balances and the live CommNet
    /// graph, so not one line of it runs outside a game; these three answers are the
    /// whole of what a reader of the result file actually reasons from, and they are
    /// the part that can be got wrong quietly.
    /// </summary>
    internal static class CurrencyProbeVerdicts
    {
        /// <summary>
        /// Tolerance, in seconds, for calling a reveal offset "exactly the silence
        /// deadline". The offset is a difference of two doubles that were themselves
        /// summed through the aggregator, so an exact compare would miss by an ulp and
        /// report a routed light-time that happens to equal a Kerbin day.
        /// </summary>
        private const double MatchToleranceSeconds = 0.001;

        /// <summary>
        /// What a ledger row's reveal offset SAYS about how its delay was decided.
        ///
        /// <para>This is the reading that was missing on the night this probe was
        /// extended: a row whose reveal is one silence-declaration deadline after its
        /// event was classed <c>Unroutable</c>, and a row whose reveal is a plausible
        /// light-time was routed, and the two are told apart by arithmetic nobody was
        /// doing by hand at 3am. Derived, not observed - the row does not record which
        /// branch produced it - so it is reported beside the ROUTE node's directly
        /// observed answer, and a disagreement between the two is itself a finding.</para>
        /// </summary>
        internal static string ClassifyRevealOffset(double revealUt, double eventUt, double silenceDeclarationSeconds)
        {
            var offset = revealUt - eventUt;

            if (offset < -MatchToleranceSeconds)
            {
                return "IN THE PAST by " + Seconds(-offset) + " (a reveal that already passed; this row should have been popped)";
            }

            if (offset <= MatchToleranceSeconds)
            {
                return "instant (zero delay: either delay is off, or the event was classed home/recovered)";
            }

            if (silenceDeclarationSeconds > 0.0
                && offset >= silenceDeclarationSeconds - MatchToleranceSeconds
                && offset <= silenceDeclarationSeconds + MatchToleranceSeconds)
            {
                return "UNROUTABLE (offset is exactly the silence-declaration deadline, " + Seconds(silenceDeclarationSeconds)
                    + "; no control path home was found, so no light-time was measured)";
            }

            return "routed (light-time " + Seconds(offset) + ")";
        }

        /// <summary>
        /// Whether the dev comms override is actually observed by the currency arm's
        /// route read, answered from three observations rather than asserted.
        ///
        /// <para><b>Why this is not a constant.</b> It is knowable from the source that
        /// <c>DevCommsOverride</c> feeds only the reveal gate and the
        /// <c>comms.connectivity</c> payload, and never <c>vessel.connection</c>, which
        /// is what <c>FleetCommsReader</c> reads. A field that printed that conclusion
        /// would read the same whether it stayed true or not, which is the failure mode
        /// this whole probe exists to avoid. So it is measured: when the override
        /// DISAGREES with the real link, whichever of the two the route read followed
        /// names the answer. When they agree there is nothing to tell apart, and it
        /// says so instead of guessing.</para>
        /// </summary>
        /// <param name="overrideMode">null = no override in force; true = forced connected; false = forced blackout.</param>
        /// <param name="rawCommNetConnected">What the live CommNet connection reports, before any override.</param>
        /// <param name="routeReadFoundAPath">Whether the currency arm's own route read produced a light-time.</param>
        internal static string JudgeOverrideReach(bool? overrideMode, bool rawCommNetConnected, bool routeReadFoundAPath)
        {
            if (!overrideMode.HasValue)
            {
                return "(indeterminate: no override in force, so there is nothing for the route read to have followed)";
            }

            if (overrideMode.Value == rawCommNetConnected)
            {
                return "(indeterminate: the override asks for the state the real link is already in, so the two cannot be told apart)";
            }

            return routeReadFoundAPath == overrideMode.Value
                ? "YES - the route read followed the override, not the real link"
                : "NO - the route read followed the REAL link and ignored the override, so this run had no comms control";
        }

        /// <summary>
        /// Whether a request id should be applied, given what this process has already
        /// applied and what the on-disk stamp from earlier processes says.
        ///
        /// <para>The stamp is the half that was missing. A request cfg persists, and the
        /// process-scoped guard resets with the process, so every KSP start silently
        /// re-awarded whatever request was still on disk: on the night this was written
        /// that fabricated a ledger row and polluted a before/after pair twice, and the
        /// fabricated row was the one <c>firstPending</c> then reported.</para>
        /// </summary>
        internal static bool ShouldApply(string? requestId, string? processLastApplied, string? diskLastApplied)
        {
            if (string.IsNullOrEmpty(requestId))
            {
                return false;
            }

            return !string.Equals(requestId, processLastApplied, System.StringComparison.Ordinal)
                && !string.Equals(requestId, diskLastApplied, System.StringComparison.Ordinal);
        }

        private static string Seconds(double value) =>
            value.ToString("F3", CultureInfo.InvariantCulture) + "s";
    }
}
