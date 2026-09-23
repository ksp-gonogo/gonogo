using System;
using System.Reflection;
using KSP.Localization;
using Strategies;

namespace Gonogo.KSP
{
    /// <summary>
    /// The live half of <see cref="StrategyActivationRule"/>: the nine arms read
    /// off a real <c>Strategy</c>, and the game's own wording for whichever one
    /// refused.
    ///
    /// <para><b>The wording is fetched, not written.</b> Each refusal is the
    /// localisation tag stock passes to <c>Localizer</c> at that arm, so an
    /// operator reads the sentence the Administration screen would have shown
    /// them, in their own language. Only the tag is quoted here; composing an
    /// equivalent English sentence would drift from the game the first time
    /// either changed.</para>
    ///
    /// <para><b>Arm 8 is the only reflected one.</b>
    /// <c>Strategy.CanActivate(ref string)</c> is <c>protected virtual</c>, so it
    /// cannot be called directly; every other arm is public. The
    /// <c>MethodInfo</c> is resolved once rather than per strategy per tick,
    /// because a live career carries around a hundred strategies and this runs on
    /// every one of them.</para>
    ///
    /// <para><b>A reflection failure is ABSENT, never a refusal.</b> Both
    /// unreached arms report through an <c>asked</c> flag rather than through a
    /// caught exception that falls into the refusing branch. A missing method, a
    /// changed signature and a third-party throw all mean the question was never
    /// put, and a question never put is not a no: rendering one as "not eligible"
    /// would be indistinguishable from a real refusal and would arm nothing while
    /// claiming the game had judged.</para>
    /// </summary>
    internal static class LiveStrategyArms
    {
        /// <summary>
        /// <c>Strategy.CanActivate(ref string)</c>, resolved once. Null when this
        /// build of KSP does not carry it at that signature, which leaves arm 8
        /// unasked rather than passed.
        /// </summary>
        private static readonly MethodInfo? OwnCheck = ResolveOwnCheck();

