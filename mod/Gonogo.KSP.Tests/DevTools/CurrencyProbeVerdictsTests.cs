using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// The three readings the currency-delay dev probe reports, exercised against the
    /// exact numbers a real rig run produced on 2026-08-27, when the probe could not
    /// express any of them and a night went into re-deriving them by hand.
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
    }
}
