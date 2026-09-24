using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The arms of <c>Strategy.CanBeActivated</c>, put one at a time so a console
    /// career can be told what its save refuses without the Administration
    /// Building.
    ///
    /// <para>Each arm here mirrors a comparison read out of the installed
    /// <c>Assembly-CSharp</c>. What earns the most from a test is not any single
    /// arm but the SHAPE of the answer: this walk refuses, or it declines to
    /// answer, and it never says yes. Arm 1 compares a counter that lives on the
    /// shut screen and that RP-1 overwrites, so it cannot be put at all, and a
    /// pass is owed to every arm. A yes reached without it would be a fabricated
    /// permission arming a spend.</para>
    /// </summary>
    public class StrategyActivationRuleTests
    {
        /// <summary>
        /// A career where nothing refuses and everything reachable is readable.
        /// Each test spoils exactly the arm it is about.
        /// </summary>
        private static StrategyActivationRule.Readings Clear(
            bool conflicts = false,
            float factor = 0.5f,
            float? commitCeiling = 1f,
            float costFunds = 0f,
            double? funds = 1_000_000d,
            float costReputation = 0f,
            float? reputation = 500f,
            float costScience = 0f,
            bool? scienceAffordable = true,
            float requiredReputation = 0f,
            float? currentReputation = 500f,
            bool ownCheckAsked = true,
            string? ownCheckRefusal = null,
            bool effectsAsked = true,
            string? effectRefusal = null) =>
            new StrategyActivationRule.Readings(
                conflicts, factor, commitCeiling,
                costFunds, funds, costReputation, reputation, costScience, scienceAffordable,
                requiredReputation, currentReputation,
                ownCheckAsked, ownCheckRefusal, effectsAsked, effectRefusal);

        /// <summary>
        /// Nothing this walk could ask refused. That is as close to a yes as it
        /// gets, and it is still not one: the answer is absent and the account
        /// names arm 1.
        /// </summary>
        private static void AssertNothingRefused(StrategyActivationRule.Verdict verdict)
        {
            Assert.Null(verdict.CanActivate);
            Assert.Equal(StrategyArm.None, verdict.Arm);
            Assert.Equal(StrategyArm.ConcurrentCap, verdict.Unasked);
        }

        [Fact]
        public void Every_reachable_arm_passing_is_still_not_a_yes()
        {
            // The hero assertion. Arm 1 is the concurrent-strategy cap, it sits
            // ahead of everything here, and there is no value to read for it off
            // the screen -- so the walk stops short of permission on purpose.
            AssertNothingRefused(StrategyActivationRule.Walk(Clear()));
        }

        [Fact]
        public void No_combination_of_readings_produces_a_true()
        {
            // The invariant stated directly rather than inferred from the cases
            // below, because it is the one a future arm could quietly break.
            var everythingGenerous = Clear(
                costFunds: 1f, funds: 9_999_999d,
                costReputation: 1f, reputation: 9_999f,
                costScience: 1f, scienceAffordable: true,
                requiredReputation: 1f, currentReputation: 9_999f);

            Assert.NotEqual(true, StrategyActivationRule.Walk(everythingGenerous).CanActivate);
            Assert.NotEqual(true, StrategyActivationRule.Walk(Clear()).CanActivate);
        }

        [Fact]
        public void A_conflicting_group_tag_refuses()
        {
            var verdict = StrategyActivationRule.Walk(Clear(conflicts: true));

            Assert.False(verdict.CanActivate);
            Assert.Equal(StrategyArm.Conflict, verdict.Arm);
        }

        [Fact]
        public void The_commit_ceiling_refuses_only_above_itself()
        {
            // Stock compares `>`, so committing at exactly the ceiling is allowed.
            Assert.False(StrategyActivationRule.Walk(
                Clear(factor: 0.8f, commitCeiling: 0.5f)).CanActivate);
            AssertNothingRefused(StrategyActivationRule.Walk(
                Clear(factor: 0.5f, commitCeiling: 0.5f)));
        }

        [Fact]
        public void The_commit_arm_carries_its_ceiling_as_a_percentage()
        {
            // The game's message reads as a percentage, so the arm hands over the
            // number already scaled rather than leaving the call site to know.
            var verdict = StrategyActivationRule.Walk(Clear(factor: 0.9f, commitCeiling: 0.6f));

            Assert.Equal(StrategyArm.CommitCeiling, verdict.Arm);
            Assert.Equal(60f, verdict.Amount, 3);
        }

        [Fact]
        public void A_cost_of_zero_is_never_asked_about()
        {
            // Stock guards each affordability arm on a non-zero cost, so a free
            // strategy is not refused for an empty treasury.
            AssertNothingRefused(StrategyActivationRule.Walk(Clear(costFunds: 0f, funds: 0d)));
            AssertNothingRefused(StrategyActivationRule.Walk(
                Clear(costReputation: 0f, reputation: -900f)));
            AssertNothingRefused(StrategyActivationRule.Walk(
                Clear(costScience: 0f, scienceAffordable: false)));
        }

        [Fact]
        public void Each_currency_refuses_when_the_balance_is_short()
        {
            Assert.Equal(
                StrategyArm.Funds,
                StrategyActivationRule.Walk(Clear(costFunds: 500f, funds: 499d)).Arm);
            Assert.Equal(
                StrategyArm.Reputation,
                StrategyActivationRule.Walk(Clear(costReputation: 20f, reputation: 19f)).Arm);
            Assert.Equal(
                StrategyArm.Science,
                StrategyActivationRule.Walk(Clear(costScience: 40f, scienceAffordable: false)).Arm);
        }

        [Fact]
        public void An_absent_currency_module_skips_its_arm_exactly_as_stock_does()
        {
            // Stock wraps each balance comparison in its own null check and does
            // NOT refuse when the module is missing. A career with no Funding
            // scenario must not have a strategy darkened for it.
            AssertNothingRefused(StrategyActivationRule.Walk(Clear(costFunds: 500f, funds: null)));
        }

        [Fact]
        public void The_reputation_floor_rounds_outward_on_both_sides()
        {
            // Stock ceils what you have and floors what is asked, so 9.2 clears a
            // requirement of 10.
            AssertNothingRefused(StrategyActivationRule.Walk(
                Clear(requiredReputation: 10f, currentReputation: 9.2f)));
            Assert.False(StrategyActivationRule.Walk(
                Clear(requiredReputation: 10f, currentReputation: 8.4f)).CanActivate);
        }

        [Fact]
        public void The_strategys_own_check_and_its_effects_refuse_in_their_own_words()
        {
            var own = StrategyActivationRule.Walk(
                Clear(ownCheckRefusal: "Program requires Orbital Rocketry."));
            Assert.Equal(StrategyArm.OwnCheck, own.Arm);
            Assert.Equal("Program requires Orbital Rocketry.", own.Reason);

            var effect = StrategyActivationRule.Walk(Clear(effectRefusal: "No eligible kerbals."));
            Assert.Equal(StrategyArm.Effect, effect.Arm);
            Assert.Equal("No eligible kerbals.", effect.Reason);
        }

        // ── The precedence, which is the soundness argument ──────────────────

        [Fact]
        public void A_refusal_outranks_every_arm_nobody_could_put()
        {
            // Stock returns on its FIRST refusal, so an arm that fires here would
            // have fired there whatever the unreachable arms would have said.
            // That asymmetry is the whole reason a derived NO is publishable
            // while a derived yes is not.
            var verdict = StrategyActivationRule.Walk(
                Clear(conflicts: true, commitCeiling: null, ownCheckAsked: false, effectsAsked: false));

            Assert.False(verdict.CanActivate);
            Assert.Equal(StrategyArm.Conflict, verdict.Arm);
        }

        [Fact]
        public void A_reflection_failure_on_either_virtual_arm_is_absent_not_a_refusal()
        {
            // The false-negative this project keeps paying for. An unreachable
            // method and a strategy the game would refuse must not look alike.
            var own = StrategyActivationRule.Walk(Clear(ownCheckAsked: false));
            Assert.Null(own.CanActivate);
            Assert.Equal(StrategyArm.OwnCheck, own.Unasked);

            var effects = StrategyActivationRule.Walk(Clear(effectsAsked: false));
            Assert.Null(effects.CanActivate);
            Assert.Equal(StrategyArm.Effect, effects.Unasked);
        }

        [Fact]
        public void An_unreadable_career_value_is_named_ahead_of_arm_1()
        {
            // The state a career with no GameVariables lands in. It has to stay
            // reachable and distinguishable: "we could not read your ceiling" and
            // "we cannot count your running strategies out here" are different
            // things to tell an operator.
            var verdict = StrategyActivationRule.Walk(Clear(commitCeiling: null));

            Assert.Null(verdict.CanActivate);
            Assert.Equal(StrategyArm.CommitCeiling, verdict.Unasked);
        }

        [Fact]
        public void A_missing_reputation_reading_only_matters_when_a_floor_is_set()
        {
            // An arm stock SKIPS is not an arm nobody could put. A strategy asking
            // for no reputation never reaches the comparison, so an unreadable
            // balance costs it nothing.
            AssertNothingRefused(StrategyActivationRule.Walk(
                Clear(requiredReputation: 0f, currentReputation: null)));

            Assert.Equal(
                StrategyArm.ReputationFloor,
                StrategyActivationRule.Walk(
                    Clear(requiredReputation: 10f, currentReputation: null)).Unasked);
        }
    }
}
