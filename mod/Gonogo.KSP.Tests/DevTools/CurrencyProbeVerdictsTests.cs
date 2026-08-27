using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// The readings the currency-delay dev probe reports, exercised against the exact
    /// numbers real rig runs produced on 2026-08-27, when the probe could not express
    /// any of them and a night went into re-deriving them by hand.
    ///
    /// <para><see cref="CurrencyProbeVerdicts.RefuseTrigger"/> is covered here for a
    /// second reason: it gates a real recovery, a real vessel destruction and a real
    /// crew death, none of them undoable, so it has to be testable without needing a
    /// craft to lose in order to test it.</para>
    ///
    /// <para>Every case here is chosen so a WRONG answer is a different string, not a
    /// missing one: a verdict that read the same whether the subsystem worked or not
    /// would be worth nothing, which is the specific failure this probe was extended
    /// to avoid.</para>
    /// </summary>
    public class CurrencyProbeVerdictsTests
    {
        private const double StockKerbinDaySeconds = 21_600.0;

        [Fact]
        public void A_reveal_exactly_one_silence_deadline_out_is_named_unroutable()
        {
            // The row the rig actually held: enqueued at UT 2694.36, reveal 24294.36.
            // The difference is 21600 to the digit, which is the silence-declaration
            // policy deadline and not a light-time anybody measured.
            var verdict = CurrencyProbeVerdicts.ClassifyRevealOffset(
                revealUt: 24294.3599999978, eventUt: 2694.3599999978, silenceDeclarationSeconds: StockKerbinDaySeconds);

            Assert.Contains("UNROUTABLE", verdict);
            Assert.Contains("21600", verdict);
        }

        [Fact]
        public void A_reveal_at_earth_moon_light_time_is_named_routed()
        {
            // 384,400 km at the rig's lightSpeedScale = 0.1 is ~12.82s one-way: the
            // number the operator expected and never saw.
            var verdict = CurrencyProbeVerdicts.ClassifyRevealOffset(
                revealUt: 2707.18, eventUt: 2694.36, silenceDeclarationSeconds: StockKerbinDaySeconds);

            Assert.Contains("routed", verdict);
            Assert.Contains("12.820", verdict);
            Assert.DoesNotContain("UNROUTABLE", verdict);
        }

        [Fact]
        public void A_zero_offset_is_named_instant_rather_than_a_zero_second_route()
        {
            var verdict = CurrencyProbeVerdicts.ClassifyRevealOffset(
                revealUt: 2694.36, eventUt: 2694.36, silenceDeclarationSeconds: StockKerbinDaySeconds);

            Assert.Contains("instant", verdict);
            Assert.DoesNotContain("routed", verdict);
        }

        [Fact]
        public void A_reveal_already_in_the_past_is_called_out_rather_than_read_as_routed()
        {
            // A row still sitting in the ledger with a reveal behind it means the pop
            // is not running, which is a different defect from any delay figure and
            // must not be filed under "routed".
            var verdict = CurrencyProbeVerdicts.ClassifyRevealOffset(
                revealUt: 2600.0, eventUt: 2694.36, silenceDeclarationSeconds: StockKerbinDaySeconds);

            Assert.Contains("IN THE PAST", verdict);
        }

        [Fact]
        public void A_light_time_that_happens_to_equal_a_day_is_not_mistaken_for_the_deadline()
        {
            // The tolerance is 1ms, so a genuinely measured 21,000s route stays routed.
            var verdict = CurrencyProbeVerdicts.ClassifyRevealOffset(
                revealUt: 23_694.36, eventUt: 2694.36, silenceDeclarationSeconds: StockKerbinDaySeconds);

            Assert.Contains("routed", verdict);
            Assert.DoesNotContain("UNROUTABLE", verdict);
        }

        [Fact]
        public void The_override_verdict_says_NO_when_the_route_read_followed_the_real_link()
        {
            // The rig's third run: force-comms mode=restore was in force, the real
            // CommNet link was down, and the route read still found no path. That is
            // the currency arm ignoring the override, and it means the run was not a
            // control at all.
            var verdict = CurrencyProbeVerdicts.JudgeOverrideReach(
                overrideMode: true, rawCommNetConnected: false, routeReadFoundAPath: false);

            Assert.StartsWith("NO", verdict);
        }

        [Fact]
        public void The_override_verdict_says_YES_when_the_route_read_followed_the_override()
        {
            var verdict = CurrencyProbeVerdicts.JudgeOverrideReach(
                overrideMode: true, rawCommNetConnected: false, routeReadFoundAPath: true);

            Assert.StartsWith("YES", verdict);
        }

        [Fact]
        public void The_override_verdict_refuses_to_answer_when_the_override_agrees_with_the_link()
        {
            // Forcing CONNECTED on a craft that is already connected proves nothing
            // either way, and reporting either answer from it would be a fabrication.
            var verdict = CurrencyProbeVerdicts.JudgeOverrideReach(
                overrideMode: true, rawCommNetConnected: true, routeReadFoundAPath: true);

            Assert.Contains("indeterminate", verdict);
        }

        [Fact]
        public void The_override_verdict_refuses_to_answer_with_no_override_in_force()
        {
            var verdict = CurrencyProbeVerdicts.JudgeOverrideReach(
                overrideMode: null, rawCommNetConnected: false, routeReadFoundAPath: false);

            Assert.Contains("indeterminate", verdict);
        }

        [Fact]
        public void A_request_already_applied_by_an_EARLIER_process_does_not_re_fire()
        {
            // The replay: the process guard is empty because this is a fresh KSP
            // start, and the request cfg is still on disk from last night.
            Assert.False(CurrencyProbeVerdicts.ShouldApply(
                requestId: "away-forced-comms-1", processLastApplied: null, diskLastApplied: "away-forced-comms-1"));
        }

        [Fact]
        public void A_request_already_applied_by_THIS_process_does_not_re_fire()
        {
            Assert.False(CurrencyProbeVerdicts.ShouldApply(
                requestId: "away-forced-comms-1", processLastApplied: "away-forced-comms-1", diskLastApplied: null));
        }

        [Fact]
        public void A_new_id_fires_even_with_a_stamp_from_a_previous_request()
        {
            Assert.True(CurrencyProbeVerdicts.ShouldApply(
                requestId: "away-forced-comms-2", processLastApplied: null, diskLastApplied: "away-forced-comms-1"));
        }

        [Fact]
        public void An_absent_id_never_fires()
        {
            Assert.False(CurrencyProbeVerdicts.ShouldApply(
                requestId: null, processLastApplied: null, diskLastApplied: null));
            Assert.False(CurrencyProbeVerdicts.ShouldApply(
                requestId: "", processLastApplied: null, diskLastApplied: null));
        }

        private const double Tolerance = 0.0005;

        [Fact]
        public void A_balance_that_did_not_move_with_a_row_queued_is_named_withheld()
        {
            // The science row the rig held on 2026-08-27: 25 science withheld, one
            // pending row, balance unmoved.
            var verdict = CurrencyProbeVerdicts.JudgeCurrencyMovement(
                readable: true, unreadableFault: "", delta: 0.0, newPendingRows: 1, tolerance: Tolerance);

            Assert.Contains("WITHHELD", verdict);
            Assert.Contains("1 row", verdict);
        }

        [Fact]
        public void A_balance_that_moved_with_a_row_still_queued_is_named_a_double_credit()
        {
            // The failure the whole subsystem is most dangerous for: the credit already
            // applied AND a row that will apply it again at reveal.
            var verdict = CurrencyProbeVerdicts.JudgeCurrencyMovement(
                readable: true, unreadableFault: "", delta: 25.0, newPendingRows: 1, tolerance: Tolerance);

            Assert.Contains("LANDED AND STILL PENDING", verdict);
            Assert.Contains("double-credit", verdict);
        }

        [Fact]
        public void A_balance_that_moved_with_nothing_queued_is_named_landed_and_says_nothing_is_queued()
        {
            var verdict = CurrencyProbeVerdicts.JudgeCurrencyMovement(
                readable: true, unreadableFault: "", delta: -18.7, newPendingRows: 0, tolerance: Tolerance);

            Assert.Contains("LANDED", verdict);
            Assert.DoesNotContain("PENDING", verdict);
            Assert.Contains("-18.700", verdict);
        }

        [Fact]
        public void An_unreadable_balance_is_unreadable_and_never_reads_as_no_movement()
        {
            // The defect this replaced: a missing ScenarioModule read as 0.0, and 0.0 is
            // also what an unmoved balance reads, so a save the probe could not measure
            // reported the same line as a clean run.
            var verdict = CurrencyProbeVerdicts.JudgeCurrencyMovement(
                readable: false, unreadableFault: "no Reputation instance on this save",
                delta: 0.0, newPendingRows: 0, tolerance: Tolerance);

            Assert.Contains("unreadable", verdict);
            Assert.Contains("no Reputation instance", verdict);
            Assert.DoesNotContain("no movement", verdict);
        }

        [Fact]
        public void An_unreadable_ledger_makes_a_moved_balance_unreadable_rather_than_landed()
        {
            // A moved balance with no ledger reading cannot be told from one that moved
            // and is queued to move again, which are opposite conclusions.
            var verdict = CurrencyProbeVerdicts.JudgeCurrencyMovement(
                readable: true, unreadableFault: "", delta: 25.0, newPendingRows: -1, tolerance: Tolerance);

            Assert.Contains("unreadable", verdict);
            Assert.DoesNotContain("LANDED (", verdict);
        }

        [Fact]
        public void A_movement_inside_the_tolerance_is_not_reported_as_a_movement()
        {
            var verdict = CurrencyProbeVerdicts.JudgeCurrencyMovement(
                readable: true, unreadableFault: "", delta: 0.0001, newPendingRows: 1, tolerance: Tolerance);

            Assert.Contains("WITHHELD", verdict);
        }

        [Fact]
        public void A_derived_quantity_that_moved_while_a_currency_was_withheld_is_named_a_leak()
        {
            // The measurement that opened this: 25 science withheld while RP-1's
            // confidenceEarned went 200 to 300 at earn time. An operator watching
            // confidence knew the science had arrived before the science did.
            var verdict = CurrencyProbeVerdicts.JudgeDerivedLeak(
                "confidenceEarned", readable: true, unreadableFault: "",
                before: 200.0, now: 300.0, withheldCurrencies: "Science", tolerance: Tolerance);

            Assert.Contains("LEAK", verdict);
            Assert.Contains("+100.000", verdict);
            Assert.Contains("Science", verdict);
        }

        [Fact]
        public void A_derived_quantity_that_held_still_while_a_currency_was_withheld_passes()
        {
            var verdict = CurrencyProbeVerdicts.JudgeDerivedLeak(
                "confidence", readable: true, unreadableFault: "",
                before: 700.0, now: 700.0, withheldCurrencies: "Science", tolerance: Tolerance);

            Assert.Contains("no leak observed", verdict);
            Assert.DoesNotContain("LEAK -", verdict);
        }

        [Fact]
        public void A_derived_quantity_with_nothing_withheld_is_indeterminate_rather_than_clean()
        {
            // A pass awarded for a test that never ran is the thing this whole probe is
            // built to refuse. Nothing withheld means there was no delayed information
            // available to leak.
            var verdict = CurrencyProbeVerdicts.JudgeDerivedLeak(
                "confidence", readable: true, unreadableFault: "",
                before: 700.0, now: 800.0, withheldCurrencies: "", tolerance: Tolerance);

            Assert.Contains("indeterminate", verdict);
            Assert.DoesNotContain("LEAK", verdict);
            Assert.DoesNotContain("no leak observed", verdict);
        }

        [Fact]
        public void An_unreadable_derived_quantity_says_so_and_never_reports_no_leak()
        {
            var verdict = CurrencyProbeVerdicts.JudgeDerivedLeak(
                "confidence", readable: false,
                unreadableFault: "RP0.Confidence is loaded but CurrentConfidence could not be found on it",
                before: 0.0, now: 0.0, withheldCurrencies: "Science", tolerance: Tolerance);

            Assert.Contains("unreadable", verdict);
            Assert.Contains("CurrentConfidence", verdict);
            Assert.DoesNotContain("no leak observed", verdict);
        }

        [Fact]
        public void An_unreadable_derived_quantity_with_no_recorded_reason_is_still_a_fault()
        {
            // An empty fault string is itself a broken instrument: something decided the
            // read failed and did not say why, and blank must not render as tidy.
            var verdict = CurrencyProbeVerdicts.JudgeDerivedLeak(
                "confidence", readable: false, unreadableFault: "",
                before: 0.0, now: 0.0, withheldCurrencies: "Science", tolerance: Tolerance);

            Assert.Contains("itself a fault", verdict);
        }

        private static string? Refuse(
            string mode = "destroy",
            bool originResolved = true,
            string originSelector = "Probe Odyssey 3",
            bool originIsActiveVessel = false,
            string originName = "Probe Odyssey 3",
            string? confirm = "Probe Odyssey 3",
            bool currencyGiven = false,
            bool amountGiven = false,
            bool reasonGiven = false) =>
            CurrencyProbeVerdicts.RefuseTrigger(
                mode, originResolved, originSelector, originIsActiveVessel, originName, confirm,
                currencyGiven, amountGiven, reasonGiven);

        [Fact]
        public void A_well_formed_trigger_request_is_accepted()
        {
            Assert.Null(Refuse());
        }

        [Fact]
        public void A_trigger_with_no_resolvable_origin_is_refused()
        {
            var refusal = Refuse(originResolved: false, originSelector: "Odyssey 4", originName: "");

            Assert.NotNull(refusal);
            Assert.Contains("'Odyssey 4'", refusal!);
        }

        [Fact]
        public void A_trigger_on_the_active_vessel_is_refused_with_the_reason_it_would_fail()
        {
            // Recovery would be refused by stock itself and leave a request reading as
            // applied having done nothing; destruction would tear down the scene the
            // samples are read from. Two different reasons, both named.
            var recover = Refuse(mode: "recover", originIsActiveVessel: true);
            var destroy = Refuse(mode: "destroy", originIsActiveVessel: true);

            Assert.Contains("Cannot remove", recover!);
            Assert.Contains("unloading", destroy!);
        }

        [Fact]
        public void A_trigger_whose_confirm_does_not_repeat_the_resolved_name_is_refused()
        {
            // The request cfg is synced and persists, so a request written for one craft
            // must not destroy whichever craft answers to the selector today.
            var refusal = Refuse(confirm: "Probe Odyssey 2");

            Assert.NotNull(refusal);
            Assert.Contains("Probe Odyssey 3", refusal!);
            Assert.Contains("'Probe Odyssey 2'", refusal!);
        }

        [Fact]
        public void A_trigger_with_an_absent_confirm_is_refused()
        {
            Assert.NotNull(Refuse(confirm: null));
        }

        [Fact]
        public void A_trigger_naming_the_award_fields_is_refused_rather_than_ignoring_them()
        {
            // In a trigger mode the GAME decides currency, amount and reason. A request
            // naming them was written for an award mode, so accepting it silently would
            // hand back a result file measuring something other than what was asked.
            var refusal = Refuse(currencyGiven: true, amountGiven: true, reasonGiven: true);

            Assert.NotNull(refusal);
            Assert.Contains("currency, amount, reason", refusal!);
        }

        [Fact]
        public void The_origin_check_runs_before_the_confirm_check()
        {
            // With nothing resolved there is no name for confirm to have matched, so a
            // confirm complaint there would send the operator after the wrong field.
            var refusal = Refuse(originResolved: false, originName: "", confirm: null);

            Assert.Contains("resolvable 'origin'", refusal!);
        }

        [Fact]
        public void Destroying_a_crewless_craft_forecasts_nothing_and_says_that_is_correct()
        {
            // Reputation.OnCrewKilled is the only site in the stock assembly using
            // TransactionReasons.VesselLoss, and it fires off ProtoCrewMember.Die(). So
            // an empty probe destroyed produces no reputation change at all, and without
            // saying so first that reads exactly like a broken away arm.
            var forecast = CurrencyProbeVerdicts.ForecastTrigger("destroy", crewCount: 0);

            Assert.Contains("expect NOTHING", forecast);
            Assert.Contains("correct rather than a failure", forecast);
        }

        [Fact]
        public void Destroying_a_crewed_craft_forecasts_one_penalty_per_crew_member()
        {
            var forecast = CurrencyProbeVerdicts.ForecastTrigger("destroy", crewCount: 3);

            Assert.Contains("3 crew members", forecast);
            Assert.Contains("light-time", forecast);
        }

        [Fact]
        public void Recovery_forecasts_an_INSTANT_reveal_rather_than_a_light_time()
        {
            // Both recovery arms pass KscDelay.Instant unconditionally, so a run that
            // reveals at once is the design and not a defect.
            var forecast = CurrencyProbeVerdicts.ForecastTrigger("recover", crewCount: 0);

            Assert.Contains("INSTANTLY", forecast);
        }

        [Fact]
        public void A_crew_death_forecasts_the_gap_it_exists_to_show()
        {
            // No vessel destruction means no onVesselWillDestroy, so the interceptor has
            // nothing to correlate the VesselLoss penalty against and settles it HOME.
            var forecast = CurrencyProbeVerdicts.ForecastTrigger("crewdeath", crewCount: 1);

            Assert.Contains("HOME", forecast);
            Assert.Contains("instantly", forecast);
        }
    }
}
