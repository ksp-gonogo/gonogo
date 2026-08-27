namespace GonogoRp1Uplink
{
    /// <summary>
    /// The arithmetic behind the crew schedule, reproduced from RP-1's own bodies
    /// and kept pure so it is exercised without a game.
    /// </summary>
    /// <remarks>
    /// Reproduced rather than called for the reason <see cref="Rp1ScMath"/>'s
    /// header gives about the build queue, and one more specific to training:
    /// <c>TrainingCourse.GetTimeLeft</c> divides by <c>GetBuildRate()</c>, whose
    /// cache-miss path runs <c>CalculateBuildRate</c>, which reaches
    /// <c>CurrencyUtils.Rate</c>, which FIRES a GameEvents modifier query at every
    /// modifier in the save. That is a thing to run, not a thing to read, and it
    /// is the same fence <c>Rp1EconomyBackend</c> and
    /// <c>Rp1ProgramsReflection</c> already stand behind.
    ///
    /// <para>So the rate is read off the cached backing field instead, and an
    /// unrated course reports an absent finish date rather than the infinity
    /// RP-1's own divide would produce.</para>
    /// </remarks>
    public static class Rp1CrewMath
    {
        /// <summary>
        /// Fraction of a course complete, RP-1's <c>progress / BP</c>. Absent when
        /// either half is unreadable or the course is costed at zero points, which
        /// makes RP-1's own expression a NaN; a NaN is not a progress and must not
        /// reach a bar. Clamped to 0-1, because a course that overran its points
        /// is finished rather than 103% done.
        /// </summary>
        public static double? FractionComplete(double? progress, double? totalPoints)
        {
            if (progress == null || totalPoints == null || totalPoints.Value <= 0.0)
            {
                return null;
            }
            var fraction = progress.Value / totalPoints.Value;
            if (fraction < 0.0) return 0.0;
            if (fraction > 1.0) return 1.0;
            return fraction;
        }

        /// <summary>
        /// When a course finishes, as universal time: RP-1's
        /// <c>(BP - progress) / rate</c> added to now. Absent when the rate has not
        /// been computed yet (RP-1 leaves its cache at -1 until the first tick
        /// advances the course) or is zero, and absent for a course that has not
        /// STARTED, because an unstarted course makes no progress and a date for
        /// it would be a promise nothing is keeping.
        /// </summary>
        public static double? FinishesAtUt(double ut, bool started, double? progress, double? totalPoints, double? rate)
        {
            if (!started || progress == null || totalPoints == null || rate == null || rate.Value <= 0.0)
            {
                return null;
            }
            var remaining = totalPoints.Value - progress.Value;
            if (remaining <= 0.0)
            {
                return ut;
            }
            return ut + remaining / rate.Value;
        }

        /// <summary>
        /// The furthest a retirement could still be pushed, reproducing
        /// <c>CrewHandler.GetLatestRetireTime</c>: the date plus whatever is left
        /// of the career-wide extension cap. Absent when there is no date, which
        /// is exactly the branch RP-1's own getter answers 0 for.
        /// </summary>
        public static double? LatestRetiresAtUt(double? retiresAtUt, double? extensionUsedSeconds, double? capSeconds)
        {
            if (retiresAtUt == null || capSeconds == null)
            {
                return null;
            }
            var remaining = capSeconds.Value - (extensionUsedSeconds ?? 0.0);
            if (remaining <= 0.0)
            {
                // The cap is spent, so the date is already the latest it can be.
                // Stated rather than left absent: "cannot be pushed further" is a
                // planning fact, and an absent ceiling reads as an unknown one.
                return retiresAtUt.Value;
            }
            return retiresAtUt.Value + remaining;
        }

        /// <summary>
        /// Zero is RP-1's "no record" sentinel on both of its retirement getters,
        /// which return <c>0.0</c> from a failed <c>TryGetValue</c>. A kerbal whose
        /// retirement date is unknown is not a kerbal retiring at UT zero.
        /// </summary>
        public static double? ZeroAsAbsent(double? value) =>
            value == null || value.Value == 0.0 ? (double?)null : value;
    }
}
