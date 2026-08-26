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
    }
}
