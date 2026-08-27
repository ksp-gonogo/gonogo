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
        public enum ClampsState
        {
            Untested,
            NoClamps,
            HasClamps,
        }

        public double progress;
        public double buildPoints;
        public string launchSite = "LaunchPad";
        public string shipName = "";
        public Guid shipID = Guid.NewGuid();
        public ProjectType Type = ProjectType.VAB;
        public bool humanRated;
        public float cost;
        public float mass;

        /// <summary>
        /// The recorded envelope of the built article. Zero on the real type
        /// until something asks for it, which is why the launch gate treats a
        /// zero as a size nobody wrote down.
        /// </summary>
        public UnityEngine.Vector3 ShipSize;

        public ClampsState clampState = ClampsState.NoClamps;

        /// <summary>
        /// RP-1's stable per-vehicle id, and the only thing a command addresses.
        /// A fresh one per instance, exactly as the real constructors do, so two
        /// vehicles built from the same design are distinguishable here for the
        /// same reason they are in a save.
        /// </summary>
        public string KCTPersistentID = Guid.NewGuid().ToString("N");

        /// <summary>
        /// PRIVATE on the real type, and private here on purpose: a reader that
        /// only looked at public members would find nothing, and would find
        /// nothing in the game either.
        /// </summary>
        private ROUtils.DataTypes.PersistentCompressedCraftNode ShipNodeCompressed =
            new ROUtils.DataTypes.PersistentCompressedCraftNode(empty: false);

        private double _buildRate = -1.0;

        private LaunchComplex? _lc;

        /// <summary>The complex holding this vehicle, which is where a copy of it is built.</summary>
        public LaunchComplex LC => _lc!;

        public void SetBuildRate(double rate) => _buildRate = rate;

        /// <summary>Puts this vehicle in a complex, the way RP-1's own add does.</summary>
        public void SetComplex(LaunchComplex lc) => _lc = lc;

        /// <summary>Empties the stored craft node, the state that makes a copy impossible.</summary>
        public void ClearStoredDesign() =>
            ShipNodeCompressed = new ROUtils.DataTypes.PersistentCompressedCraftNode(empty: true);

        /// <summary>
        /// A fresh vehicle carrying the same design, same complex, and a new
        /// identity. The real one copies a great deal more; what it must NOT do,
        /// and what a test needs to be able to see, is reuse the id.
        /// </summary>
        public VesselProject CreateCopy() => new VesselProject
        {
            shipName = shipName,
            launchSite = launchSite,
            Type = Type,
            humanRated = humanRated,
            cost = cost,
            mass = mass,
            buildPoints = buildPoints,
            _lc = _lc,
        };

        /// <summary>
        /// The list price. The real one computes it off the craft node when the
        /// stored figure is zero; the stored figure is what a test sets.
        /// </summary>
        public double GetTotalCost() => cost;

        /// <summary>What the complex would refuse this vehicle for, set per test.</summary>
        public List<string> FacilityRefusals = new List<string>();

        /// <summary>
        /// The real one measures mass, size, human-rating, clamps and stocked
        /// resources against the complex's stats and APPENDS a sentence per
        /// failure. The append is the part the reading depends on: a caller that
        /// only took the bool would have nothing to tell an operator.
        /// </summary>
        public bool MeetsFacilityRequirements(List<string> failedReasons)
        {
            failedReasons?.AddRange(FacilityRefusals);
            return FacilityRefusals.Count == 0;
        }
    }

    /// <summary>
    /// RP-1's static helpers, of which the build-list add is the one this
    /// Uplink invokes. Its shipped body spends BEFORE it appends and performs no
    /// affordability test of its own, and both halves of that are reproduced,
    /// because the second is the reason the handler has a currency query at all.
    /// </summary>
    public static class KCTUtilities
    {
        /// <summary>Made to throw part-way, to pin what an operator is told when it does.</summary>
        public static bool ThrowOnAdd;

        public static void Reset() => ThrowOnAdd = false;

        public static void AddVesselToBuildList(VesselProject vp, bool spendFunds)
        {
            if (spendFunds)
            {
                Funding.Instance?.AddFunds(0.0 - vp.GetTotalCost());
            }
            if (ThrowOnAdd)
            {
                throw new InvalidOperationException("the complex rejected the vehicle");
            }
            vp.LC.BuildList.Add(vp);
        }
    }

    public enum CurrencyRP0
    {
        Funds,
        Science,
        Reputation,
        Confidence,
        Time,
    }

    [Flags]
    public enum TransactionReasonsRP0 : long
    {
        None = 0L,
        VesselPurchase = 0x10L,
    }

    /// <summary>
    /// RP-1's priced-transaction query: what a purchase will ACTUALLY cost once
    /// leaders and strategies have had their say, which is why the handler asks
    /// this rather than reading the vehicle's stored cost.
    /// </summary>
    public class CurrencyModifierQueryRP0
    {
        /// <summary>
        /// What the career's modifiers do to a price. Not 1.0 in the test that
        /// matters: a handler quoting the list price instead of the charge passes
        /// every assertion at 1.0 and none at 0.5.
        /// </summary>
        public static double Multiplier = 1.0;

        /// <summary>Made to throw, to pin that an unpriceable build is refused rather than started.</summary>
        public static bool ThrowOnQuery;

        public static void Reset()
        {
            Multiplier = 1.0;
            ThrowOnQuery = false;
        }

        private readonly double _funds;

        private CurrencyModifierQueryRP0(double funds)
        {
            _funds = funds;
        }

        public static CurrencyModifierQueryRP0 RunQuery(TransactionReasonsRP0 reason, double f0, double s0, double r0)
        {
            if (ThrowOnQuery)
            {
                throw new InvalidOperationException("no currency model");
            }
            return new CurrencyModifierQueryRP0(f0 * Multiplier);
        }

        /// <summary>The delta, so a charge is NEGATIVE. The handler negates it back.</summary>
        public double GetTotal(CurrencyRP0 c, bool includeHidden = false) =>
            c == CurrencyRP0.Funds ? _funds : 0.0;

        public bool CanAfford(CurrencyRP0 c) =>
            c != CurrencyRP0.Funds || 0.0 - _funds <= (Funding.Instance?.Funds ?? 0.0);
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

        /// <summary>
        /// A property on the real type, over its own destruction ConfigNode. The
        /// node is a KSP type this assembly does not have, so the stand-in keeps
        /// the SHAPE (a read-only bool property) and takes its answer from a
        /// field a test can set.
        /// </summary>
        public bool DestroyedValue;

        public LaunchPadState State => StateValue;

        public bool IsDestroyed => DestroyedValue;
    }

    /// <summary>
    /// The construction base. <c>_buildRate</c> is PRIVATE on the real type and
    /// declared on this abstract base, so a reader that resolves it from the
    /// concrete subclass has to walk the base chain with non-public flags, exactly
    /// as it does for <c>LCOpsProject</c>. Keeping it private here is what makes
    /// this fixture able to fail.
    /// </summary>
    public abstract class ConstructionProject
    {
        public double progress;
        public double BP;
        public double cost;
        public double spentCost;
        public double spentRushCost;
        public string name = "";
        public double workRate = 1.0;

        private double _buildRate = -1.0;

        public virtual SpaceCenterFacility FacilityType => SpaceCenterFacility.LaunchPad;

        public void SetBuildRate(double rate) => _buildRate = rate;
    }

    public class FacilityUpgradeProject : ConstructionProject
    {
        public int upgradeLevel;
        public int currentLevel;
        public string id = "";

        protected SpaceCenterFacility sFacilityType;

        public override SpaceCenterFacility FacilityType => sFacilityType;

        public void SetFacility(SpaceCenterFacility facility) => sFacilityType = facility;
    }

    public class LCConstructionProject : ConstructionProject
    {
        public bool isModify;
        public Guid lcID;
        public int engineersToReadd;
    }

    public class PadConstructionProject : ConstructionProject
    {
        public Guid id = Guid.NewGuid();
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
        public List<PadConstructionProject> PadConstructions = new List<PadConstructionProject>();

        public LaunchComplexType LcTypeValue = LaunchComplexType.Pad;
        public double RateValue;
        public int MaxEngineersValue = 100;
        public bool HumanRatedValue;
        public float MassMinValue;
        public float MassMaxValue = 100f;
        public UnityEngine.Vector3 SizeMaxValue = new UnityEngine.Vector3(100f, 100f, 100f);

        public Guid ID => _id;
        public LaunchComplexType LCType => LcTypeValue;
        public double Rate => RateValue;
        public int MaxEngineers => MaxEngineersValue;
        public bool IsHumanRated => HumanRatedValue;
        public float MassMin => MassMinValue;
        public float MassMax => MassMaxValue;
        public UnityEngine.Vector3 SizeMax => SizeMaxValue;
    }

    public class LCSpaceCenter
    {
        public string KSCName = "";
        public int Engineers;
        public List<LaunchComplex> LaunchComplexes = new List<LaunchComplex>();
        public List<LCConstructionProject> LCConstructions = new List<LCConstructionProject>();
        public List<FacilityUpgradeProject> FacilityUpgrades = new List<FacilityUpgradeProject>();

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

// KSP's own facility enum, which RP-1 stores on a facility-upgrade project.
// Global-namespaced because that is where KSP declares it and where the
// production walk's enum-name read will meet it. Only the members this Uplink's
// tests name are here; the walk reads the NAME rather than the ordinal, so the
// set being partial cannot make a test agree with production by accident.
public enum SpaceCenterFacility
{
    Administration,
    AstronautComplex,
    LaunchPad,
    MissionControl,
    ResearchAndDevelopment,
    Runway,
    SpaceplaneHangar,
    TrackingStation,
    VehicleAssemblyBuilding,
}

// The one Unity type RP-1's launch-complex envelope is expressed in. Declared
// here for the same reason the RP0 stand-ins above are: the production walk
// reads x, y and z off whatever object the member hands back, and a stand-in
// with a different shape would prove the walk works against something RP-1 does
// not have. This assembly references no Unity assembly, so there is nothing for
// this to collide with.
// KSP's career balance. Global-namespaced because that is where KSP declares
// it, and present here at all for one reason: the build handler reads it ONLY to
// put the balance beside a refusal it has already decided on, so a stand-in that
// merely holds a number proves the sentence carries both figures.
public class Funding
{
    public static Funding? Instance { get; set; }

    public double Funds { get; set; }

    public void AddFunds(double delta) => Funds += delta;
}

// The craft node RP-1 stores a design in, from ROUtils. Only IsEmpty is here,
// because that is the only member read: RP-1's own copy step reaches the editor
// for a ship when the node is empty, and outside the editor there is not one, so
// emptiness is what separates a vehicle that can be copied from one that cannot.
namespace ROUtils.DataTypes
{
    public class PersistentCompressedConfigNode
    {
        private readonly bool _empty;

        public PersistentCompressedConfigNode(bool empty)
        {
            _empty = empty;
        }

        public bool IsEmpty => _empty;
    }

    public class PersistentCompressedCraftNode : PersistentCompressedConfigNode
    {
        public PersistentCompressedCraftNode(bool empty)
            : base(empty)
        {
        }
    }
}

namespace UnityEngine
{
    public struct Vector3
    {
        public float x;
        public float y;
        public float z;

        public Vector3(float x, float y, float z)
        {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }
}
