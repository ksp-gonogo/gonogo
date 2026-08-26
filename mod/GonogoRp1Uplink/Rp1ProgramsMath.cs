using System;
using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The pure arithmetic behind a Program row: the two conversions RP-1 does
    /// in code the Uplink cannot call, and the program-modifier overlay it
    /// applies to a Program the career has not accepted yet.
    /// </summary>
    /// <remarks>
    /// Split out of the reflection walk for the same reason
    /// <see cref="Rp1ScMath"/> is: none of it needs an RP-1 object, so all of it
    /// can be pinned against RP-1's own disassembled arithmetic in a headless
    /// test rather than inferred from a captured row.
    /// </remarks>
    public static class Rp1ProgramsMath
    {
        /// <summary>
        /// One RP0_PROGRAM_MODIFIER in force, as plain data. Every numeric field
        /// carries RP-1's own -1 sentinel meaning "leave this alone", so the
        /// overlay below reproduces <c>ProgramModifier.Apply</c> exactly rather
        /// than treating an absent override as a zero.
        /// </summary>
        public sealed class ModifierOverlay
        {
            public string? Target;
            public double? NominalDurationYears;
            public double? BaseFunding;
            public string? FundingCurve;
            public double? RepDeltaOnCompletePerYearEarly;
            public double? RepPenaltyPerYearLate;
            public int? Slots;
            public Dictionary<string, double> ConfidenceCosts = new Dictionary<string, double>();
        }

        /// <summary>A Program duration in RP-1's own Julian years, as seconds. Absent stays absent.</summary>
        public static double? YearsToSeconds(double? years) =>
            years == null ? (double?)null : years.Value * Rp1ProgramsReflection.JulianYearSeconds;

        /// <summary>
        /// The reputation a Program loses per year past its deadline, scaled by
        /// speed. RP-1 charges a Fast Program half again as much and leaves Slow
        /// and Normal alone, which is <c>Program.RepPenaltyPerYearLateCalc</c> in
        /// full.
        /// </summary>
        public static double? RepPenaltyPerYearLate(string? speedName, double? penalty)
        {
            if (penalty == null)
            {
                return null;
            }
            return speedName == "Fast" ? penalty.Value * 1.5 : penalty.Value;
        }

        /// <summary>
        /// Applies every overlay that targets this row, in list order, mirroring
        /// <c>Program.ApplyProgramModifiers</c>. A no-op for a row nothing
        /// targets, which is the common case.
        /// </summary>
        public static void Overlay(Rp1ProgramRaw row, List<ModifierOverlay> overlays)
        {
            foreach (var overlay in overlays)
            {
                if (row.Name != null && overlay.Target == row.Name)
                {
                    Apply(row, overlay);
                }
            }
        }

        private static void Apply(Rp1ProgramRaw row, ModifierOverlay overlay)
        {
            if (IsSet(overlay.NominalDurationYears))
            {
                row.NominalDurationSeconds = YearsToSeconds(overlay.NominalDurationYears);
            }
            if (IsSet(overlay.BaseFunding))
            {
                row.TotalFunding = ScaleTotal(row, overlay.BaseFunding!.Value);
                row.BaseFunding = overlay.BaseFunding;
            }
            if (!string.IsNullOrEmpty(overlay.FundingCurve))
            {
                row.FundingCurve = overlay.FundingCurve;
            }
            if (IsSet(overlay.RepDeltaOnCompletePerYearEarly))
            {
                row.RepDeltaOnCompletePerYearEarly = overlay.RepDeltaOnCompletePerYearEarly;
            }
            if (IsSet(overlay.RepPenaltyPerYearLate))
            {
                row.RepPenaltyPerYearLate = RepPenaltyPerYearLate(row.Speed, overlay.RepPenaltyPerYearLate);
            }
            if (overlay.Slots != null && overlay.Slots.Value != -1)
            {
                row.Slots = overlay.Slots.Value;
            }
            // Per speed, not just the selected one: an operator weighing Fast
            // against Normal is reading the whole table, and a modifier that
            // discounted only the row they happen to have selected would make
            // the other two lie.
            foreach (var pair in overlay.ConfidenceCosts)
            {
                row.ConfidenceCostBySpeed[pair.Key] = pair.Value;
            }
            if (row.Speed != null && overlay.ConfidenceCosts.TryGetValue(row.Speed, out var cost))
            {
                row.ConfidenceCost = cost;
            }
        }

        /// <summary>
        /// The overridden funding at the career's own funds multiplier, taken as
        /// the ratio the catalogue row already carries rather than by reading the
        /// multiplier: RP-1 puts base and total through the same linear
        /// conversion, so the ratio IS the multiplier and needs no second game
        /// read.
        ///
        /// <para>Absent when the catalogue row cannot supply that ratio, which
        /// is a Program whose own base funding is zero. Scaling from an assumed
        /// multiplier would put a number on the wire the Administration building
        /// will not offer.</para>
        /// </summary>
        private static double? ScaleTotal(Rp1ProgramRaw row, double newBase)
        {
            if (row.TotalFunding == null || row.BaseFunding == null || row.BaseFunding.Value == 0.0)
            {
                return null;
            }
            return row.TotalFunding.Value * newBase / row.BaseFunding.Value;
        }

        /// <summary>RP-1's per-field sentinel: -1 means the modifier leaves that field alone.</summary>
        private static bool IsSet(double? value) => value != null && value.Value != -1.0;

        /// <summary>
        /// The duration a Program runs for at one speed, in seconds:
        /// <c>Program.DurationYearsCalc</c> up to but not including its final
        /// currency-modifier pass.
        ///
        /// <para>The pass is why this is a floor rather than the answer. RP-1
        /// scales the catalogue years by 1.5 for Slow and 0.75 for Fast, rounds
        /// to a quarter year, and then hands the result to
        /// <c>CurrencyUtils.Time</c>, which broadcasts to every modifier in the
        /// save. A leader can shorten it from there. Everything before that
        /// broadcast is arithmetic and is reproduced exactly; what a leader would
        /// do to it is only observable on an accepted Program, through
        /// <see cref="DerivedDurationSeconds"/>.</para>
        /// </summary>
        public static double? SpeedDurationSeconds(string? speedName, double? nominalSeconds)
        {
            if (nominalSeconds == null)
            {
                return null;
            }
            var years = nominalSeconds.Value / Rp1ProgramsReflection.JulianYearSeconds;
            var factor = SpeedFactor(speedName);
            return Math.Round(years * factor * 4.0) * 0.25 * Rp1ProgramsReflection.JulianYearSeconds;
        }

        /// <summary>
        /// RP-1's duration multiplier per speed. Slow stretches a Program, Fast
        /// compresses it, and an unrecognised name leaves it alone rather than
        /// guessing: a speed RP-1 added after this build should read as the
        /// catalogue duration, not as a Slow one.
        /// </summary>
        private static double SpeedFactor(string? speedName)
        {
            switch (speedName)
            {
                case Rp1ProgramSpeeds.Slow: return 1.5;
                case Rp1ProgramSpeeds.Fast: return 0.75;
                default: return 1.0;
            }
        }

        /// <summary>
        /// The duration in force on an accepted Program, in seconds, read out of
        /// the three fields RP-1's own funding tick leaves consistent:
        /// <c>deadlineUT = lastPaymentUT + (1 - fracElapsed) * duration</c>.
        /// Rearranged, that is the duration including every modifier applied to
        /// it, which no other route reaches without firing RP-1's broadcast.
        ///
        /// <para>Absent once <c>fracElapsed</c> reaches 1, and this is the fence
        /// rather than a divide-by-zero guard: RP-1 stops recomputing
        /// <c>deadlineUT</c> at that point, so past the deadline the three fields
        /// are no longer consistent with each other and the arithmetic would
        /// return a number about nothing.</para>
        /// </summary>
        public static double? DerivedDurationSeconds(
            double? deadlineUt, double? lastPaymentUt, double? fracElapsed)
        {
            if (deadlineUt == null || lastPaymentUt == null || fracElapsed == null)
            {
                return null;
            }
            var remaining = 1.0 - fracElapsed.Value;
            if (remaining <= 0.0)
            {
                return null;
            }
            var duration = (deadlineUt.Value - lastPaymentUt.Value) / remaining;
            return duration > 0.0 ? duration : (double?)null;
        }

        /// <summary>
        /// A funding curve at one point, as <c>HermiteCurve.Evaluate</c> reads
        /// it: the cumulative fraction of a Program's total funding paid by
        /// <paramref name="frac"/> of its duration.
        ///
        /// <para>Clamped to the first and last key's value outside the curve's
        /// own range, which is RP-1's behaviour and not an approximation of it:
        /// its <c>Evaluate</c> returns <c>_firstValue</c> below the range and
        /// <c>_lastValue</c> above, so a Program warped far past its deadline
        /// stops accruing rather than extrapolating off the end of the table.</para>
        ///
        /// <para>Written in the normalised Hermite basis, which is RP-1's own
        /// <c>EvaluateBetweenKeys</c>. Its <c>Evaluate</c> takes an algebraically
        /// identical route through absolute-time polynomial coefficients; over a
        /// domain of 0 to 2 the two agree to the last bits of a double, and the
        /// basis form is the one that can be read against the disassembly.</para>
        /// </summary>
        public static double? EvaluateCurve(List<Rp1FundingCurveKeyRaw>? keys, double frac)
        {
            if (keys == null || keys.Count == 0)
            {
                return null;
            }
            var first = keys[0];
            var last = keys[keys.Count - 1];
            if (frac <= first.Frac)
            {
                return first.PaidFraction;
            }
            if (frac >= last.Frac)
            {
                return last.PaidFraction;
            }
            for (var i = keys.Count - 2; i >= 0; i--)
            {
                var k0 = keys[i];
                if (frac < k0.Frac)
                {
                    continue;
                }
                var k1 = keys[i + 1];
                // An infinite tangent is RP-1's step mode: the segment holds the
                // left key's value rather than interpolating through infinity.
                if (double.IsInfinity(k0.OutTangent) || double.IsInfinity(k1.InTangent))
                {
                    return k0.PaidFraction;
                }
                var span = k1.Frac - k0.Frac;
                var t = (frac - k0.Frac) / span;
                var t2 = t * t;
                var t3 = t2 * t;
                return (2.0 * t3 - 3.0 * t2 + 1.0) * k0.PaidFraction
                    + (t3 - 2.0 * t2 + t) * span * k0.OutTangent
                    + (-2.0 * t3 + 3.0 * t2) * k1.PaidFraction
                    + (t3 - t2) * span * k1.InTangent;
            }
            return first.PaidFraction;
        }

        /// <summary>
        /// The per-year funding schedule RP-1's Administration building
        /// tabulates, reproducing <c>Program.GetDescription</c>'s own loop: one
        /// row per nominal year, each row the curve's cumulative reading at the
        /// year's end less the reading at the previous one, with the final year
        /// clamped to the duration so a Program lasting 3.25 years pays a short
        /// last year rather than a whole fourth one.
        ///
        /// <para>On a running Program the table starts at the year the career has
        /// already reached and measures the first row from what has actually been
        /// paid out, so it answers "what is still coming" rather than "what was
        /// promised". Empty on a completed Program, which is RP-1's own rule.</para>
        /// </summary>
        public static List<Rp1ProgramPaymentRaw> FundingSchedule(
            List<Rp1FundingCurveKeyRaw>? keys,
            double? durationSeconds,
            double? totalFunding,
            double? fracElapsed,
            double? fundsPaidOut,
            bool isActive,
            bool isComplete)
        {
            var schedule = new List<Rp1ProgramPaymentRaw>();
            if (isComplete || keys == null || keys.Count == 0)
            {
                return schedule;
            }
            if (durationSeconds == null || durationSeconds.Value <= 0.0 || totalFunding == null)
            {
                return schedule;
            }

            var durationYears = durationSeconds.Value / Rp1ProgramsReflection.JulianYearSeconds;
            var lastYear = (int)Math.Ceiling(durationYears);
            var firstYear = 1;
            var running = 0.0;
            if (isActive)
            {
                firstYear = (int)((fracElapsed ?? 0.0) * durationYears) + 1;
                running = fundsPaidOut ?? 0.0;
            }

            for (var year = firstYear; year <= lastYear; year++)
            {
                var frac = Math.Min(year, durationYears) / durationYears;
                var cumulative = EvaluateCurve(keys, frac);
                if (cumulative == null)
                {
                    break;
                }
                var fundsAtEnd = cumulative.Value * totalFunding.Value;
                schedule.Add(new Rp1ProgramPaymentRaw
                {
                    Year = year,
                    Funds = fundsAtEnd - running,
                    CumulativeFunds = fundsAtEnd,
                });
                running = fundsAtEnd;
            }
            return schedule;
        }
    }

    /// <summary>One row of a Program's per-year funding schedule.</summary>
    public sealed class Rp1ProgramPaymentRaw
    {
        public int Year;
        public double Funds;
        public double CumulativeFunds;
    }
}
