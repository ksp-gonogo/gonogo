using System.Collections.Generic;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// How long a kerbal has left, in seconds, by Kerbalism's own arithmetic:
    /// the soonest FATAL rule, in two stages. Stage one is how long the rule's
    /// input resource lasts at its current net rate, because a rule only
    /// degenerates once its input is gone; stage two is how long the accumulator
    /// then takes to climb from where it is to the rule's fatal threshold.
    ///
    /// <para><b>Why the mod computes it rather than the client.</b> Stage one
    /// needs the resource AMOUNT, and the life-support channel deliberately
    /// carries only rates (amounts reach the app on <c>vessel.resources</c>) ...
    /// for the ACTIVE craft. A background craft has no such channel, so a client
    /// holding <c>kerbalism.vessel.&lt;guid&gt;.crew</c> has a degeneration rate
    /// and no way to know when degeneration starts. The number is only derivable
    /// where the amounts are.</para>
    ///
    /// <para><b>Breakdown rules are excluded, deliberately.</b> Kerbalism's own
    /// <c>Rule.Execute</c> branches at the threshold: a rule with
    /// <c>breakdown</c> triggers a breakdown and RESETS the accumulator, only a
    /// non-breakdown rule kills. Counting stress toward a death clock would put
    /// a deadline on an event that has never killed anyone.</para>
    ///
    /// <para><b>Conservative in one known direction.</b> While its input
    /// resource is present a rule slowly RECOVERS the accumulator, which this
    /// ignores, so a real deadline is never sooner than the one reported.</para>
    /// </summary>
    public static class KerbalismDeathClock
    {
        private const double Epsilon = 1e-10;

        /// <summary>
        /// Seconds until the soonest fatal rule kills this kerbal, or null when
        /// the answer is not derivable.
        ///
        /// <para>Null is a statement of ignorance and is deliberately not a
        /// large number: a craft whose deadline cannot be computed and a craft
        /// with years of supplies must not render the same, and a sentinel is
        /// indistinguishable from a real answer to anything that does
        /// arithmetic on it. Because the value is the SOONEST of several rules,
        /// a single rule we cannot evaluate makes the whole answer unknown
        /// rather than "the soonest of the ones we could": the true deadline
        /// could be the one we could not read, and reporting the others would
        /// overstate the time available.</para>
        ///
        /// <para>A rule whose input resource is NOT draining contributes no
        /// deadline, which is a real answer rather than ignorance: a craft in
        /// balance on oxygen has no oxygen deadline. If every rule answers that
        /// way the result is null, meaning nothing is closing in.</para>
        /// </summary>
        public static double? SoonestFatalSeconds(
            KerbalRulesRaw kerbal,
            IReadOnlyList<RuleDefRaw>? rules,
            IReadOnlyDictionary<string, double>? ruleEnvModifiers,
            IReadOnlyDictionary<string, double>? resourceAmounts,
            IReadOnlyDictionary<string, double>? resourceRates)
        {
            if (kerbal == null || rules == null)
            {
                return null;
            }

            double? soonest = null;
            foreach (var rule in rules)
            {
                if (rule == null || rule.Breakdown || rule.Degeneration <= Epsilon)
                {
                    continue;
                }
                // A threshold of zero is our read failing, not a rule that kills
                // on contact: Kerbalism's own default is 1.0.
                if (rule.FatalThreshold <= Epsilon)
                {
                    return null;
                }

                // Absent from the modifier map means "no correction available",
                // the same convention KerbalismLifeSupport.RuleEnvModifiers
                // states: treat it as 1.0.
                var k = 1.0;
                if (ruleEnvModifiers != null && ruleEnvModifiers.TryGetValue(rule.Name, out var live))
                {
                    k = live;
                }
                // The environment has switched this rule off entirely (a
                // breathable atmosphere zeroes the breathing rule), so it is
                // not counting down at all.
                if (k <= 0.0)
                {
                    continue;
                }

                var variance = 1.0;
                if (rule.Variance > Epsilon)
                {
                    if (kerbal.RuleVarianceFactors == null
                        || !kerbal.RuleVarianceFactors.TryGetValue(rule.Name, out variance))
                    {
                        // This rule is per-kerbal randomised and we could not
                        // read this kerbal's factor, so its deadline is off by
                        // an unknown amount in an unknown direction.
                        return null;
                    }
                }

                // An interval rule degenerates once per interval, not once per
                // second (Rule.Execute's step counts intervals).
                var perSecond = rule.Degeneration * k * variance / (rule.Interval > 0.0 ? rule.Interval : 1.0);
                if (perSecond <= Epsilon)
                {
                    continue;
                }

                kerbal.Rules.TryGetValue(rule.Name, out var problem);
                var untilFatal = (rule.FatalThreshold - problem) / perSecond;
                if (untilFatal < 0.0)
                {
                    untilFatal = 0.0;
                }

                var untilDegenerationStarts = 0.0;
                if (rule.Input.Length > 0)
                {
                    if (resourceAmounts == null || !resourceAmounts.TryGetValue(rule.Input, out var amount))
                    {
                        return null;
                    }
                    if (amount > Epsilon)
                    {
                        if (resourceRates == null || !resourceRates.TryGetValue(rule.Input, out var rate))
                        {
                            return null;
                        }
                        if (rate >= 0.0)
                        {
                            continue; // in balance or filling: this rule is not closing in on anyone
                        }
                        untilDegenerationStarts = amount / -rate;
                    }
                }

                var deadline = untilDegenerationStarts + untilFatal;
                if (!soonest.HasValue || deadline < soonest.Value)
                {
                    soonest = deadline;
                }
            }

            return soonest;
        }
    }
}
