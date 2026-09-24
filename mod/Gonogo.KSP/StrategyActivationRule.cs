using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// Which of <c>Strategy.CanBeActivated</c>'s nine arms decided, in the order
    /// the game evaluates them. <see cref="None"/> means none of them refused.
    /// </summary>
    internal enum StrategyArm
    {
        None = 0,
        ConcurrentCap,
        Conflict,
        CommitCeiling,
        Funds,
        Reputation,
        Science,
        ReputationFloor,
        OwnCheck,
        Effect,
    }

    /// <summary>
    /// Whether a strategy may be activated, asked arm by arm instead of through
    /// <c>Strategy.CanBeActivated</c>.
    ///
    /// <para><b>Why not just call the game's method.</b> Its first statement is
    /// <c>Administration.Instance.ActiveStrategyCount</c>, and
    /// <c>Administration</c> is a UI <c>MonoBehaviour</c> that exists only while
    /// the player has that screen open. So the method throws for every strategy
    /// on every tick from anywhere else, and a console career could not be told
    /// whether a single one of its strategies was eligible.</para>
    ///
    /// <para><b>This walk can REFUSE and it can DECLINE TO ANSWER. It can never
    /// say yes</b>, because arm 1 cannot be put off-screen and a pass is owed to
    /// every arm. That is not a gap to be closed later, it is the design: a yes
    /// reached without arm 1 would be <c>14c4a1ea6</c>'s fabrication with its
    /// sign flipped, and it would arm a spend control on a rule nobody
    /// checked.</para>
    ///
    /// <para><b>Why arm 1 in particular is out of reach, when arm 3 is not.</b>
    /// Both read a field <c>Administration.Start</c> fills from
    /// <c>GameVariables</c>; the difference is what happens afterwards.
    /// <c>maxStrategyCommitLevel</c> is written once from
    /// <c>GetStrategyCommitRange</c> and never again, so recomputing it from that
    /// same virtual method is reading the same source through the same door, and
    /// a facility-retiering mod's override is inherited rather than bypassed.
    /// <c>activeStrategyCount</c> is a SCROLL-VIEW ITEM COUNTER: reset and
    /// recounted with an early break at the cap, incremented on the player's own
    /// click, never decremented, and written directly by RP-1 in a Harmony prefix
    /// precisely so that arm can never fire for a leader. Substituting a roster
    /// count for it would not be reading the game's value; it would be enforcing
    /// stock's rule on a career that has replaced it, which is the one thing
    /// <see cref="KspCareerActuator"/>'s standing comment forbids.</para>
    ///
    /// <para><b>A refusal is still sound.</b> Stock returns on the FIRST arm that
    /// fires, so an arm that refuses here would have refused there whatever arm 1
    /// would have said. That asymmetry between a refusal and a pass is the whole
    /// argument, and it is why this is worth doing: a roster that used to arrive
    /// as one undifferentiated silence now arrives carrying the game's own reason
    /// for everything the career genuinely refuses.</para>
    ///
    /// <para>Carries no KSP type so a headless test can enter every arm, the same
    /// discipline as <see cref="SceneExitRule"/> and <see cref="StageRule"/>
    /// beside it. The live reads and the game's own localised wording stay at the
    /// call site.</para>
    /// </summary>
    internal static class StrategyActivationRule
    {
        /// <summary>
        /// Everything the reachable arms compare, read off the live game by the
        /// caller.
        ///
        /// <para>A nullable balance means the currency's scenario module is
        /// absent. That is NOT an unasked arm: stock guards each affordability
        /// arm with its own null check and skips it, so an absent module passes,
        /// exactly as it does in the game.</para>
        ///
        /// <para>Arm 1 takes no input here, deliberately. See the type's own note
        /// on why its value cannot be had rather than merely being awkward to
        /// fetch.</para>
        /// </summary>
        public readonly struct Readings
        {
            /// <summary><c>StrategySystem.HasConflictingActiveStrategies</c>.</summary>
            public bool Conflicts { get; }

            /// <summary>The commitment level being asked for.</summary>
            public float Factor { get; }

            /// <summary><c>GetStrategyCommitRange</c>; null when it could not be read.</summary>
            public float? CommitCeiling { get; }

            public float CostFunds { get; }

            /// <summary>Null when <c>Funding</c> is absent, which SKIPS the arm.</summary>
            public double? Funds { get; }

            public float CostReputation { get; }

            /// <summary>Null when <c>Reputation</c> is absent, which SKIPS the arm.</summary>
            public float? Reputation { get; }

            public float CostScience { get; }

            /// <summary>
            /// <c>ResearchAndDevelopment.CanAfford</c>, asked by the caller
            /// because it is the game's own static rather than a comparison.
            /// Null when R&amp;D is absent, which SKIPS the arm.
            /// </summary>
            public bool? ScienceAffordable { get; }

            public float RequiredReputation { get; }

            /// <summary>
            /// <c>Reputation.CurrentRep</c>. Null leaves arm 7 UNASKED rather
            /// than skipped, but only when a floor is actually set: a strategy
            /// requiring no reputation never reaches the comparison.
            /// </summary>
            public float? CurrentReputation { get; }

            /// <summary>Whether the strategy's own virtual check could be put at all.</summary>
            public bool OwnCheckAsked { get; }

            /// <summary>Its refusal in its own words, or null if it passed.</summary>
            public string? OwnCheckRefusal { get; }

            /// <summary>Whether every effect's virtual check could be put.</summary>
            public bool EffectsAsked { get; }

            /// <summary>The first effect's refusal in its own words, or null.</summary>
            public string? EffectRefusal { get; }

            public Readings(
                bool conflicts,
                float factor,
                float? commitCeiling,
                float costFunds,
                double? funds,
                float costReputation,
                float? reputation,
                float costScience,
                bool? scienceAffordable,
                float requiredReputation,
                float? currentReputation,
                bool ownCheckAsked,
                string? ownCheckRefusal,
                bool effectsAsked,
                string? effectRefusal)
            {
                Conflicts = conflicts;
                Factor = factor;
                CommitCeiling = commitCeiling;
                CostFunds = costFunds;
                Funds = funds;
                CostReputation = costReputation;
                Reputation = reputation;
                CostScience = costScience;
                ScienceAffordable = scienceAffordable;
                RequiredReputation = requiredReputation;
                CurrentReputation = currentReputation;
                OwnCheckAsked = ownCheckAsked;
                OwnCheckRefusal = ownCheckRefusal;
                EffectsAsked = effectsAsked;
                EffectRefusal = effectRefusal;
            }
        }

        /// <summary>
        /// What the walk concluded, and enough for the caller to quote the game's
        /// own wording for the arm that fired.
        ///
        /// <para><see cref="CanActivate"/> is <c>false</c> or <c>null</c> and
        /// never <c>true</c>; there is deliberately no factory that makes
        /// one.</para>
        /// </summary>
        public readonly struct Verdict
        {
            /// <summary><c>false</c> when an arm refused, null when one could not be put.</summary>
            public bool? CanActivate { get; }

            /// <summary>Which arm refused. <see cref="StrategyArm.None"/> when none did.</summary>
            public StrategyArm Arm { get; }

            /// <summary>
            /// The number the game interpolates into that arm's message, so the
            /// caller can format the localised string without re-deriving it.
            /// Zero where the message takes no argument.
            /// </summary>
            public float Amount { get; }

            /// <summary>
            /// The refusing party's own words, for the two arms that run code we
            /// did not write and whose wording we therefore cannot compose.
            /// </summary>
            public string? Reason { get; }

            /// <summary>Which arm could not be put, when that is why there is no verdict.</summary>
            public StrategyArm Unasked { get; }

            private Verdict(bool? canActivate, StrategyArm arm, float amount, string? reason, StrategyArm unasked)
            {
                CanActivate = canActivate;
                Arm = arm;
                Amount = amount;
                Reason = reason;
                Unasked = unasked;
            }

            public static Verdict Refused(StrategyArm arm, float amount = 0f, string? reason = null) =>
                new Verdict(false, arm, amount, reason, StrategyArm.None);

            public static Verdict Unanswerable(StrategyArm arm) =>
                new Verdict(null, StrategyArm.None, 0f, null, arm);
        }

        /// <summary>
        /// Walk the reachable arms in the game's own order and answer with the
        /// first refusal, or with no answer at all.
        ///
        /// <para>One thing this cannot promise is that the refusing arm is the
        /// arm STOCK would have named: arm 1 goes unasked and sits ahead of every
        /// arm here, so where it would have fired the verdict still agrees and
        /// the quoted reason does not. The verdict is what a control is armed
        /// from; the reason is prose for an operator, and naming a real refusal
        /// beats naming none.</para>
        /// </summary>
        public static Verdict Walk(in Readings r)
        {
            // Arm 2.
            if (r.Conflicts)
            {
                return Verdict.Refused(StrategyArm.Conflict);
            }

            // Arm 3.
            if (r.CommitCeiling.HasValue && r.Factor > r.CommitCeiling.Value)
            {
                return Verdict.Refused(StrategyArm.CommitCeiling, r.CommitCeiling.Value * 100f);
            }

            // Arms 4-6. A cost of zero is not asked, and an absent module is
            // skipped rather than failed, both exactly as stock does it.
            if (r.CostFunds != 0f && r.Funds.HasValue && r.Funds.Value < r.CostFunds)
            {
                return Verdict.Refused(StrategyArm.Funds);
            }

            if (r.CostReputation != 0f && r.Reputation.HasValue && r.Reputation.Value < r.CostReputation)
            {
                return Verdict.Refused(StrategyArm.Reputation);
            }

            if (r.CostScience != 0f && r.ScienceAffordable == false)
            {
                return Verdict.Refused(StrategyArm.Science);
            }

            // Arm 7. Rounded outward on both sides, so a strategy asking for 10
            // is satisfied by anything above 9.
            if (r.RequiredReputation != 0f && r.CurrentReputation.HasValue &&
                Math.Ceiling(r.CurrentReputation.Value) < Math.Floor(r.RequiredReputation))
            {
                return Verdict.Refused(StrategyArm.ReputationFloor, r.RequiredReputation);
            }

            // Arms 8-9, the two that run code we did not write.
            if (r.OwnCheckAsked && r.OwnCheckRefusal != null)
            {
                return Verdict.Refused(StrategyArm.OwnCheck, reason: r.OwnCheckRefusal);
            }

            if (r.EffectsAsked && r.EffectRefusal != null)
            {
                return Verdict.Refused(StrategyArm.Effect, reason: r.EffectRefusal);
            }

            // Nothing refused, and a yes is owed to every arm. Name the first one
            // that could not be put, so the account tells an operator which
            // question went unanswered rather than a flat "unknown".
            if (!r.CommitCeiling.HasValue) return Verdict.Unanswerable(StrategyArm.CommitCeiling);
            if (r.RequiredReputation != 0f && !r.CurrentReputation.HasValue)
            {
                return Verdict.Unanswerable(StrategyArm.ReputationFloor);
            }

            if (!r.OwnCheckAsked) return Verdict.Unanswerable(StrategyArm.OwnCheck);
            if (!r.EffectsAsked) return Verdict.Unanswerable(StrategyArm.Effect);

            // Everything reachable passed, which leaves arm 1: the one that
            // cannot be put at all.
            return Verdict.Unanswerable(StrategyArm.ConcurrentCap);
        }
    }
}
