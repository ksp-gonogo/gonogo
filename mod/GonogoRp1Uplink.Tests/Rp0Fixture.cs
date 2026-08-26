using System;
using System.Collections.Generic;

// A stand-in for the RP-1 object graph, declared in RP-1's own namespace with
// RP-1's own type and member names, so the production reflection walk resolves
// it exactly as it resolves the real thing: same FindType lookup, same public
// and non-public member reads, same enumeration of collections as bare
// IEnumerable.
//
// Every name, accessibility and shape below was taken from an ilspycmd
// disassembly of the SHIPPED RP-1 v4.6.0.0 RP0.dll, so a rename on RP-1's side
// makes these tests wrong in the same direction it makes production wrong, and
// a typo here fails as loudly as a typo there.
//
// What this CANNOT do is stated plainly rather than implied: it proves the walk
// reads the members it claims to and derives what the arithmetic says, and it
// proves nothing whatever about the VALUES a running RP-1 would hold. There is
// no RP-1 install on this machine or the test rig.
namespace RP0
{
    public enum LaunchComplexType
    {
        Hangar,
        Pad,
    }

    public enum LaunchPadState
    {
        None,
        Destroyed,
        Nonoperational,
        Rollout,
        Rollback,
        Reconditioning,
        Free,
    }

    public enum ProjectType
    {
        None,
        VAB,
        SPH,
        TechNode,
        Reconditioning,
        KSC,
        AirLaunch,
        Crew,
        VesselRepair,
        CrewRnR,
    }

    public sealed class SpaceCenterSettings
    {
        public double RushRateMult = 1.5;
        public double repPortionLostPerDay = 0.02;
    }

    public static class Database
    {
        public static readonly SpaceCenterSettings SettingsSC = new SpaceCenterSettings();
    }

    /// <summary>
    /// Efficiency is a plain backing-field read on the real type; the prediction
    /// method is the one RP-1 member this Uplink invokes on a per-item path, and
    /// the stand-in returns a mean efficiency the way the real one does on its
    /// normal path.
    /// </summary>
    public class LCEfficiency
    {
        public static double MaxEfficiency = 1.0;

        private double _efficiency = 0.5;

        public double Efficiency => _efficiency;

        /// <summary>How many times the prediction was asked for, so a test can pin the four iterations.</summary>
        public int PredictCalls;

        public LCEfficiency(double efficiency)
        {
            _efficiency = efficiency;
        }

        public double PredictWeightedEfficiency(
            bool isRushing,
            double tdelta,
            double portionEngineers,
            out double newEff,
            double startingEfficiency = -1.0)
        {
            PredictCalls++;
            if (startingEfficiency < 0.0)
            {
                startingEfficiency = _efficiency;
            }
            newEff = startingEfficiency;
            if (isRushing || tdelta < 86400.0 || startingEfficiency >= MaxEfficiency)
            {
                // The shipped defect, reproduced deliberately: the early-out
                // returns the INTERVAL where every caller reads an efficiency.
                return tdelta;
            }
            // A crew that ends the interval a tenth better than it started, so
            // the mean sits halfway.
            newEff = Math.Min(MaxEfficiency, startingEfficiency + 0.1);
            return (startingEfficiency + newEff) / 2.0;
        }
    }

    public class LCOpsProject
    {
        public double BP;
        public double progress;
        public double cost;
        public string associatedID = string.Empty;

        protected double _buildRate = -1.0;

        public virtual bool IsReversed => false;
        public virtual bool IsBlocking => true;

        public void SetBuildRate(double rate) => _buildRate = rate;
    }

    public class VesselRepairProject : LCOpsProject
    {
    }

    public class ReconRolloutProject : LCOpsProject
    {
        public enum RolloutReconType
        {
            Reconditioning,
            Rollout,
            Rollback,
            Recovery,
            None,
            AirlaunchMount,
            AirlaunchUnmount,
        }

        public string launchPadID = "LaunchPad";
        public RolloutReconType RRType = RolloutReconType.None;

        public override bool IsBlocking => RRType != RolloutReconType.Reconditioning;

        public override bool IsReversed =>
            RRType == RolloutReconType.Rollback || RRType == RolloutReconType.AirlaunchUnmount;
    }

    public class VesselProject
    {
        public double progress;
        public double buildPoints;
        public string launchSite = "LaunchPad";
        public string shipName = "";
        public ProjectType Type = ProjectType.VAB;
        public bool humanRated;
        public float cost;
        public float mass;

        private double _buildRate = -1.0;

        public void SetBuildRate(double rate) => _buildRate = rate;
    }

    public class LCLaunchPad
    {
        public int level;
        public Guid id = Guid.NewGuid();
        public float fractionalLevel = -1f;
        public bool isOperational = true;
        public string name = "LaunchPad";
        public string launchSiteName = "LaunchPad";

        public LaunchPadState StateValue = LaunchPadState.Free;

        public LaunchPadState State => StateValue;
    }

    public class ResearchProject
    {
        public int scienceCost;
        public int startYear;
        public int endYear;
        public string techName = "";
        public string techID = "";
        public double progress;
        public double workRate = 1.0;