        private static MethodInfo? ResolveOwnCheck()
        {
            try
            {
                return typeof(Strategy).GetMethod(
                    "CanActivate",
                    BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public,
                    binder: null,
                    types: new[] { typeof(string).MakeByRefType() },
                    modifiers: null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Whether <paramref name="strategy"/> may be activated, asked without the
        /// Administration Building.
        ///
        /// <para>Two outcomes only, because <see cref="StrategyActivationRule"/>
        /// never reaches a yes: a refusal in the game's own words, or no verdict
        /// with an account of which question went unasked. The commonest account
        /// by far is arm 1, and that is the ordinary ending rather than a fault
        /// -- the concurrent-strategy cap is counted on the shut screen and
        /// nowhere else.</para>
        /// </summary>
        public static StrategyEligibility Eligibility(Strategy strategy, StrategySystem system)
        {
            StrategyActivationRule.Verdict verdict;
            try
            {
                verdict = Walk(strategy, system);
            }
            catch (Exception ex)
            {
                return StrategyEligibility.Threw(ex.GetType().Name);
            }

            return verdict.CanActivate == false
                ? StrategyEligibility.Derived(false, Wording(verdict, strategy))
                : StrategyEligibility.Unasked(UnaskedWording(verdict.Unasked));
        }

        /// <summary>
        /// The walk's own verdict, for a caller that must act on the difference
        /// between a refusal and an arm that went unasked rather than only report
        /// it. Throws whatever the live reads throw.
        /// </summary>
        public static StrategyActivationRule.Verdict Walk(Strategy strategy, StrategySystem system) =>
            StrategyActivationRule.Walk(Read(strategy, system));

        /// <summary>
        /// What an operator is told when an arm could not be put. Each names the
        /// thing that was unreadable rather than the arm's number, which means
        /// nothing outside this file.
        /// </summary>
        internal static string UnaskedWording(StrategyArm arm)
        {
            switch (arm)
            {
                case StrategyArm.ConcurrentCap:
                    // The ordinary ending, and the honest one: everything this
                    // career could be asked said yes, and the one arm that lives
                    // on the shut screen could not be asked at all.
                    return "KSP counts your running strategies only inside the "
                        + "Administration Building, so that check is not made in this list";
                case StrategyArm.CommitCeiling:
                    return "this career's commitment ceiling could not be read";
                case StrategyArm.ReputationFloor:
                    return "this career's reputation could not be read";
                case StrategyArm.OwnCheck:
                    return "KSP's own check on this strategy could not be run";
                case StrategyArm.Effect:
                    return "one of this strategy's effects could not be asked";
                default:
                    return "one of KSP's eligibility checks could not be run";
            }
        }

        /// <summary>
        /// Every arm's inputs, from the same members stock reads them from.
        /// </summary>
        private static StrategyActivationRule.Readings Read(Strategy strategy, StrategySystem system)
        {
            // Arm 3. GameVariables is where Administration.Start itself reads the
            // ceiling, at the facility's normalised level, and the method is
            // virtual so a retiering mod's override is inherited rather than
            // bypassed. GetFacilityLevel is a static that answers with or without
            // its scenario loaded, so the only way this goes unread is
            // GameVariables itself being absent.
            //
            // Arm 1 is NOT fetched here even though the same object would hand
            // over a limit. The limit is not the arm; the arm compares it against
            // a counter that lives on the shut screen and that RP-1 overwrites, so
            // there is no value to read. See StrategyActivationRule.
            float? commitCeiling = null;
            var gameVariables = GameVariables.Instance;
            if (gameVariables != null)
            {
                commitCeiling = gameVariables.GetStrategyCommitRange(
                    ScenarioUpgradeableFacilities.GetFacilityLevel(
                        SpaceCenterFacility.Administration));
            }

            // The three currency scenarios. Each is fetched to be NULL-CHECKED
            // rather than to be trusted: stock guards every affordability arm on
            // its own module and skips the arm when it is absent, so a missing
            // module passes rather than refuses. Reputation is fetched once and
            // answers two arms, the cost (arm 5) off the instance and the floor
            // (arm 7) off a static that would throw without one. R&D's affordability
            // is likewise a static behind an instance check, which is how stock
            // asks it.
            var reputation = Reputation.Instance;
            var funding = Funding.Instance;
            var rnd = ResearchAndDevelopment.Instance;

            var askedOwnCheck = TryOwnCheck(strategy, out var ownRefusal);
            var askedEffects = TryEffects(strategy, out var effectRefusal);

            return new StrategyActivationRule.Readings(
                conflicts: system.HasConflictingActiveStrategies(strategy.GroupTags),
                factor: strategy.Factor,
                commitCeiling: commitCeiling,
                costFunds: strategy.InitialCostFunds,
                funds: funding != null ? funding.Funds : (double?)null,
                costReputation: strategy.InitialCostReputation,
                reputation: reputation != null ? reputation.reputation : (float?)null,
                costScience: strategy.InitialCostScience,
                scienceAffordable: rnd != null
                    ? ResearchAndDevelopment.CanAfford(strategy.InitialCostScience)
                    : (bool?)null,
                requiredReputation: strategy.RequiredReputation,
                currentReputation: reputation != null ? Reputation.CurrentRep : (float?)null,
                ownCheckAsked: askedOwnCheck,
                ownCheckRefusal: ownRefusal,
                effectsAsked: askedEffects,
                effectRefusal: effectRefusal);
        }

        /// <summary>
        /// Arm 8. Returns whether the question was PUT; the refusal, if any, comes
        /// back through <paramref name="refusal"/>. The two are separate precisely
        /// so an unreachable method cannot be mistaken for a no.
        /// </summary>
        private static bool TryOwnCheck(Strategy strategy, out string? refusal)
        {
            refusal = null;
            if (OwnCheck == null) return false;

            try
            {
                var args = new object[] { string.Empty };
                var allowed = (bool)OwnCheck.Invoke(strategy, args);
                if (!allowed) refusal = args[0] as string ?? "";
                return true;
            }
            catch (Exception)
            {
                // The strategy's own override threw, or the signature moved. Either
                // way nobody answered, so the caller must not read a refusal here.
                refusal = null;
                return false;
            }
        }

        /// <summary>
        /// Arm 9. <c>StrategyEffect.CanActivate</c> is public, so no reflection,
        /// but it is virtual and runs third-party code: a throw from any effect
        /// leaves the whole arm unasked rather than refusing on its behalf.
        ///
        /// <para>Stock walks its effects backwards and refuses on the first that
        /// declines. Which effect is reached first changes nothing about the
        /// verdict, and the wording carried back is that effect's own.</para>
        /// </summary>
        private static bool TryEffects(Strategy strategy, out string? refusal)
        {
            refusal = null;
            var effects = strategy.Effects;
            if (effects == null) return true;

            try
            {
                for (var i = effects.Count - 1; i >= 0; i--)
                {
                    var effect = effects[i];
                    if (effect == null) continue;

                    var reason = string.Empty;
                    if (!effect.CanActivate(ref reason))
                    {
                        refusal = reason ?? "";
                        return true;
                    }
                }

                return true;
            }
            catch (Exception)
            {
                refusal = null;
                return false;
            }
        }

        /// <summary>
        /// The refusing arm in the game's own words. The two arms that run code we
        /// did not write carry their own wording and are passed through verbatim.
        /// </summary>
        internal static string Wording(StrategyActivationRule.Verdict verdict, Strategy strategy)
        {
            // No arm 1 case: it is never the refusing arm here, because it is
            // never asked. Its localisation tag is #autoLOC_304820, if that ever
            // changes.
            switch (verdict.Arm)
            {
                case StrategyArm.Conflict:
                    return Localizer.Format("#autoLOC_304827");
                case StrategyArm.CommitCeiling:
                    return Localizer.Format("#autoLOC_304834", verdict.Amount);
                case StrategyArm.Funds:
                    return Localizer.Format("#autoLOC_304841");
                case StrategyArm.Reputation:
                    return Localizer.Format("#autoLOC_304848");
                case StrategyArm.Science:
                    return Localizer.Format("#autoLOC_304855");
                case StrategyArm.ReputationFloor:
                    // The only arm whose message names both sides, so it is
                    // rebuilt from the live pair rather than from the one number
                    // the verdict carries.
                    return Localizer.Format(
                        "#autoLOC_304862",
                        strategy.RequiredReputation.ToString("N0"),
                        Reputation.CurrentRep.ToString("N0"));
                default:
                    return verdict.Reason ?? "";
            }
        }
    }
}
