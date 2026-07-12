using System.Collections.Generic;

namespace Sitrep.Host.Recovery
{
    /// <summary>
    /// Channel topic ids for the recovery event stream — the single "last
    /// notable recovery" record plus its boolean "have we ever recorded one"
    /// companion. Both ride <c>Delivery.ReliableOrdered</c> (the event lane:
    /// every value delivered, in order, replayed to a late subscriber via the
    /// emitter's keyframe-on-subscribe), which is what makes <c>lastSummary</c>
    /// sticky across a station reconnect. Mirrors <c>Sitrep.Host.Crash.CrashTopics</c>
    /// exactly.
    /// </summary>
    public static class RecoveryTopics
    {
        public const string LastSummaryTopic = "recovery.lastSummary";
        public const string HasRecent = "recovery.hasRecent";
    }

    /// <summary>
    /// One science subject recovered — the plain, KSP-free counterpart to
    /// <c>Sitrep.Contract.RecoveryScienceEntry</c>.
    /// </summary>
    public sealed class RecoveryScienceItem
    {
        public string SubjectId = "";
        public string SubjectTitle = "";
        public double DataGathered;
        public double ScienceAmount;
    }

    /// <summary>
    /// One recovered-part group — the plain, KSP-free counterpart to
    /// <c>Sitrep.Contract.RecoveryPartEntry</c>.
    /// </summary>
    public sealed class RecoveryPartItem
    {
        public string PartName = "";
        public string PartTitle = "";
        public int Count;
        public double PartValue;
        public double ResourcesValue;
        public double TotalValue;
    }

    /// <summary>
    /// One recovered-resource group — the plain, KSP-free counterpart to
    /// <c>Sitrep.Contract.RecoveryResourceEntry</c>.
    /// </summary>
    public sealed class RecoveryResourceItem
    {
        public string ResourceName = "";
        public double Amount;
        public double UnitValue;
        public double TotalValue;
    }

    /// <summary>
    /// One crew member aboard at recovery — the plain, KSP-free counterpart to
    /// <c>Sitrep.Contract.RecoveryCrewEntry</c>.
    /// </summary>
    public sealed class RecoveryCrewItem
    {
        public string Name = "";
        public string Trait = "";
        public bool IsTourist;
        public double XpGained;
        public int LevelsGained;
        public int NewLevel;
    }

    /// <summary>
    /// The plain, KSP-free recovery record the producer assembles from live
    /// KSP (<c>ProtoVessel</c> + <c>KSP.UI.Screens.MissionRecoveryDialog</c>)
    /// on the main thread, then hands to <see cref="RecoveryPayload.Build"/>
    /// off the main thread. Holds no live KSP object references, so it is
    /// safe to carry across threads.
    /// </summary>
    public sealed class RecoveryCapture
    {
        public double CapturedAtUt;
        public string VesselName = "";
        public string VesselType = "";
        public string RecoveryLocation = "";
        public string RecoveryFactor = "";
        public double ScienceEarned;
        public double TotalScience;
        public double FundsEarned;
        public double TotalFunds;
        public double ReputationEarned;
        public double TotalReputation;
        public bool DisplayReputation;
        public List<RecoveryScienceItem> ScienceBreakdown = new List<RecoveryScienceItem>();
        public List<RecoveryPartItem> PartBreakdown = new List<RecoveryPartItem>();
        public List<RecoveryResourceItem> ResourceBreakdown = new List<RecoveryResourceItem>();
        public List<RecoveryCrewItem> CrewBreakdown = new List<RecoveryCrewItem>();
    }