        private double _buildRate = -1.0;

        public void SetBuildRate(double rate) => _buildRate = rate;
    }

    public class LaunchComplex
    {
        private Guid _id = Guid.NewGuid();

        public string Name = "";
        public int Engineers;
        public bool IsRushing;
        public bool IsOperational = true;
        public List<LCLaunchPad> LaunchPads = new List<LCLaunchPad>();
        public List<VesselProject> BuildList = new List<VesselProject>();
        public List<VesselProject> Warehouse = new List<VesselProject>();
        public List<ReconRolloutProject> Recon_Rollout = new List<ReconRolloutProject>();
        public List<VesselRepairProject> VesselRepairs = new List<VesselRepairProject>();

        public LaunchComplexType LcTypeValue = LaunchComplexType.Pad;
        public double RateValue;
        public int MaxEngineersValue = 100;
        public bool HumanRatedValue;
        public float MassMinValue;
        public float MassMaxValue = 100f;

        public Guid ID => _id;
        public LaunchComplexType LCType => LcTypeValue;
        public double Rate => RateValue;
        public int MaxEngineers => MaxEngineersValue;
        public bool IsHumanRated => HumanRatedValue;
        public float MassMin => MassMinValue;
        public float MassMax => MassMaxValue;
    }

    public class LCSpaceCenter
    {
        public string KSCName = "";
        public int Engineers;
        public List<LaunchComplex> LaunchComplexes = new List<LaunchComplex>();

        public string? GroundStation;

        public string? AssociatedGroundStation => GroundStation;
    }

    public class SpaceCenterManagement
    {
        public static SpaceCenterManagement? Instance { get; set; }

        public bool enabledForSave = true;
        public int Researchers;
        public int Applicants;
        public LCSpaceCenter? ActiveSC;
        public List<LCSpaceCenter> KSCs = new List<LCSpaceCenter>();
        public List<ResearchProject> TechList = new List<ResearchProject>();
        public Dictionary<LaunchComplex, LCEfficiency> LCToEfficiency = new Dictionary<LaunchComplex, LCEfficiency>();
    }

    public class Confidence
    {
        public static Confidence? Instance { get; set; }

        private double confidence;
        private double confidenceEarned;

        public Confidence(double current, double earned)
        {
            confidence = current;
            confidenceEarned = earned;
        }
    }

    /// <summary>
    /// RP-1's prepaid unlock allowance. Shaped like the shipped handler in the
    /// one respect the reading depends on: a PUBLIC getter over a PRIVATE
    /// persisted field, so a reader that only looked at public fields would find
    /// nothing here and would find nothing in the game either.
    /// </summary>
    public class UnlockCreditHandler
    {
        public static UnlockCreditHandler? Instance { get; set; }

        private double _totalCredit;

        public UnlockCreditHandler(double totalCredit)
        {
            _totalCredit = totalCredit;
        }

        public double TotalCredit => _totalCredit;
    }

    /// <summary>
    /// RP-1's money model. `FillSubsidyDetails` reproduces the shipped
    /// arithmetic, including the Julian-year divisor the per-day conversion
    /// depends on, so a test can pin the conversion rather than assume it.
    /// </summary>
    public class MaintenanceHandler
    {
        public struct SubsidyDetails
        {
            public double minSubsidy;
            public double maxSubsidy;
            public double maxRep;
            public double subsidy;
        }

        public static MaintenanceHandler? Instance { get; set; }

        public double LCsCostPerDay;
        public double ResearchSalaryPerDay;
        public double TrainingUpkeepPerDay;
        public double NautBaseUpkeepPerDay;
        public double NautInFlightUpkeepPerDay;

        /// <summary>
        /// RP-1's own total, and NEGATIVE, which is the one place its sign
        /// convention differs from every field above it. The shipped
        /// UpdateUpkeep builds it as a sum of currency-modifier queries run on
        /// NEGATED costs, and SpaceCenterManagement adds it straight to the
        /// subsidy to get a net funds delta per day. A test holding a positive
        /// here would agree with a reading that puts a credit on the wire where
        /// the career is being drained.
        /// </summary>
        public double UpkeepPerDayForDisplay;

        public double FacilityUpkeepValue;
        public double IntegrationSalaryValue;

        public double FacilityUpkeepPerDay => FacilityUpkeepValue;
        public double IntegrationSalaryPerDay => IntegrationSalaryValue;

        /// <summary>Yearly figures the stand-in hands back, so the /365.25 conversion is observable.</summary>
        public static double MinSubsidyPerYear = 3652.5;
        public static double MaxSubsidyPerYear = 7305.0;

        public static void FillSubsidyDetails(ref SubsidyDetails details, double ut, double rep)
        {
            details.minSubsidy = MinSubsidyPerYear;
            details.maxSubsidy = MaxSubsidyPerYear;
            details.maxRep = 100.0;
            var t = rep <= 0.0 ? 0.0 : rep >= details.maxRep ? 1.0 : rep / details.maxRep;
            details.subsidy = details.minSubsidy + (details.maxSubsidy - details.minSubsidy) * t;
        }
    }
}
