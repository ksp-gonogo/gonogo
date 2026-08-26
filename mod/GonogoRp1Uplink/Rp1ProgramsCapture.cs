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
                });
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
