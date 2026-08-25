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
                    ["isActive"] = c.IsActive,
                    ["engineers"] = c.Engineers,
                    ["unassignedEngineers"] = c.UnassignedEngineers,
                    ["launchComplexCount"] = c.LaunchComplexCount,
                    ["anyOperational"] = c.AnyOperational,
                    ["groundStation"] = c.GroundStation,
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
                    ["lcId"] = c.LcId,
                    ["name"] = c.Name,
                    ["lcType"] = c.LcType,
                    ["isOperational"] = c.IsOperational,
                    ["isRushing"] = c.IsRushing,
                    ["engineers"] = c.Engineers,
                    ["maxEngineers"] = c.MaxEngineers,
                    ["efficiency"] = c.Efficiency,
                    ["canIntegrate"] = c.CanIntegrate,
                    ["rate"] = c.Rate,
                    ["humanRated"] = c.HumanRated,
                    ["massMin"] = c.MassMin,
                    ["massMax"] = c.MassMax,
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
                    ["kscName"] = v.KscName,
                    ["lcId"] = v.LcId,
                    ["shipName"] = v.ShipName,
                    ["cost"] = v.Cost,
                    ["mass"] = v.Mass,
                    ["humanRated"] = v.HumanRated,
                    ["launchSite"] = v.LaunchSite,
                    ["projectType"] = v.ProjectType,
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
                    ["cost"] = o.Cost,
                    ["associatedVesselId"] = o.AssociatedVesselId,
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
