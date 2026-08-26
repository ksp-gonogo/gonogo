using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The rule that a strategy's activation eligibility is allowed to have no
    /// answer.
    ///
    /// <para>Seeded by a live RP-1 career, where every Program on the wire
    /// carried <c>canActivate: false</c> beside
    /// <c>"eligibility check failed: NullReferenceException"</c>. Neither half
    /// was true: the game had not judged those Programs and refused them, and
    /// nothing had gone intermittently wrong. KSP simply cannot answer the
    /// question with the Administration Building shut, because
    /// <c>Strategy.CanBeActivated</c> reads the cap off a UI component that only
    /// exists while that screen is open.</para>
    /// </summary>
    public class StrategyEligibilityTests
    {
        [Fact]
        public void A_shut_Administration_Building_leaves_the_verdict_absent()
        {
            var eligibility = StrategyEligibility.AdministrationClosed();

            // Absent, never false. A false here is a fabricated refusal, and the
            // widget that consumes it disables the activate control and quotes
            // the reason back at the operator as though the game had spoken.
            Assert.Null(eligibility.CanActivate);
            Assert.Equal(StrategyEligibility.AdministrationClosedReason, eligibility.BlockedReason);
        }

        [Fact]
        public void The_unanswered_reason_names_what_the_operator_can_do_about_it()
        {
            // The whole difference between the old string and this one. An
            // operator can open the Administration Building; nobody can act on
            // "eligibility check failed".
            Assert.Contains("Administration Building", StrategyEligibility.AdministrationClosedReason);
        }

        [Fact]
        public void An_unexpected_throw_is_also_absent_rather_than_false()
        {
            var eligibility = StrategyEligibility.Threw("InvalidOperationException");

            Assert.Null(eligibility.CanActivate);
            Assert.Equal("eligibility check failed: InvalidOperationException", eligibility.BlockedReason);
        }

        [Fact]
        public void A_refusal_the_game_actually_made_is_carried_through_verbatim()
        {
            // The authority is KSP's and is never substituted for: its wording
            // reaches the operator unaltered, including its localisation.
            var eligibility = StrategyEligibility.Answered(false, "This Program has unmet requirements.");

            Assert.False(eligibility.CanActivate);
            Assert.Equal("This Program has unmet requirements.", eligibility.BlockedReason);
        }

        [Fact]
        public void A_yes_is_a_yes_with_no_reason_attached()
        {
            var eligibility = StrategyEligibility.Answered(true, "");

            Assert.True(eligibility.CanActivate);
            Assert.Equal("", eligibility.BlockedReason);
        }
    }
}
