using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Pure mapper: one tick of captured RP-1 data to the dicts the wire carries.
    /// KSP-free, RP-1-free and side-effect-free, so it is unit-tested headless.
    /// </summary>
    /// <remarks>
    /// The Topic payload types in <c>GonogoRp1Uplink.Contract</c> are typing and
    /// codegen markers: the serializer walks a live value tree rather than
    /// serializing a POCO, so the keys below are the wire and this file is what
    /// keeps them in step with the declared shapes.
    /// </remarks>
    public static class Rp1ScCapture
    {
        public static List<object?> BuildCentres(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var c in raw.Centres)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["kscName"] = c.KscName,
                    ["kscDisplayName"] = c.KscDisplayName,
                    ["isActive"] = c.IsActive,
                    ["engineers"] = c.Engineers,
                    ["unassignedEngineers"] = c.UnassignedEngineers,
                    ["launchComplexCount"] = c.LaunchComplexCount,
                    ["anyOperational"] = c.AnyOperational,
                    ["groundStation"] = c.GroundStation,
                    ["salaryPerDay"] = c.SalaryPerDay,
                    ["idleSalaryPerDay"] = c.IdleSalaryPerDay,
                    ["upkeepPerDay"] = c.UpkeepPerDay,
                });
            }
            return list;
        }

        public static List<object?> BuildComplexes(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var c in raw.Complexes)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["kscName"] = c.KscName,
                    ["kscDisplayName"] = c.KscDisplayName,
                    ["lcId"] = c.LcId,
                    ["name"] = c.Name,
                    ["lcType"] = c.LcType,
                    ["isOperational"] = c.IsOperational,
                    ["isRushing"] = c.IsRushing,
                    ["engineers"] = c.Engineers,
                    ["maxEngineers"] = c.MaxEngineers,
                    ["efficiency"] = c.Efficiency,
                    // Empty and absent are different answers here, the way they
                    // are for resourcesHandled below: a record covering this
                    // complex alone is a fact, and no record at all is RP-1 not
                    // having rated the crew yet.
                    ["efficiencySharedWith"] = c.EfficiencySharedWith,
                    ["canIntegrate"] = c.CanIntegrate,
                    ["rate"] = c.Rate,
                    ["humanRated"] = c.HumanRated,
                    ["launchPadCount"] = c.LaunchPadCount,
                    ["massMin"] = c.MassMin,
                    ["massMax"] = c.MassMax,
                    ["massOrig"] = c.MassOrig,
                    ["sizeMaxHeight"] = c.SizeMaxHeight,
                    ["sizeMaxWidth"] = c.SizeMaxWidth,
                    ["sizeMaxDepth"] = c.SizeMaxDepth,
                    // Emitted even when empty, unlike the warehouse's refusals: a
                    // complex that handles no resources is a real limit an
                    // operator has to read, where an absent refusal means there
                    // was nothing to object to.
                    ["resourcesHandled"] = c.ResourcesHandled,
                    ["salaryPerDay"] = c.SalaryPerDay,
                    ["upkeepPerDay"] = c.UpkeepPerDay,
                });
            }
            return list;
        }

        /// <summary>
        /// The buildable preview: one row per craft file, each with one verdict
        /// per complex. A nested array, because the question is per (craft,
        /// complex) pair and flattening it would make a client join two channels
        /// to answer a single control's enabled state.
        /// </summary>
        public static List<object?> Buildable(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var c in raw.Buildable)
            {
                var complexes = new List<object?>();
                foreach (var lc in c.Complexes)
                {
                    complexes.Add(new Dictionary<string, object?>
                    {
                        ["lcId"] = lc.LcId,
                        ["name"] = lc.Name,
                        ["kscName"] = lc.KscName,
                        ["kscDisplayName"] = lc.KscDisplayName,
                        ["eligible"] = lc.Eligible,
                        ["refusals"] = lc.Refusals,
                    });
                }
                list.Add(new Dictionary<string, object?>
                {
                    ["craftFile"] = c.CraftFile,
                    ["shipName"] = c.ShipName,
                    ["facility"] = c.FacilityOrdinal,
                    ["partCount"] = c.PartCount,
                    ["mass"] = c.Mass,
                    ["cost"] = c.Cost,
                    ["missingParts"] = c.MissingParts,
                    ["lockedParts"] = c.LockedParts,
                    ["unpurchasedParts"] = c.UnpurchasedParts,
                    ["complexes"] = complexes,
                });
            }
            return list;
        }

        public static List<object?> BuildQueue(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var v in raw.BuildQueue)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["id"] = v.Id,
                    ["shipId"] = v.ShipId,
                    ["kscName"] = v.KscName,
                    ["lcId"] = v.LcId,
                    ["shipName"] = v.ShipName,
                    ["progress"] = v.Progress,
                    ["totalPoints"] = v.TotalPoints,
                    ["progressRatio"] = v.ProgressRatio,
                    ["rate"] = v.Rate,
                    ["timeLeftSeconds"] = v.TimeLeftSeconds,
                    ["stalled"] = v.Stalled,
                    ["cost"] = v.Cost,
                    ["mass"] = v.Mass,
                    ["humanRated"] = v.HumanRated,
                    ["launchSite"] = v.LaunchSite,
                    ["projectType"] = v.ProjectType,
                });
            }
            return list;
        }

        /// <summary>
        /// The warehouse: finished vehicles, so the progress, rate and ETA keys
        /// the build queue carries are absent here rather than present and
        /// meaningless.
        /// </summary>
        public static List<object?> BuildWarehouse(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var v in raw.Warehouse)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["id"] = v.Id,
                    ["shipId"] = v.ShipId,
                    ["kscName"] = v.KscName,
                    ["lcId"] = v.LcId,
                    ["shipName"] = v.ShipName,
                    ["cost"] = v.Cost,
                    ["mass"] = v.Mass,
                    ["humanRated"] = v.HumanRated,
                    ["launchSite"] = v.LaunchSite,
                    ["projectType"] = v.ProjectType,
                    // Absent when there are none, which is the eligible case, so
                    // a client reads "no key" as "RP-1 has no objection". An
                    // empty ARRAY would say the same thing and cost a wire
                    // allocation per vehicle per tick to say it.
                    ["rolloutRefusals"] = v.RolloutRefusals,
                });
            }
            return list;
        }

        public static List<object?> BuildPads(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var p in raw.Pads)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["kscName"] = p.KscName,
                    ["lcId"] = p.LcId,
                    ["padId"] = p.PadId,
                    ["name"] = p.Name,
                    ["launchSiteName"] = p.LaunchSiteName,
                    ["level"] = p.Level,
                    ["fractionalLevel"] = p.FractionalLevel,
                    ["state"] = p.State,
                    ["hasVesselWaiting"] = p.HasVesselWaiting,
                    ["waitingVesselName"] = p.WaitingVesselName,
                });
            }
            return list;
        }

        public static List<object?> BuildOperations(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var o in raw.Operations)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["kscName"] = o.KscName,
                    ["lcId"] = o.LcId,
                    ["launchPadId"] = o.LaunchPadId,
                    ["type"] = o.Type,
                    ["progress"] = o.Progress,
                    ["totalPoints"] = o.TotalPoints,
                    ["progressRatio"] = o.ProgressRatio,
                    ["rate"] = o.Rate,
                    ["timeLeftSeconds"] = o.TimeLeftSeconds,
                    ["stalled"] = o.Stalled,
                    ["blockingPeers"] = o.BlockingPeers,
                    ["cost"] = o.Cost,
                    ["associatedVesselId"] = o.AssociatedVesselId,
                });
            }
            return list;
        }

        /// <summary>
        /// The construction queue. Every per-kind key is emitted for every row,
        /// carrying null where the kind does not have it: a client reading
        /// <c>currentLevel</c> off a pad row must find an absence rather than a
        /// missing key, which is the same discipline the warehouse row follows for
        /// the progress fields it does not have.
        /// </summary>
        public static List<object?> BuildConstructions(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var c in raw.Constructions)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["kscName"] = c.KscName,
                    ["lcId"] = c.LcId,
                    ["kind"] = c.Kind,
                    ["name"] = c.Name,
                    ["facilityType"] = c.FacilityType,
                    ["currentLevel"] = c.CurrentLevel,
                    ["targetLevel"] = c.TargetLevel,
                    ["isModify"] = c.IsModify,
                    ["engineersToReadd"] = c.EngineersToReadd,
                    ["padId"] = c.PadId,
                    ["progress"] = c.Progress,
                    ["totalPoints"] = c.TotalPoints,
                    ["progressRatio"] = c.ProgressRatio,
                    ["workRate"] = c.WorkRate,
                    ["rate"] = c.Rate,
                    ["timeLeftSeconds"] = c.TimeLeftSeconds,
                    ["stalled"] = c.Stalled,
                    ["cost"] = c.Cost,
                    ["spentCost"] = c.SpentCost,
                    ["spentRushCost"] = c.SpentRushCost,
                });
            }
            return list;
        }

        public static List<object?> BuildResearch(Rp1ScRaw raw)
        {
            var list = new List<object?>();
            foreach (var r in raw.Research)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["techId"] = r.TechId,
                    ["techName"] = r.TechName,
                    ["scienceCost"] = r.ScienceCost,
                    ["progress"] = r.Progress,
                    ["progressRatio"] = r.ProgressRatio,
                    ["workRate"] = r.WorkRate,
                    ["rate"] = r.Rate,
                    ["timeLeftSeconds"] = r.TimeLeftSeconds,
                    ["stalled"] = r.Stalled,
                    ["startYear"] = r.StartYear,
                    ["endYear"] = r.EndYear,
                });
            }
            return list;
        }

        /// <summary>Null when RP-1 is not managing this save, so the channel says nothing rather than zero.</summary>
        public static Dictionary<string, object?>? BuildPersonnel(Rp1ScRaw raw)
        {
            if (raw.Personnel == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["totalEngineers"] = raw.Personnel.TotalEngineers,
                ["researchers"] = raw.Personnel.Researchers,
                ["applicants"] = raw.Personnel.Applicants,
                ["engineerSalaryPerDay"] = raw.Personnel.EngineerSalaryPerDay,
                ["researcherSalaryPerDay"] = raw.Personnel.ResearcherSalaryPerDay,
                ["engineerSalaryPerYear"] = raw.Personnel.EngineerSalaryPerYear,
                ["researcherSalaryPerYear"] = raw.Personnel.ResearcherSalaryPerYear,
                ["idleSalaryMult"] = raw.Personnel.IdleSalaryMult,
                ["hireTarget"] = BuildHireTarget(raw.HireTarget),
            };
        }

        /// <summary>
        /// Null when the instruction could not be read at all, so a client says
        /// nothing rather than claiming none is set. An instruction that is set
        /// and one that is merely absent are both readings, and are told apart by
        /// <c>active</c>.
        /// </summary>
        public static Dictionary<string, object?>? BuildHireTarget(Rp1HireTargetRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["active"] = raw.Active,
                ["targetCount"] = raw.TargetCount,
                ["currentCount"] = raw.CurrentCount,
                ["leftToHire"] = raw.LeftToHire,
                ["isResearch"] = raw.IsResearch,
                ["lcId"] = raw.LcId,
                ["timeLeft"] = raw.TimeLeftSeconds,
            };
        }

        /// <summary>The warp's fund stop-condition, on the same terms as the hire target.</summary>
        public static Dictionary<string, object?>? BuildFundTarget(Rp1ScRaw raw)
        {
            if (raw.FundTarget == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["active"] = raw.FundTarget.Active,
                ["targetFunds"] = raw.FundTarget.TargetFunds,
                ["originalFunds"] = raw.FundTarget.OriginalFunds,
                ["timeLeft"] = raw.FundTarget.TimeLeftSeconds,
            };
        }

        /// <summary>
        /// Null when RP-1's settings could not be read, so a client says nothing
        /// about what rushing costs rather than quoting the shipped default at an
        /// operator whose career may not use it.
        /// </summary>
        public static Dictionary<string, object?>? BuildRushTerms(Rp1ScRaw raw)
        {
            if (raw.RushTerms == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["rateMult"] = raw.RushTerms.RateMult,
                ["salaryMult"] = raw.RushTerms.SalaryMult,
            };
        }

        /// <summary>
        /// Null when RP-1's Confidence module is not live. Publishing nothing is
        /// the point: a zero here is indistinguishable from a career that has
        /// spent everything it had.
        /// </summary>
        public static Dictionary<string, object?>? BuildConfidence(Rp1ScRaw raw)
        {
            if (raw.Confidence == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["confidence"] = raw.Confidence.Confidence,
                ["earned"] = raw.Confidence.Earned,
            };
        }
    }
}