    /// <summary>
    /// Pure recovery-record logic, factored out of the KSP-facing
    /// <c>Gonogo.KSP.RecoveryUplink</c> exactly as <c>Sitrep.Host.Crash.CrashPayload</c>
    /// is factored out of <c>CrashUplink</c> — no KSP/Unity references, so it
    /// is headless-testable. Owns the source-side relevance filter and the
    /// wire-dictionary assembly.
    /// </summary>
    public static class RecoveryPayload
    {
        /// <summary>
        /// Source-side relevance gate, the recovery-side twin of
        /// <c>CrashPayload.ShouldPublish</c> (the <c>crash.lastCrash filters
        /// debris at source</c> rule): a recovery record is published only
        /// for a real craft. Debris, a discarded flag, and an Unknown vessel
        /// type would otherwise clobber the single "last notable recovery"
        /// slot, so they are dropped here, in the producer, before publish.
        /// The wire carries the <c>VesselType</c> enum's string name.
        /// </summary>
        public static bool ShouldPublish(string? vesselType) =>
            vesselType != "Debris" && vesselType != "Flag" && vesselType != "Unknown";

        /// <summary>
        /// Flattens a <see cref="RecoveryCapture"/> to the nested
        /// <c>Dictionary&lt;string, object?&gt;</c> / <c>List&lt;object?&gt;</c>
        /// graph <see cref="Sitrep.Core.Serialization.JsonWriter"/> serializes.
        /// Key names match exactly what <c>FlightOutcomeBanner.parseRecovery</c>
        /// (the app) already reads off the wire.
        /// </summary>
        public static Dictionary<string, object?> Build(RecoveryCapture c)
        {
            var scienceBreakdown = new List<object?>(c.ScienceBreakdown.Count);
            foreach (var s in c.ScienceBreakdown)
            {
                scienceBreakdown.Add(new Dictionary<string, object?>
                {
                    ["subjectId"] = s.SubjectId,
                    ["subjectTitle"] = s.SubjectTitle,
                    ["dataGathered"] = s.DataGathered,
                    ["scienceAmount"] = s.ScienceAmount,
                });
            }

            var partBreakdown = new List<object?>(c.PartBreakdown.Count);
            foreach (var p in c.PartBreakdown)
            {
                partBreakdown.Add(new Dictionary<string, object?>
                {
                    ["partName"] = p.PartName,
                    ["partTitle"] = p.PartTitle,
                    ["count"] = p.Count,
                    ["partValue"] = p.PartValue,
                    ["resourcesValue"] = p.ResourcesValue,
                    ["totalValue"] = p.TotalValue,
                });
            }

            var resourceBreakdown = new List<object?>(c.ResourceBreakdown.Count);
            foreach (var r in c.ResourceBreakdown)
            {
                resourceBreakdown.Add(new Dictionary<string, object?>
                {
                    ["resourceName"] = r.ResourceName,
                    ["amount"] = r.Amount,
                    ["unitValue"] = r.UnitValue,
                    ["totalValue"] = r.TotalValue,
                });
            }

            var crewBreakdown = new List<object?>(c.CrewBreakdown.Count);
            foreach (var m in c.CrewBreakdown)
            {
                crewBreakdown.Add(new Dictionary<string, object?>
                {
                    ["name"] = m.Name,
                    ["trait"] = m.Trait,
                    ["isTourist"] = m.IsTourist,
                    ["xpGained"] = m.XpGained,
                    ["levelsGained"] = m.LevelsGained,
                    ["newLevel"] = m.NewLevel,
                });
            }

            return new Dictionary<string, object?>
            {
                ["capturedAtUT"] = c.CapturedAtUt,
                ["vesselName"] = c.VesselName,
                ["recoveryLocation"] = c.RecoveryLocation,
                ["recoveryFactor"] = c.RecoveryFactor,
                ["scienceEarned"] = c.ScienceEarned,
                ["totalScience"] = c.TotalScience,
                ["fundsEarned"] = c.FundsEarned,
                ["totalFunds"] = c.TotalFunds,
                ["reputationEarned"] = c.ReputationEarned,
                ["totalReputation"] = c.TotalReputation,
                ["displayReputation"] = c.DisplayReputation,
                ["scienceBreakdown"] = scienceBreakdown,
                ["partBreakdown"] = partBreakdown,
                ["resourceBreakdown"] = resourceBreakdown,
                ["crewBreakdown"] = crewBreakdown,
            };
        }
    }
}
