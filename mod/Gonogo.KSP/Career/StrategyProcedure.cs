using System;
using Sitrep.Contract;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// A strategy as the body of stock's <c>Strategy.Activate()</c> touches it,
    /// one member per step, so the ORDER and the AMOUNTS can be entered by a test
    /// without a live career.
    /// </summary>
    internal interface IStrategyProcedureTarget
    {
        float InitialCostFunds { get; }

        float InitialCostReputation { get; }

        float InitialCostScience { get; }

        /// <summary>Writes the private <c>isActive</c> to <c>true</c>.</summary>
        void MarkActive();

        /// <summary><c>Strategy.Register()</c>: the strategy's own hook, then every effect's.</summary>
        void Register();

        /// <summary>Writes the private <c>dateActivated</c> to <c>Planetarium.fetch.time</c>.</summary>
        void StampActivated();

        /// <summary><c>Funding.AddFunds</c> with <c>TransactionReasons.StrategySetup</c>.</summary>
        void ChargeFunds(double amount);

        /// <summary><c>Reputation.AddReputation</c> with <c>TransactionReasons.StrategySetup</c>.</summary>
        void ChargeReputation(float amount);

        /// <summary><c>ResearchAndDevelopment.AddScience</c> with <c>TransactionReasons.StrategySetup</c>.</summary>
        void ChargeScience(float amount);
    }

    /// <summary>
    /// The body of stock's <c>Strategy.Activate()</c> after its gate, step for
    /// step.
    ///
    /// <para><b>The one stock procedure this mod carries out by writing the
    /// game's private state rather than by calling the game.</b> The reason is
    /// mechanical: <c>Activate()</c> is gate and procedure in a single method,
    /// its gate dereferences <c>Administration.Instance</c> (a UI component that
    /// exists only while that screen is open), and the procedure writes two
    /// <c>private</c> fields, so stock offers no entry point that commits a
    /// strategy with the screen shut. Where the game exposes a callable step, as
    /// <c>UnlockProtoTechNode</c> and <c>SetLevel</c> are for research and
    /// facilities, the mod calls it; this is not a pattern for doing otherwise
    /// anywhere a callable step exists.</para>
    ///
    /// <para><b>The order is observable, so it is stock's exactly.</b>
    /// <c>Register()</c> runs BEFORE the charges, and a registered
    /// <c>CurrencyConverter</c> effect listens on
    /// <c>OnCurrencyModifierQuery</c>, which each of the three adders fires: a
    /// strategy whose effect covers <c>StrategySetup</c> hears its own setup
    /// cost. <c>dateActivated</c> is written AFTER <c>Register()</c>, so an
    /// <c>OnRegister</c> reading <c>DateActivated</c> sees the previous value.
    /// <c>StrategyActivateBodyTests</c> pins the same sequence against the
    /// installed <c>Assembly-CSharp</c>, so a KSP build that changes it turns a
    /// test red rather than a career quietly charged differently.</para>
    ///
    /// <para><b>The caller resolves everything before calling.</b> Between
    /// <see cref="IStrategyProcedureTarget.MarkActive"/> and the last charge
    /// nothing here can refuse, because a refusal part-way would leave a strategy
    /// active and uncharged. Stock's own body carries that exposure for its
    /// currency modules (arms 4-6 skip an absent module, then the charge
    /// dereferences it); the caller closes it rather than copying it.</para>
    /// </summary>
    internal static class StrategyProcedure
    {
        public static void Run(IStrategyProcedureTarget strategy)
        {
            strategy.MarkActive();
            strategy.Register();
            strategy.StampActivated();

            // Each cost is re-read at its own charge, as stock does: the getters
            // lerp over Factor, which nothing between the two reads can move.
            if (strategy.InitialCostFunds != 0f)
            {
                strategy.ChargeFunds(Charge(strategy.InitialCostFunds));
            }

            if (strategy.InitialCostReputation != 0f)
            {
                strategy.ChargeReputation(Charge(strategy.InitialCostReputation));
            }

            if (strategy.InitialCostScience != 0f)
            {
                strategy.ChargeScience(Charge(strategy.InitialCostScience));
            }
        }

        /// <summary>
        /// Stock's <c>-Mathf.Abs(cost)</c> (a <c>neg</c> in its IL, which a
        /// decompiler renders as <c>0f - ...</c>): a cost is always a deduction,
        /// whatever sign the strategy's config gave it.
        /// </summary>
        public static float Charge(float cost) => -Math.Abs(cost);

        /// <summary>
        /// What the arm walk's verdict means for a write about to happen: the
        /// failure to return, or null when every arm the walk can put has passed
        /// and only arm 1 is left to ask.
        ///
        /// <para>A refusal is the game's, in its words, under the same code the
        /// screen-open path gives it. Any OTHER unasked arm is
        /// <see cref="CommandErrorCode.Unreadable"/>: a question nobody answered
        /// is neither a no nor a go-ahead, and treating it as either would let an
        /// unreachable method decide a spend.</para>
        /// </summary>
        public static CommandResult? AtWrite(
            StrategyActivationRule.Verdict verdict,
            Func<string> refusalWording,
            Func<StrategyArm, string> unaskedWording)
        {
            if (verdict.CanActivate == false)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, refusalWording());
            }

            if (verdict.Unasked != StrategyArm.ConcurrentCap)
            {
                return CommandResult.Fail(CommandErrorCode.Unreadable, unaskedWording(verdict.Unasked));
            }

            return null;
        }

        /// <summary>
        /// Arm 1 of <c>CanBeActivated</c>, asked of the roster at the moment of the
        /// write.
        ///
        /// <para>Sound only where stock's own activation is unpatched. The screen's
        /// <c>CreateActiveStratList</c> counts <c>IsActive</c> strategies with an
        /// early break at the limit, so its counter is <c>min(active, limit)</c>,
        /// and <c>min(active, limit) &gt;= limit</c> exactly when
        /// <c>active &gt;= limit</c>. A career that patches activation (RP-1 writes
        /// that counter itself) has replaced the rule, and never reaches
        /// here.</para>
        /// </summary>
        public static bool ConcurrentCapRefuses(int activeStrategies, int limit) =>
            activeStrategies >= limit;
    }
}
