using System;

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
        /// The rate resolved and is zero: this is costed and going nowhere, as
        /// distinct from RP-1 not having costed it yet. Two facts, never one, so a
        /// client cannot render "not priced" as "not moving".
        /// </summary>
        public static bool IsStalled(double? rate) => rate != null && rate.Value == 0.0;
    }
}
