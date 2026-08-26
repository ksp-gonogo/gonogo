using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Pure mapper: one tick of captured Program data to the dicts the wire
    /// carries. KSP-free, RP-1-free and side-effect-free, so it is unit-tested
    /// headless.
    /// </summary>
    /// <remarks>
    /// The Topic payload types in <c>GonogoRp1Uplink.Contract</c> are typing and
    /// codegen markers: the serializer walks a live value tree rather than
    /// serializing a POCO, so the keys below are the wire and this file is what
    /// keeps them in step with the declared shapes.
    /// </remarks>
    public static class Rp1ProgramsCapture
    {
        /// <summary>
        /// Null when RP-1's Program handler is not live. Publishing nothing is
        /// the point: an empty list would say this career has no Programs to
        /// accept, about a game whose catalogue is never empty.
        /// </summary>
        public static List<object?>? BuildPrograms(Rp1ProgramsRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }
            var list = new List<object?>();
            foreach (var p in raw.Programs)
            {
                var duration = p.DerivedDurationSeconds
                    ?? Rp1ProgramsMath.SpeedDurationSeconds(p.Speed, p.NominalDurationSeconds);
                var curve = ResolveCurve(raw, p.FundingCurve);
                var schedule = Rp1ProgramsMath.FundingSchedule(
                    curve, duration, p.TotalFunding, p.FracElapsed, p.FundsPaidOut,
                    p.IsActive, p.IsComplete);
                list.Add(new Dictionary<string, object?>
                {
                    ["name"] = p.Name,
                    ["title"] = p.Title,
                    ["state"] = p.State,
                    ["speed"] = p.Speed,
                    ["slots"] = p.Slots,
                    ["isHumanSpaceflight"] = p.IsHumanSpaceflight,
                    ["nominalDurationSeconds"] = p.NominalDurationSeconds,
                    ["acceptedUt"] = p.AcceptedUt,
                    ["deadlineUt"] = p.DeadlineUt,
                    ["objectivesCompletedUt"] = p.ObjectivesCompletedUt,
                    ["completedUt"] = p.CompletedUt,
                    ["lastPaymentUt"] = p.LastPaymentUt,
                    ["fracElapsed"] = p.FracElapsed,
                    ["totalFunding"] = p.TotalFunding,
                    ["fundsPaidOut"] = p.FundsPaidOut,
                    ["fundsRemaining"] = FundsRemaining(p),
                    ["fundingCurve"] = p.FundingCurve,
                    ["confidenceCost"] = p.ConfidenceCost,
                    ["repDeltaOnCompletePerYearEarly"] = p.RepDeltaOnCompletePerYearEarly,
                    ["repPenaltyPerYearLate"] = p.RepPenaltyPerYearLate,
                    ["repPenaltyAssessed"] = p.RepPenaltyAssessed,
                    ["requirementsMet"] = p.RequirementsMet,
                    ["objectivesMet"] = p.ObjectivesMet,
                    ["canAccept"] = p.CanAccept,
                    ["canComplete"] = p.CanComplete,
                    ["requirementsText"] = p.RequirementsText,
                    ["objectivesText"] = p.ObjectivesText,
                    ["durationSeconds"] = duration,
                    ["speedOptions"] = BuildSpeedOptions(p),
                    ["programsToDisableOnAccept"] = AbsentWhenEmpty(p.ProgramsToDisableOnAccept),
                    ["fundingPayments"] = BuildPayments(schedule),
                });
            }
            return list;
        }

        /// <summary>
        /// Every named funding curve RP-1 holds. Null for the same reason the
        /// Program list is: no handler means no catalogue, and an empty table
        /// would say RP-1 pays nothing on any curve.
        /// </summary>
        public static List<object?>? BuildFundingCurves(Rp1ProgramsRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }
            var list = new List<object?>();
            foreach (var curve in raw.Curves)
            {
                var keys = new List<object?>();
                foreach (var key in curve.Keys)
                {
                    keys.Add(new Dictionary<string, object?>
                    {
                        ["frac"] = key.Frac,
                        ["paidFraction"] = key.PaidFraction,
                        ["inTangent"] = key.InTangent,
                        ["outTangent"] = key.OutTangent,
                    });
                }
                list.Add(new Dictionary<string, object?>
                {
                    ["name"] = curve.Name,
                    ["isDefault"] = curve.Name != null && curve.Name == raw.DefaultCurve,
                    ["keys"] = keys.Count == 0 ? null : keys,
                });
            }
            return list;
        }

        /// <summary>
        /// The curve a Program is actually paid on, resolving RP-1's own
        /// fallback: <c>ProgramHandlerSettings.FundingCurve</c> returns the
        /// default for a name it does not hold as well as for an empty one, so a
        /// Program naming nothing is paid on the default rather than on nothing.
        /// </summary>
        private static List<Rp1FundingCurveKeyRaw>? ResolveCurve(Rp1ProgramsRaw raw, string? name)
        {
            var named = FindCurve(raw, name);
            return named ?? FindCurve(raw, raw.DefaultCurve);
        }

        private static List<Rp1FundingCurveKeyRaw>? FindCurve(Rp1ProgramsRaw raw, string? name)
        {
            if (name == null)
            {
                return null;
            }
            foreach (var curve in raw.Curves)
            {
                if (curve.Name == name && curve.Keys.Count > 0)
                {
                    return curve.Keys;
                }
            }
            return null;
        }

        /// <summary>
        /// The three speeds with their prices and durations, in RP-1's own enum
        /// order rather than the order a dictionary happens to enumerate in: the
        /// operator is reading a ladder from cheapest-and-slowest upward, and a
        /// ladder in an arbitrary order is not one.
        /// </summary>
        private static List<object?> BuildSpeedOptions(Rp1ProgramRaw p)
        {
            var options = new List<object?>();
            foreach (var speed in Rp1ProgramSpeeds.All)
            {
                options.Add(new Dictionary<string, object?>
                {
                    ["speed"] = speed,
                    // Absent when the table has no row for this speed, which is
                    // not the same as free: RP-1 loads a missing CONFIDENCECOSTS
                    // key as zero itself, so a real zero arrives as one.
                    ["confidenceCost"] = p.ConfidenceCostBySpeed.TryGetValue(speed, out var cost)
                        ? cost
                        : (double?)null,
                    ["durationSeconds"] = Rp1ProgramsMath.SpeedDurationSeconds(
                        speed, p.NominalDurationSeconds),
                });
            }
            return options;
        }

        private static List<object?>? BuildPayments(List<Rp1ProgramPaymentRaw> schedule)
        {
            if (schedule.Count == 0)
            {
                return null;
            }
            var rows = new List<object?>();
            foreach (var payment in schedule)
            {
                rows.Add(new Dictionary<string, object?>
                {
                    ["year"] = payment.Year,
                    ["funds"] = payment.Funds,
                    ["cumulativeFunds"] = payment.CumulativeFunds,
                });
            }
            return rows;
        }

        /// <summary>
        /// A list that is empty because there is nothing to list, published as
        /// absent. An empty array and "this Program closes nothing off" read the
        /// same to a client, and the second is the fact.
        /// </summary>
        private static List<object?>? AbsentWhenEmpty(List<string> names)
        {
            if (names.Count == 0)
            {
                return null;
            }
            var list = new List<object?>();
            foreach (var name in names)
            {
                list.Add(name);
            }
            return list;
        }

        /// <summary>Null when RP-1's Program handler is not live, for the reason above.</summary>
        public static Dictionary<string, object?>? BuildSlots(Rp1ProgramsRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }
            var slots = raw.Slots;
            return new Dictionary<string, object?>
            {
                ["maxSlots"] = slots.MaxSlots,
                ["usedSlots"] = slots.UsedSlots,
                ["freeSlots"] = slots.MaxSlots == null ? (int?)null : slots.MaxSlots.Value - slots.UsedSlots,
                ["activeCount"] = slots.ActiveCount,
                ["completedCount"] = slots.CompletedCount,
            };
        }

        /// <summary>
        /// What a Program has still to pay. Absent unless it has started paying:
        /// on an offer, the total is money that MIGHT be earned rather than money
        /// outstanding, and the two are not the same commitment.
        /// </summary>
        private static double? FundsRemaining(Rp1ProgramRaw p)
        {
            if (p.FundsPaidOut == null || p.TotalFunding == null)
            {
                return null;
            }
            return p.TotalFunding.Value - p.FundsPaidOut.Value;
        }
    }
}
