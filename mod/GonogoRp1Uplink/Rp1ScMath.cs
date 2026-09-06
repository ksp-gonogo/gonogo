using System;
using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The rate and time-left arithmetic, reproduced from the RP-1 code that
    /// ADVANCES progress rather than from the helpers that display it.
    /// </summary>
    /// <remarks>
    /// <para>Locked against the shipped RP-1 v4.6.0.0 <c>RP0.dll</c>. Sources, all
    /// read from that assembly: <c>VesselProject.BuildRate</c> and
    /// <c>VesselProject.IncrementProgress</c>; <c>LCOpsProject.GetBuildRate</c>,
    /// <c>.GetBaseTimeLeft</c> and <c>.IncrementProgress</c>;
    /// <c>ResearchProject.BuildRate</c> and <c>.TimeLeft</c>;
    /// <c>LaunchComplex.RecalculateProjectBP</c>;
    /// <c>LCOpsProject.TimeLeftWithEfficiencyIncrease</c> and
    /// <c>VesselProject.CalculateTimeLeftForBuildRate</c> for the ramp.</para>
    ///
    /// <para>The display helpers are unusable from a sampled capture and this is
    /// not a stylistic preference: <c>GetTimeLeft</c> and <c>BuildRate</c> both
    /// reach <c>LaunchComplex.Efficiency</c>, whose getter constructs an
    /// <c>LCEfficiency</c>, appends it to a <c>[Persistent]</c> list and calls
    /// <c>RefreshAllCaches()</c> on a cache miss. Reading a player's save is not
    /// licence to write to it.</para>
    ///
    /// <para>Three RP-1 defects are FIXED here rather than inherited, each one an
    /// absence where RP-1 produces a number that is not one:</para>
    /// <list type="number">
    /// <item><c>GetTimeLeft()</c> returns <c>double.PositiveInfinity</c> at a zero
    /// rate. Infinity is not a value JSON carries or a client can render, so ours
    /// is absent.</item>
    /// <item><c>GetFractionComplete()</c> divides by build points with no zero
    /// guard, so a project with none is NaN. Ours is absent.</item>
    /// <item>The efficiency ramp is nonsense on a RUSHING complex.
    /// <c>PredictWeightedEfficiency</c> returns a weighted EFFICIENCY normally but
    /// returns its <c>tdelta</c> argument, a TIME, from its early-out, and rushing
    /// takes that early-out while neither caller guards for it: the estimate
    /// collapses to the efficiency value expressed in seconds. The early-out
    /// means "no skill-up applies over this interval", so ours applies no ramp in
    /// exactly those cases, which is the number the un-ramped arithmetic already
    /// gives.</item>
    /// </list>
    /// </remarks>
    public static class Rp1ScMath
    {
        /// <summary>The interval below which RP-1 does not ramp efficiency at all: one day.</summary>
        public const double RampFloorSeconds = 86400.0;

        /// <summary>
        /// Fraction complete, guarded. Absent when there is nothing to be a
        /// fraction of. <paramref name="reversed"/> counts down instead of up,
        /// which is how a rollback and an air-launch unmount run.
        /// </summary>
        public static double? ProgressRatio(double progress, double totalPoints, bool reversed = false)
        {
            if (totalPoints == 0.0 || double.IsNaN(totalPoints))
            {
                return null;
            }
            return reversed ? (totalPoints - progress) / totalPoints : progress / totalPoints;
        }

        /// <summary>
        /// A build-list vehicle's effective rate, mirroring
        /// <c>VesselProject.BuildRate</c>: the complex's inability to integrate
        /// zeroes it outright, and efficiency and the rush multiplier scale it.
        /// </summary>
        /// <param name="baseRate">
        /// <c>VesselProject._buildRate</c>. Negative means RP-1 has not costed
        /// this project yet, which is an absent rate rather than a zero one: it
        /// self-heals the first time the item progresses.
        /// </param>
        /// <param name="efficiency">
        /// The complex's efficiency, or null when RP-1 holds no efficiency record
        /// for it. Absent efficiency makes the rate absent too, because a rate
        /// computed as though the crew were perfect would be a fabrication.
        /// </param>
        public static double? VesselRate(double baseRate, double? efficiency, double rushRate, bool canIntegrate)
        {
            if (baseRate < 0.0 || efficiency == null)
            {
                return null;
            }
            return canIntegrate ? baseRate * efficiency.Value * rushRate : 0.0;
        }

        /// <summary>
        /// A launch-complex operation's effective rate, mirroring
        /// <c>LCOpsProject.GetBuildRate</c> and the share <c>IncrementProgress</c>
        /// applies: a blocking operation gets only its portion of the complex when
        /// several run at once. Negative for a reversed operation, because that is
        /// the direction its progress moves.
        /// </summary>
        public static double? OperationRate(
            double baseRate,
            double? efficiency,
            double rushRate,
            bool reversed,
            bool blocking,
            double totalPoints,
            double projectBpTotal)
        {
            if (baseRate < 0.0 || efficiency == null)
            {
                return null;
            }
            var rate = baseRate * efficiency.Value * rushRate * (reversed ? -1.0 : 1.0);
            if (blocking && projectBpTotal > 0.0)
            {
                rate *= totalPoints / projectBpTotal;
            }
            return rate;
        }

        /// <summary>
        /// Research rate, mirroring <c>ResearchProject.BuildRate</c>'s warm path:
        /// the node's own rate times the operator's throttle. Absent until RP-1
        /// has costed the node.
        /// </summary>
        public static double? ResearchRate(double baseRate, double workRate)
        {
            if (baseRate < 0.0)
            {
                return null;
            }
            return baseRate * workRate;
        }

        /// <summary>
        /// A construction's effective rate, mirroring
        /// <c>ConstructionProject.GetBuildRate</c>: the costed base rate times the
        /// operator's throttle. Absent until RP-1 has costed the project.
        /// </summary>
        /// <remarks>
        /// The same arithmetic as <see cref="ResearchRate"/> and a separate method
        /// on purpose: the two throttles have different ranges (a construction's
        /// runs to 1.5 and buys speed for money above 1, a research node's stops
        /// at 1) and RP-1 could move one without the other.
        ///
        /// <para>Note what is NOT here. A construction's base rate does not depend
        /// on the queue position or on engineers: <c>Formula
        /// .GetConstructionBuildRate</c> ignores its index argument entirely and
        /// reads no crew, so constructions all advance at once while vehicles and
        /// research nodes are zeroed at any position but the head. There is no
        /// share to divide and no sequence to walk.</para>
        /// </remarks>
        public static double? ConstructionRate(double baseRate, double workRate)
        {
            if (baseRate < 0.0)
            {
                return null;
            }
            return baseRate * workRate;
        }

        /// <summary>
        /// Seconds of work remaining at <paramref name="rate"/>, before the
        /// efficiency ramp. Absent at an absent or zero rate, where RP-1's own
        /// answer is an infinity.
        /// </summary>
        public static double? BaseTimeLeft(double progress, double totalPoints, double? rate, bool reversed = false)
        {
            if (rate == null || rate.Value == 0.0 || double.IsNaN(rate.Value))
            {
                return null;
            }
            var remaining = (reversed ? 0.0 : totalPoints) - progress;
            return Math.Abs(remaining) / Math.Abs(rate.Value);
        }

        /// <summary>
        /// The crew getting better during a long wait, matching what RP-1 itself
        /// displays. A build measured in months finishes sooner than
        /// remaining-over-current-rate says, because the engineers working it are
        /// improving the whole time, so a naive estimate over-states a long queue.
        /// </summary>
        /// <param name="baseSeconds">The un-ramped estimate.</param>
        /// <param name="efficiency">The complex's efficiency now.</param>
        /// <param name="maxEfficiency">
        /// <c>LCEfficiency.MaxEfficiency</c>. At the ceiling there is no skill-up
        /// left to have, so the ramp is a no-op.
        /// </param>
        /// <param name="isRushing">
        /// Rushing suppresses skill-up in RP-1's model, so the ramp does not apply.
        /// This is the case whose RP-1 implementation returns a time where its
        /// callers expect an efficiency; see the type remarks.
        /// </param>
        /// <param name="engineers">Engineers assigned. None means nobody is improving.</param>
        /// <param name="maxEngineers">The complex's engineer cap, which sets how fast they improve.</param>
        /// <param name="predictWeightedEfficiency">
        /// Bound to the complex's own <c>LCEfficiency.PredictWeightedEfficiency</c>,
        /// which is verified pure (it reads its own efficiency and some statics and
        /// writes only locals). Taking it as a delegate is what keeps this
        /// arithmetic testable with no RP-1 present: the argument is the interval
        /// to average over and the result is the mean efficiency across it.
        /// </param>
        public static double RampedTimeLeft(
            double baseSeconds,
            double efficiency,
            double maxEfficiency,
            bool isRushing,
            int engineers,
            int maxEngineers,
            Func<double, double> predictWeightedEfficiency)
        {
            if (predictWeightedEfficiency == null
                || isRushing
                || engineers <= 0
                || maxEngineers <= 0
                || efficiency <= 0.0
                || efficiency >= maxEfficiency
                || baseSeconds < RampFloorSeconds)
            {
                return baseSeconds;
            }

            // The work still to do, expressed independently of efficiency, so each
            // iteration can re-divide it by a better mean. RP-1 spells this two
            // different ways in its two callers; they are the same quantity.
            var workAtUnitEfficiency = baseSeconds * efficiency;
            var seconds = baseSeconds;
            for (var i = 0; i < 4; i++)
            {
                var weighted = predictWeightedEfficiency(seconds);
                if (weighted <= 0.0 || double.IsNaN(weighted))
                {
                    return baseSeconds;
                }
                seconds = workAtUnitEfficiency / weighted;
            }
            return seconds;
        }

        /// <summary>
        /// One blocking operation competing for a launch complex, as
        /// <see cref="SequencedTimeLeft"/> needs it.
        /// </summary>
        public struct BlockingOp
        {
            /// <summary>Absolute build points, which set this operation's share of the complex.</summary>
            public double Points;

            /// <summary>Work still to do: the distance progress has left to travel, whichever way it runs.</summary>
            public double Remaining;

            /// <summary>Absolute rate BEFORE the share is applied: base rate times efficiency times rush.</summary>
            public double Rate;
        }

        /// <summary>
        /// When a blocking operation finishes, given that it shares the complex
        /// with the others. Mirrors <c>LCOpsProject.GetTimeLeftEstAll</c>.
        /// </summary>
        /// <remarks>
        /// <para><b>Why this exists rather than the one-line share division.</b>
        /// Several blocking operations run at once, each taking the fraction of
        /// the complex its build points earn it, and as each finishes the
        /// survivors' shares grow. So the honest completion time is a sequence of
        /// intervals, and the single division is not a different-but-valid
        /// quantity, it is EARLY. An optimistic completion time on a
        /// mission-control dashboard is a correctness defect rather than a
        /// precision one.</para>
        ///
        /// <para><b>Why RP-1's own method cannot be called for it, permanently.</b>
        /// Two independent reasons, either sufficient. It reaches
        /// <c>LaunchComplex.Efficiency</c>, whose getter writes to the player's
        /// save on a cache miss. And it accumulates into three SHARED STATIC
        /// scratch lists on RP-1's own type, so calling it from a sampled capture
        /// would race RP-1's own UI doing the same thing on the same lists.</para>
        ///
        /// <para>Absent, never a fall back to the share division, when the
        /// sequence cannot be computed: a rate of zero or unknown anywhere in the
        /// set, no points to share, or a result that is not finite. The caller
        /// publishes how many peers the operation has, so "no ETA" still says
        /// something an operator can act on.</para>
        /// </remarks>
        /// <param name="ops">
        /// Every blocking, incomplete operation on the complex, with the SUBJECT
        /// at index 0. RP-1 adds the subject before its neighbours and stops the
        /// moment the subject is next to finish; index 0 is that rule.
        /// </param>
        public static double? SequencedTimeLeft(IList<BlockingOp> ops)
        {
            if (ops == null || ops.Count == 0)
            {
                return null;
            }

            var points = new List<double>(ops.Count);
            var remaining = new List<double>(ops.Count);
            var rates = new List<double>(ops.Count);
            var pointsTotal = 0.0;
            foreach (var op in ops)
            {
                if (op.Rate <= 0.0 || op.Points <= 0.0 || double.IsNaN(op.Rate) || double.IsNaN(op.Remaining))
                {
                    return null;
                }
                points.Add(op.Points);
                remaining.Add(op.Remaining);
                rates.Add(op.Rate);
                pointsTotal += op.Points;
            }
            if (pointsTotal <= 0.0)
            {
                return null;
            }

            var total = 0.0;
            while (points.Count > 0)
            {
                var soonest = double.MaxValue;
                var soonestPoints = 0.0;
                var soonestIndex = 0;
                // Downward with a strict comparison, matching RP-1: on a tie the
                // LOWEST index wins, and index 0 is the subject.
                var i = points.Count;
                while (i-- > 0)
                {
                    var interval = remaining[i] / (rates[i] * (points[i] / pointsTotal));
                    if (interval < soonest)
                    {
                        soonest = interval;
                        soonestPoints = points[i];
                        soonestIndex = i;
                    }
                }

                if (double.IsNaN(soonest) || double.IsInfinity(soonest))
                {
                    return null;
                }
                total += soonest;
                if (soonestIndex == 0)
                {
                    return total;
                }

                var j = points.Count;
                while (j-- > 0)
                {
                    if (j == soonestIndex)
                    {
                        points.RemoveAt(j);
                        remaining.RemoveAt(j);
                        rates.RemoveAt(j);
                    }
                    else
                    {
                        remaining[j] -= rates[j] * (points[j] / pointsTotal) * soonest;
                    }
                }
                pointsTotal -= soonestPoints;
                if (pointsTotal <= 0.0)
                {
                    return null;
                }
            }
            return total;
        }

        /// <summary>
        /// The rate resolved and is zero: this is costed and going nowhere, as
        /// distinct from RP-1 not having costed it yet. Two facts, never one, so a
        /// client cannot render "not priced" as "not moving".
        /// </summary>
        public static bool IsStalled(double? rate) => rate != null && rate.Value == 0.0;

        /// <summary>
        /// The share of a costed project's price that its REMAINING progress will
        /// still draw, and so what finishing it costs from here.
        ///
        /// <para>RP-1 bills these projects as they proceed
        /// (<c>LCOpsProject.IncrementProgress</c> takes
        /// <c>|Δprogress| / BP * cost</c> a tick), so the price already paid is
        /// the fraction already made and what a press commits to is what is left.
        /// Counted forward whichever way the project is running: a reversed one
        /// bills nothing while it reverses, and this is what completing it in the
        /// forward direction would draw.</para>
        ///
        /// <para>Absent when there are no build points to be a fraction of, on the
        /// same terms as <see cref="ProgressRatio"/>: RP-1 has not costed the
        /// project, which is not the same as it being free.</para>
        /// </summary>
        public static double? UnbilledCost(double cost, double progress, double totalPoints)
        {
            if (totalPoints <= 0.0 || double.IsNaN(totalPoints) || double.IsNaN(progress))
            {
                return null;
            }
            var left = (totalPoints - progress) / totalPoints;
            if (left < 0.0)
            {
                left = 0.0;
            }
            else if (left > 1.0)
            {
                left = 1.0;
            }
            return cost * left;
        }

        /// <summary>
        /// The extra engineer-equivalents a complex pays for while it rushes:
        /// what starting a rush would add to its crew bill, and what stopping one
        /// would save. Absent when the inputs do not resolve, which is not zero.
        /// </summary>
        /// <remarks>
        /// <para><b>Recovered from RP-1's own count rather than reproduced from
        /// its ladder.</b> <c>GetEffectiveEngineersForSalary(LaunchComplex)</c>
        /// has four arms and every one of them is
        /// <c>working * rushSalary + (engineers - working) * idleMult</c> for some
        /// working count: the whole crew for an ordinary complex, none of it for
        /// one with nothing active, and a split for a hangar or for a human-rated
        /// complex building an uncrewed vehicle. That expression is affine in the
        /// rush multiplier, so the working count falls out of the single figure
        /// RP-1 publishes and the extra is <c>working * (rushMult - 1)</c>. A
        /// mirror of the ladder would need the complex's build list, its rollout
        /// list and two <c>MaxEngineersFor</c> overloads, and would be a second
        /// copy of a rule that moves.</para>
        ///
        /// <para>Why not simply multiply the salary: the idle part of a crew is
        /// not multiplied, so <c>salary * rushMult</c> overstates the increase at
        /// exactly the complexes where the split is non-trivial, and states a
        /// cost at a complex where rushing changes nothing at all.</para>
        /// </remarks>
        /// <param name="effectiveEngineers">
        /// RP-1's effective head count for this complex, as it is NOW.
        /// </param>
        /// <param name="engineers">The complex's actual engineer count.</param>
        /// <param name="idleMult">The fraction of full salary an idle engineer draws.</param>
        /// <param name="rushMult">The multiplier a working engineer draws at while rushing.</param>
        /// <param name="isRushing">Whether the count above was taken while rushing.</param>
        public static double? RushSalaryDelta(
            double? effectiveEngineers,
            int engineers,
            double? idleMult,
            double? rushMult,
            bool isRushing)
        {
            if (effectiveEngineers == null || idleMult == null || rushMult == null)
            {
                return null;
            }

            // A crew of nobody costs nothing extra to rush, and so does a complex
            // RP-1 charges nothing for, which is one that is not operational.
            // Both are taken before the algebra, which would read a zero count as
            // a crew of negative working engineers.
            if (engineers <= 0 || effectiveEngineers.Value == 0.0)
            {
                return 0.0;
            }

            var idle = idleMult.Value;
            var rush = rushMult.Value;
            var current = isRushing ? rush : 1.0;
            // The divisor is what separates a working engineer from an idle one,
            // so a preset that made them draw the same leaves the split
            // unrecoverable rather than infinite.
            if (current == idle || double.IsNaN(effectiveEngineers.Value))
            {
                return null;
            }

            var working = (effectiveEngineers.Value - engineers * idle) / (current - idle);
            // Clamped because the recovery is exact only while RP-1's expression
            // holds: a release that adds a term to it would otherwise put a crew
            // of eleven working engineers on a complex staffed by six.
            if (working < 0.0)
            {
                working = 0.0;
            }
            else if (working > engineers)
            {
                working = engineers;
            }
            return working * (rush - 1.0);
        }
    }
}
