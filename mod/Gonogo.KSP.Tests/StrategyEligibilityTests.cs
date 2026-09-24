using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The rule that a strategy's activation eligibility is allowed to have no
    /// answer, and has to say who gave the one it has.
    ///
    /// <para>Seeded by a live RP-1 career, where every Program on the wire
    /// carried <c>canActivate: false</c> beside
    /// <c>"eligibility check failed: NullReferenceException"</c>. Neither half
    /// was true: the game had not judged those Programs and refused them, and
    /// nothing had gone intermittently wrong. KSP's own
    /// <c>Strategy.CanBeActivated</c> reads the cap off a UI component that only
    /// exists while the Administration Building is open, so with it shut nobody
    /// could answer for any strategy on the roster.</para>
    ///
    /// <para>The arms are now put one at a time instead
    /// (<see cref="StrategyActivationRule"/>), so the absent case is no longer
    /// the whole roster. It still has to exist, and these pin that it does.</para>
    /// </summary>
    public class StrategyEligibilityTests
    {
        [Fact]
        public void An_arm_nobody_could_put_leaves_the_verdict_absent()
        {
            var eligibility = StrategyEligibility.Unasked("this career's strategy limits could not be read");

            // Absent, never false. A false here is a fabricated refusal, and the
            // widget that consumes it disables the activate control and quotes
            // the reason back at the operator as though the game had spoken.
            Assert.Null(eligibility.CanActivate);
            Assert.Equal(StrategyEligibility.NoSource, eligibility.VerdictSource);
        }

        [Fact]
        public void The_unanswered_reason_says_it_is_unknown_rather_than_refused()
        {
            var eligibility = StrategyEligibility.Unasked("this career's strategy limits could not be read");

            // The whole difference between this and a refusal. Nobody can act on
            // "eligibility check failed", and nobody should read an unanswered
            // question as a no.
            Assert.StartsWith("unknown: ", eligibility.BlockedReason);
        }

        [Fact]
        public void An_unexpected_throw_is_also_absent_rather_than_false()
        {
            var eligibility = StrategyEligibility.Threw("InvalidOperationException");

            Assert.Null(eligibility.CanActivate);
            Assert.Equal("eligibility check failed: InvalidOperationException", eligibility.BlockedReason);
            Assert.Equal(StrategyEligibility.NoSource, eligibility.VerdictSource);
        }

        [Fact]
        public void A_refusal_the_game_actually_made_is_carried_through_verbatim()
        {
            // The authority is KSP's and is never substituted for: its wording
            // reaches the operator unaltered, including its localisation.
            var eligibility = StrategyEligibility.Screened(false, "This Program has unmet requirements.");

            Assert.False(eligibility.CanActivate);
            Assert.Equal("This Program has unmet requirements.", eligibility.BlockedReason);
            Assert.Equal(StrategyEligibility.ScreenedSource, eligibility.VerdictSource);
        }

        [Fact]
        public void A_yes_is_a_yes_with_no_reason_attached()
        {
            var eligibility = StrategyEligibility.Screened(true, "");

            Assert.True(eligibility.CanActivate);
            Assert.Equal("", eligibility.BlockedReason);
        }

        [Fact]
        public void A_derived_verdict_is_told_apart_from_one_the_game_screened()
        {
            // The two carry the same verdict and must not be confused: a derived
            // yes is sound to show and unsound to arm a control from, because
            // KSP's own activation path is reachable only through that screen.
            var screened = StrategyEligibility.Screened(true, "");
            var derived = StrategyEligibility.Derived(true, "");

            Assert.Equal(screened.CanActivate, derived.CanActivate);
            Assert.NotEqual(screened.VerdictSource, derived.VerdictSource);
            Assert.Equal(StrategyEligibility.DerivedSource, derived.VerdictSource);
        }
    }
}
