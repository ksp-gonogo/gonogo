using System.Globalization;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The decisions <see cref="GonogoDevCurrency"/>'s result file reports, carved out
    /// of the addon so they carry no KSP/Unity type and can be exercised headlessly.
    /// The addon itself is a MonoBehaviour polling live balances and the live CommNet
    /// graph, so not one line of it runs outside a game; these answers are the whole of
    /// what a reader of the result file actually reasons from, and they are the part
    /// that can be got wrong quietly. <see cref="RefuseTrigger"/> is here for a second
    /// reason: it gates three irreversible acts, so it must be exercisable without
    /// needing a craft to lose in order to test it.
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

        /// <summary>
        /// What one currency's balance movement means, read together with how many
        /// ledger rows of that same currency this run put in flight.
        ///
        /// <para>The two figures separately are both ambiguous. A balance that did not
        /// move is a withheld credit or an award that never happened; a balance that
        /// moved is a credit that landed or one that landed AND is still queued to land
        /// again. Only the pair decides, and the pair was not being read: the matrix
        /// cell was being eyeballed off a column of raw balances.</para>
        ///
        /// <para><paramref name="readable"/> false is answered as unreadable and never
        /// as "no movement". A career with no <c>Funding</c> instance reads zero for
        /// funds, and zero is also what a genuinely unmoved balance reads, so a
        /// probe that let those share a shape would report a clean run on a save it
        /// could not measure at all.</para>
        /// </summary>
        internal static string JudgeCurrencyMovement(
            bool readable, string unreadableFault, double delta, int newPendingRows, double tolerance)
        {
            if (!readable)
            {
                return "(unreadable: " + Fault(unreadableFault) + ")";
            }

            if (newPendingRows < 0)
            {
                return "(unreadable: the ledger could not be read, so a moved balance cannot be told from one that moved and is queued to move again)";
            }

            var moved = System.Math.Abs(delta) > tolerance;

            if (moved && newPendingRows > 0)
            {
                return "LANDED AND STILL PENDING (" + Signed(delta) + " already applied, "
                    + Rows(newPendingRows) + " still queued) - this is the double-credit shape";
            }

            if (moved)
            {
                return "LANDED (" + Signed(delta) + ", nothing queued)";
            }

            if (newPendingRows > 0)
            {
                return "WITHHELD (balance unmoved, " + Rows(newPendingRows) + " queued)";
            }

            return "no movement and nothing queued";
        }

        /// <summary>
        /// Whether a quantity DERIVED from a currency moved while that currency was
        /// being withheld, which is the delayed information leaking out of the side of
        /// the subsystem.
        ///
        /// <para>Measured on 2026-08-27: 25 science was withheld with one pending row
        /// while RP-1's confidence went 700 to 800 and confidenceEarned 200 to 300, at
        /// earn time. An operator watching confidence therefore knows the science
        /// arrived before the science does, and in RP-1 confidence gates real career
        /// decisions, so the delay leaks through a channel it never modelled.</para>
        ///
        /// <para><b>The co-occurrence is the observation; the cause is not.</b> This says
        /// the derived quantity moved while the currency was withheld. That RP-1 credits
        /// confidence off a science award is a belief about RP0.dll, not something this
        /// probe reads, so the wording stays at what was seen.</para>
        ///
        /// <para><paramref name="withheldCurrencies"/> empty means nothing was in flight
        /// at this sample, which makes the reading INDETERMINATE rather than clean: a
        /// quantity cannot leak information that is not being withheld, so a "no leak"
        /// there would be a pass awarded for a test that never ran.</para>
        /// </summary>
        internal static string JudgeDerivedLeak(
            string quantityName,
            bool readable,
            string unreadableFault,
            double before,
            double now,
            string withheldCurrencies,
            double tolerance)
        {
            var name = string.IsNullOrEmpty(quantityName) ? "(unnamed quantity)" : quantityName;

            if (!readable)
            {
                return name + ": (unreadable: " + Fault(unreadableFault) + ")";
            }

            if (string.IsNullOrEmpty(withheldCurrencies))
            {
                return name + ": (indeterminate: nothing was being withheld at this sample, so there is no delayed"
                    + " information for it to have leaked)";
            }

            var delta = now - before;
            if (System.Math.Abs(delta) <= tolerance)
            {
                return name + ": no leak observed (held at " + Amount(now) + " while "
                    + withheldCurrencies + " was withheld)";
            }

            return name + ": LEAK - moved " + Signed(delta) + " (" + Amount(before) + " to " + Amount(now)
                + ") while " + withheldCurrencies + " was withheld, so this quantity reveals the credit"
                + " before the credit itself lands";
        }

        /// <summary>
        /// Why a trigger-mode request cannot be applied, or null when it can.
        ///
        /// <para>The trigger modes cause a REAL recovery, a REAL vessel destruction or a
        /// REAL crew death, because those are the only producers of the events that
        /// attribute funds and reputation to a place (see
        /// <c>GonogoDevCurrency</c>'s class doc). None of them is undoable, so every one
        /// of these refusals is load-bearing, and they are decided here rather than
        /// inline so they can be exercised without a game.</para>
        ///
        /// <para><paramref name="confirm"/> must repeat the resolved vessel's own name.
        /// The request cfg is synced, so it persists on disk and arrives on the rig
        /// without anyone re-reading it; the id-stamp stops a replay of the SAME
        /// request, and this stops a request written for one craft from destroying
        /// whichever craft answers to the origin selector today.</para>
        ///
        /// <para>A currency, amount or reason supplied alongside a trigger mode is a
        /// refusal rather than something ignored. In a trigger mode the GAME decides all
        /// three, and a request that names them is a request whose author believes the
        /// tool is awarding the currency - accepting it silently would hand back a
        /// result file measuring something other than what was asked for.</para>
        /// </summary>
        internal static string? RefuseTrigger(
            string mode,
            bool originResolved,
            string originSelector,
            bool originIsActiveVessel,
            string originName,
            string? confirm,
            bool currencyGiven,
            bool amountGiven,
            bool reasonGiven)
        {
            if (!originResolved)
            {
                return "attribute=" + mode + " needs a resolvable 'origin' vessel; "
                    + Describe(originSelector) + " matched nothing";
            }

            if (originIsActiveVessel)
            {
                return "attribute=" + mode + " refuses the ACTIVE vessel: " + WhyNotActive(mode);
            }

            var named = "";
            if (currencyGiven)
            {
                named = Join(named, "currency");
            }
            if (amountGiven)
            {
                named = Join(named, "amount");
            }
            if (reasonGiven)
            {
                named = Join(named, "reason");
            }
            if (named.Length > 0)
            {
                return "attribute=" + mode + " triggers the real game event and awards nothing itself, so the game"
                    + " decides currency, amount and reason; this request names " + named
                    + ", which means it was written for an award mode. Remove them, or use attribute=none";
            }

            if (!string.Equals(confirm, originName, System.StringComparison.Ordinal))
            {
                return "attribute=" + mode + " is not undoable, so it needs 'confirm' to repeat the resolved"
                    + " vessel's exact name. Resolved '" + originName + "', request said "
                    + Describe(confirm);
            }

            return null;
        }

        /// <summary>
        /// What a trigger mode is expected to produce, stated up front so a run that
        /// produced nothing can be told from a run that could never have produced
        /// anything.
        ///
        /// <para>A crewless craft destroyed generates no <c>VesselLoss</c> reputation
        /// change at all: <c>Reputation.OnCrewKilled</c> is the only site in the stock
        /// assembly that uses that reason, and it fires off
        /// <c>ProtoCrewMember.Die()</c>. So destroying an empty probe is a valid run
        /// with an empty result, and without saying so first that reads exactly like a
        /// broken away arm.</para>
        /// </summary>
        internal static string ForecastTrigger(string mode, int crewCount)
        {
            switch (mode)
            {
                case "recover":
                    return "expect funds, science and reputation changes under VesselRecovery, all three attributed"
                        + " to this vessel and all three revealed INSTANTLY (the recovery arms pass KscDelay.Instant"
                        + " by design, a recovered craft is in KSC's hands)"
                        + (crewCount > 0 ? "; " + Crew(crewCount) + " will be recovered to the roster" : "");

                case "destroy":
                    return crewCount > 0
                        ? "expect one VesselLoss reputation penalty per crew member (" + Crew(crewCount)
                            + " will DIE), attributed to this vessel and delayed to its light-time"
                        : "expect NOTHING: this craft has no crew, and the only producer of a VesselLoss reputation"
                            + " change is a crew death, so an empty result here is correct rather than a failure";

                case "crewdeath":
                    return crewCount > 0
                        ? "expect one VesselLoss reputation penalty and NO vessel destruction, which means no"
                            + " onVesselWillDestroy for the interceptor to correlate against: the penalty is"
                            + " expected to settle HOME and land instantly. That is the gap this mode exists to show"
                        : "expect NOTHING: this craft has no crew to kill";

                default:
                    return "(no forecast: not a trigger mode)";
            }
        }

        private static string WhyNotActive(string mode) =>
            mode == "recover"
                ? "ShipConstruction.RecoverVesselFromFlight refuses it too, logging '[Vessel Removal]: ... is the"
                    + " active vessel. Cannot remove.' and returning, which would leave a request that read as"
                    + " applied having done nothing"
                : "destroying the vessel the camera is on tears down the flight scene mid-measurement, and every"
                    + " sample after the trigger would be read off a scene that is unloading";

        private static string Crew(int count) =>
            count == 1 ? "1 crew member" : count.ToString(CultureInfo.InvariantCulture) + " crew members";

        private static string Rows(int count) =>
            count == 1 ? "1 row" : count.ToString(CultureInfo.InvariantCulture) + " rows";

        private static string Join(string existing, string addition) =>
            existing.Length == 0 ? addition : existing + ", " + addition;

        private static string Describe(string? raw) =>
            string.IsNullOrEmpty(raw) ? "(absent)" : "'" + raw + "'";

        private static string Fault(string? fault) =>
            string.IsNullOrEmpty(fault) ? "no reason recorded, which is itself a fault" : fault!;

        private static string Amount(double value) =>
            value.ToString("F3", CultureInfo.InvariantCulture);

        private static string Signed(double value) =>
            value.ToString("+0.000;-0.000;0.000", CultureInfo.InvariantCulture);

        private static string Seconds(double value) =>
            value.ToString("F3", CultureInfo.InvariantCulture) + "s";
    }
}
