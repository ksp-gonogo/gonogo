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
        public double RushSalaryMult = 2.0;
        public double repPortionLostPerDay = 0.02;

        /// <summary>Ints on the real type, not doubles: a full year's pay per head.</summary>
        public int salaryEngineers = 1000;
        public int salaryResearchers = 1000;

        public double EngineerIdleSalaryMult = 0.25;

        /// <summary>
        /// What a second and subsequent launch pad costs, relative to the first.
        /// RP-1 ships 0.5, and it is the ONE settings value the cost model falls
        /// back to a default for rather than refusing on: it scales a price rather
        /// than deciding whether an act is legal.
        /// </summary>
        public double AdditionalPadCostMult = 0.5;
    }

    public static class Database
    {
        public static readonly SpaceCenterSettings SettingsSC = new SpaceCenterSettings();

        /// <summary>The crew half, declared in CrewFixture.cs beside the rest of RP-1's crew graph.</summary>
        public static readonly CrewSettings SettingsCrew = new CrewSettings();

        /// <summary>
        /// The era table a node's research RATE comes out of. A
        /// <c>PersistentDictionaryNodeKeyed&lt;TechPeriod&gt;</c> on the real
        /// type, which is a <c>Dictionary&lt;string, TechPeriod&gt;</c>
        /// underneath. A plain dictionary here, because the walk enumerates it
        /// as a bare IEnumerable and never names either type.
        /// </summary>
        public static readonly Dictionary<string, TechPeriod> TechNodePeriods =
            new Dictionary<string, TechPeriod>();

        /// <summary>
        /// The resource catalogue a launch complex's fluids are validated and
        /// priced against, which is the only place either answer comes from.
        /// </summary>
        public static readonly ResourceInfo ResourceInfo = new ResourceInfo();
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

        /// <summary>
        /// The complexes attached to this record. Public on the real type, and
        /// the live list rather than the persisted id list beside it.
        /// </summary>
        public List<LaunchComplex> _lcs = new List<LaunchComplex>();

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

        /// <summary>
        /// Whether the operation has finished, which is what tells a pad with a
        /// vessel ON it from a pad with a rollout still moving one: RP-1 gives two
        /// different refusals for the two, off this one test.
        /// </summary>
        public bool IsComplete() => progress >= BP;
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

        /// <summary>How many times a maintenance reschedule was asked for, which is the observable half of a reversal.</summary>
        public static int Reschedules;

        public ReconRolloutProject()
        {
        }

        /// <summary>
        /// FOUR parameters with the last defaulted, exactly as the shipped one
        /// declares them, because a reflected invoke applies no defaults and a
        /// three-parameter stand-in would let a three-argument call pass here and
        /// fail in the game.
        ///
        /// <para>The real one prices the rollout through <c>Formula</c> and
        /// spends NOTHING, which is the property the whole no-affordability-check
        /// argument rests on. Reproduced: a cost is set and no funds move.</para>
        /// </summary>
        public ReconRolloutProject(VesselProject vessel, RolloutReconType type, string id, string launchSite = "")
        {
            RRType = type;
            associatedID = id;
            launchPadID = string.IsNullOrEmpty(launchSite) ? vessel.launchSite : launchSite;
            BP = vessel.buildPoints;
            cost = vessel.GetTotalCost() * 0.1;
            if (type == RolloutReconType.Rollback || type == RolloutReconType.AirlaunchUnmount)
            {
                progress = BP;
            }
        }

        /// <summary>
        /// The shipped body: flip the direction and reschedule maintenance. Both
        /// halves are here because the reschedule is the only thing a caller can
        /// observe besides the flip, and a stand-in that only flipped would let a
        /// handler that never reached RP-1 look identical.
        /// </summary>
        public void SwitchDirection()
        {
            switch (RRType)
            {
                case RolloutReconType.Rollout:
                    RRType = RolloutReconType.Rollback;
                    break;
                case RolloutReconType.Rollback:
                    RRType = RolloutReconType.Rollout;
                    break;
                case RolloutReconType.AirlaunchMount:
                    RRType = RolloutReconType.AirlaunchUnmount;
                    break;
                case RolloutReconType.AirlaunchUnmount:
                    RRType = RolloutReconType.AirlaunchMount;
                    break;
            }
            Reschedules++;
        }
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

        private Guid _lcID;

        /// <summary>The complex holding this vehicle, which is where a copy of it is built.</summary>
        public LaunchComplex LC => _lc!;

        /// <summary>
        /// The complex a vehicle is bound to, by id, and the ONLY way RP-1's own
        /// code retargets one: its build-list add takes an override complex and
        /// assigns this, so the setter's resolve-through-the-manager step is the
        /// behaviour a caller depends on rather than an implementation detail.
        /// </summary>
        public Guid LCID
        {
            get => _lcID;
            set
            {
                _lcID = value;
                _lc = value == Guid.Empty ? null : SpaceCenterManagement.Instance?.LC(value);
            }
        }

        /// <summary>
        /// The constructor that MEASURES a craft: the only one RP-1 has that
        /// turns a loaded ship into a vehicle it will integrate, and the reason a
        /// build cannot be started from a craft file without live parts.
        ///
        /// <para>The shipped one computes mass, size, cost, effective cost, build
        /// points, part names, human rating and stage counts off the parts, and
        /// stores the craft node. Reproduced here down to the two fields a test
        /// can see: the name comes off the ship, and so does whether this is a
        /// VAB or an SPH project, which is what decides the kind of complex it
        /// can go to.</para>
        /// </summary>
        public VesselProject(ShipConstruct ship, string ls, string flagURL, bool storeConstruct)
        {
            shipName = ship?.shipName ?? "";
            launchSite = ls;
            Type = ship?.shipFacility == EditorFacility.SPH ? ProjectType.SPH : ProjectType.VAB;
            cost = ship?.totalCost ?? 0f;
            mass = ship?.totalMass ?? 0f;
            Stored = storeConstruct;
            Flag = flagURL;
            if (NextFacilityRefusals != null)
            {
                FacilityRefusals = NextFacilityRefusals;
                NextFacilityRefusals = null;
            }
        }

        public VesselProject()
        {
        }

        /// <summary>Whether the craft node was stored, which a vehicle with no design cannot be copied without.</summary>
        public bool Stored;

        /// <summary>The flag the vehicle was started under, kept so a test can see it was passed at all.</summary>
        public string? Flag;

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
        /// The refusals the NEXT measured vehicle is born with. Static because a
        /// build started from a craft file constructs the vehicle inside the
        /// handler, so a test has nowhere to set them on the instance.
        /// </summary>
        public static List<string>? NextFacilityRefusals;

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

        /// <summary>Whether this vehicle still fits a PROPOSED specification, which is what a renovation asks.</summary>
        public bool MeetsRequirements = true;

        /// <summary>
        /// The SECOND overload, and the reason both are here: RP-1 declares
        /// <c>MeetsFacilityRequirements(List&lt;string&gt;)</c> beside
        /// <c>MeetsFacilityRequirements(LCData, List&lt;string&gt;, bool = false)</c>,
        /// and the defaulted third parameter makes the second one ARITY THREE to
        /// reflection. A fixture carrying only the one-argument form let a lookup at
        /// the wrong arity resolve to nothing and a renovation's strand check never
        /// fire, which is precisely what happened.
        /// </summary>
        public bool MeetsFacilityRequirements(LCData stats, List<string>? failedReasons, bool shortReasons = false)
        {
            if (!MeetsRequirements)
            {
                failedReasons?.Add(shipName + " does not fit the proposed limits");
            }
            return MeetsRequirements;
        }

        /// <summary>
        /// A memoising property over a part scan on the real type. A vehicle
        /// whose parts an install no longer has is one RP-1 omits from its window
        /// entirely, so a command has to answer for it where the game does not.
        /// </summary>
        public bool AllPartsValid { get; set; } = true;

        /// <summary>
        /// Finished when progress has reached the build points, which is RP-1's
        /// own definition and the difference between a warehouse vehicle and a
        /// queued one.
        /// </summary>
        public bool IsFinished => progress >= buildPoints;

        /// <summary>
        /// Takes the vehicle off whichever list holds it. Returns the index it
        /// was at, as the shipped one does, and false when it was on neither.
        /// </summary>
        public bool RemoveFromBuildList(out int oldIndex)
        {
            oldIndex = _lc?.Warehouse.IndexOf(this) ?? -1;
            if (oldIndex >= 0)
            {
                _lc!.Warehouse.RemoveAt(oldIndex);
                return true;
            }
            oldIndex = _lc?.BuildList.IndexOf(this) ?? -1;
            if (oldIndex >= 0)
            {
                _lc!.BuildList.RemoveAt(oldIndex);
                return true;
            }
            return false;
        }

        /// <summary>
        /// Which pad the vehicle is bound for, by index into its complex's pads.
        /// A rollout WRITES this, and -1 is the unset value the real constructor
        /// starts it at.
        /// </summary>
        public int launchSiteIndex = -1;
    }

    /// <summary>
    /// RP-1's static helpers, of which the build-list add is the one this
    /// Uplink invokes. Its shipped body spends BEFORE it appends and performs no
    /// affordability test of its own, and both halves of that are reproduced,
    /// because the second is the reason the handler has a currency query at all.
    /// </summary>
    public static class KCTUtilities
    {
        /// <summary>
        /// What a test says finishes next, and the reason the warp commands ask it
        /// BEFORE handing anything to the warp controller: the real one returns null
        /// both when there is no active space centre and when nothing anywhere is in
        /// progress, and RP-1's own Create cannot survive either.
        /// </summary>
        public static ISpaceCenterProject? NextThing;

        /// <summary>Makes the lookup throw, which is the same as no project for a caller that only needs to know whether Create can be handed a null.</summary>
        public static bool ThrowOnNextThing;

        public static ISpaceCenterProject? GetNextThingToFinish()
        {
            if (ThrowOnNextThing)
            {
                throw new InvalidOperationException("the project queue could not be read");
            }
            return NextThing;
        }

        /// <summary>Made to throw part-way, to pin what an operator is told when it does.</summary>
        public static bool ThrowOnAdd;

        /// <summary>The same, for the scrap path, whose refund is the LAST thing it does.</summary>
        public static bool ThrowOnScrap;

        /// <summary>
        /// Every <c>ChangeEngineers</c> call, in order, as (subject, delta).
        /// Recorded rather than counted because the SUBJECT is the point: RP-1
        /// declares a same-arity overload taking a space CENTRE, and a handler
        /// that resolved by arity alone would move a centre's engineer pool while
        /// looking, from a counter, exactly correct.
        /// </summary>
        public static readonly List<KeyValuePair<object, int>> EngineerChanges = new List<KeyValuePair<object, int>>();

        /// <summary>
        /// Every tech id offered to the experimental-parts step, in order. RP-1's
        /// own body walks <c>PartLoader.LoadedPartsList</c>, which needs a loaded
        /// game; what a test can hold is that the step was reached with the id the
        /// operator named.
        /// </summary>
        public static readonly List<string> ExperimentalNodes = new List<string>();

        /// <summary>Made to throw, to pin that a failed convenience does not undo a node that IS queued.</summary>
        public static bool ThrowOnExperimental;

        /// <summary>
        /// RP-1's facility TIER: an index, unlike stock's normalised fraction,
        /// which is why RP-1 asks its own converter everywhere it gates on a
        /// building. Settable per facility so a test can put the Astronaut Complex
        /// below a training's requirement.
        /// </summary>
        public static readonly Dictionary<SpaceCenterFacility, int> FacilityLevels =
            new Dictionary<SpaceCenterFacility, int>();

        public static int GetFacilityLevel(SpaceCenterFacility facility) =>
            FacilityLevels.TryGetValue(facility, out var level) ? level : 0;

        public static void Reset()
        {
            ThrowOnAdd = false;
            ThrowOnScrap = false;
            ThrowOnExperimental = false;
            EngineerChanges.Clear();
            ExperimentalNodes.Clear();
            NextThing = null;
            ThrowOnNextThing = false;
        }

        public static void AddNodePartsToExperimental(string techID)
        {
            if (ThrowOnExperimental)
            {
                throw new InvalidOperationException("the part loader is not ready");
            }
            ExperimentalNodes.Add(techID);
        }

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

        /// <summary>
        /// The shipped body: remove, THEN refund in full. Order reproduced,
        /// because a throw between the two is the one way an operator can lose a
        /// vehicle and not be paid for it, and a handler has to say so.
        /// </summary>
        public static void ScrapVessel(VesselProject b)
        {
            b.RemoveFromBuildList(out _);
            if (ThrowOnScrap)
            {
                throw new InvalidOperationException("the refund could not be posted");
            }
            Funding.Instance?.AddFunds(b.GetTotalCost());
        }

        public static void ChangeEngineers(LaunchComplex currentLC, int delta)
        {
            EngineerChanges.Add(new KeyValuePair<object, int>(currentLC, delta));
            currentLC.Engineers += delta;
        }

        /// <summary>
        /// The overload that makes the first one findable-by-accident. Same name,
        /// same arity, entirely different subject; present here so a resolver
        /// that ignores parameter types fails in this assembly the way it would
        /// fail in the game.
        /// </summary>
        public static void ChangeEngineers(LCSpaceCenter ksc, int delta)
        {
            EngineerChanges.Add(new KeyValuePair<object, int>(ksc, delta));
            ksc.Engineers += delta;
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

        /// <summary>
        /// The six UpdateUpkeep prices its upkeep lines against. Distinct bits,
        /// as on RP-1's own flags enum, so a stand-in modifier can be aimed at
        /// one line and the other five observed not to move.
        /// </summary>
        StructureRepair = 0x20L,
        StructureRepairLC = 0x40L,
        SalaryEngineers = 0x80L,
        SalaryResearchers = 0x100L,
        SalaryCrew = 0x200L,
        CrewTraining = 0x400L,

        /// <summary>Researching a tech node, the reason RP-1's own R&D tooltip prices against.</summary>
        RnDTechResearch = 0x4000L,
    }

    /// <summary>
    /// RP-1's one-line currency query, which is what MaintenanceHandler asks per
    /// upkeep source and what its Budget tab asks per row.
    /// </summary>
    /// <remarks>
    /// Modelled AFFINE rather than as a bare multiplier, because RP-1's own is:
    /// CurrencyModifierQueryRP0.GetTotal returns
    /// <c>input * multiplier + postMultiplierDelta</c>. The offset is what makes
    /// pricing a sum different from summing two prices, and a stand-in that only
    /// multiplied would agree with either arrangement and prove neither.
    /// </remarks>
    public static class CurrencyUtils
    {
        /// <summary>Per-reason multiplier, defaulting to 1.0 for a reason nobody set.</summary>
        public static readonly Dictionary<TransactionReasonsRP0, double> Multipliers =
            new Dictionary<TransactionReasonsRP0, double>();

        /// <summary>Per-reason post-multiplier offset, in the query's own delta direction.</summary>
        public static readonly Dictionary<TransactionReasonsRP0, double> PostDeltas =
            new Dictionary<TransactionReasonsRP0, double>();

        /// <summary>Made to throw, to pin that an unaskable query costs the breakdown rather than substituting for it.</summary>
        public static bool ThrowOnQuery;

        /// <summary>Counts the broadcasts, so a change-gate that stopped gating is visible.</summary>
        public static int Queries;

        public static void Reset()
        {
            Multipliers.Clear();
            PostDeltas.Clear();
            ThrowOnQuery = false;
            Queries = 0;
        }

        public static double Funds(TransactionReasonsRP0 reason, double funds, bool includeHidden = false)
        {
            if (ThrowOnQuery)
            {
                throw new InvalidOperationException("no currency model");
            }
            Queries++;
            var multiplier = Multipliers.TryGetValue(reason, out var m) ? m : 1.0;
            var post = PostDeltas.TryGetValue(reason, out var p) ? p : 0.0;
            return funds * multiplier + post;
        }
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

        /// <summary>
        /// The science half, kept separate from <see cref="Multiplier"/> for the
        /// same reason: a research handler quoting the list price instead of the
        /// charge passes every assertion at 1.0 and none at 0.5, and the two
        /// currencies are moved by different modifiers on the real type.
        /// </summary>
        public static double ScienceMultiplier = 1.0;

        /// <summary>Made to throw, to pin that an unpriceable build is refused rather than started.</summary>
        public static bool ThrowOnQuery;

        public static void Reset()
        {
            Multiplier = 1.0;
            ScienceMultiplier = 1.0;
            ThrowOnQuery = false;
        }

        private readonly double _funds;
        private readonly double _science;

        private CurrencyModifierQueryRP0(double funds, double science)
        {
            _funds = funds;
            _science = science;
        }

        public static CurrencyModifierQueryRP0 RunQuery(TransactionReasonsRP0 reason, double f0, double s0, double r0)
        {
            if (ThrowOnQuery)
            {
                throw new InvalidOperationException("no currency model");
            }
            return new CurrencyModifierQueryRP0(f0 * Multiplier, s0 * ScienceMultiplier);
        }

        /// <summary>The delta, so a charge is NEGATIVE. The handler negates it back.</summary>
        public double GetTotal(CurrencyRP0 c, bool includeHidden = false)
        {
            switch (c)
            {
                case CurrencyRP0.Funds: return _funds;
                case CurrencyRP0.Science: return _science;
                default: return 0.0;
            }
        }

        public bool CanAfford(CurrencyRP0 c)
        {
            switch (c)
            {
                case CurrencyRP0.Funds: return 0.0 - _funds <= (Funding.Instance?.Funds ?? 0.0);
                case CurrencyRP0.Science: return 0.0 - _science <= (ResearchAndDevelopment.Instance?.Science ?? 0f);
                default: return true;
            }
        }
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

        /// <summary>The craft sitting on this pad in PRELAUNCH, if a test put one there.</summary>
        public Vessel? Waiting;

        /// <summary>
        /// The one condition <see cref="State"/> cannot see: a pad with no
        /// OPERATION on it reads Free even when a craft has already been sent to
        /// the launch site and is sitting there. The out parameter is what carries
        /// the craft's name into the refusal, and is typed here because a reader
        /// that passed the wrong arity would find nothing.
        /// </summary>
        public bool HasVesselWaitingToBeLaunched(out Vessel? v)
        {
            v = Waiting;
            return Waiting != null;
        }

        public LCLaunchPad()
        {
        }

        /// <summary>
        /// RP-1's three-argument constructor, the only way a pad is made. Arity is
        /// what production matches on, so the shape here has to be the shipped one
        /// exactly, and <c>isOperational</c> starts FALSE: a pad is under
        /// construction until its project completes.
        /// </summary>
        public LCLaunchPad(Guid id, string name, float lvl)
        {
            this.id = id;
            this.name = name;
            fractionalLevel = lvl;
            level = (int)lvl;
            isOperational = false;
        }

        /// <summary>The complex holding this pad, which a test sets when it puts the pad in one.</summary>
        public LaunchComplex? Lc;

        public LaunchComplex? LC => Lc;

        /// <summary>
        /// RP-1's own rename, INCLUDING its silent return on a duplicate name.
        /// </summary>
        /// <remarks>
        /// Reproduced rather than corrected, and this is the fixture's single most
        /// load-bearing detail: the shipped method returns having done nothing when
        /// another pad at the complex has that name, and the rename window that
        /// calls it reports nothing at all. The command exists to convert that into
        /// a refusal, so a fixture that renamed unconditionally would let a command
        /// that reported a silent no-op as success pass every test.
        /// </remarks>
        public void Rename(string newName)
        {
            var lc = LC;
            if (lc == null)
            {
                return;
            }
            foreach (var sibling in lc.LaunchPads)
            {
                if (string.Equals(sibling.name, newName, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
            foreach (var operation in lc.Recon_Rollout)
            {
                if (operation.launchPadID == name)
                {
                    operation.launchPadID = newName;
                }
            }
            foreach (var construction in lc.PadConstructions)
            {
                if (construction.id == id)
                {
                    construction.name = newName;
                }
            }
            name = newName;
        }

        /// <summary>
        /// RP-1's own delete, with its three refusals and its out-reason, and with
        /// the launch-site index shift the removal causes.
        /// </summary>
        /// <remarks>
        /// The index shift is reproduced because it is the reason the complex
        /// dismantle removes pads LAST FIRST: every vessel pointing past the
        /// removed pad has its index decremented, so a forward walk would shift the
        /// same indices repeatedly. A fixture without it would let that ordering
        /// bug pass.
        /// </remarks>
        public bool Delete(out string? failReason)
        {
            if (HasVesselWaitingToBeLaunched(out var waiting))
            {
                failReason = "vessel " + waiting!.vesselName + " is currently waiting on the launch pad";
                return false;
            }

            var lc = LC;
            if (lc == null)
            {
                failReason = null;
                return true;
            }

            foreach (var operation in lc.Recon_Rollout)
            {
                if (operation.launchPadID == name && operation.RRType != ReconRolloutProject.RolloutReconType.Reconditioning)
                {
                    failReason = operation.IsComplete() ? "a vessel is currently on the pad" : "pad has ongoing rollout";
                    return false;
                }
            }

            foreach (var construction in lc.PadConstructions)
            {
                if (construction.id == id)
                {
                    failReason = "pad is under construction";
                    return false;
                }
            }

            var index = lc.LaunchPads.IndexOf(this);
            if (index >= 0)
            {
                foreach (var vessel in lc.Warehouse)
                {
                    if (vessel.launchSiteIndex >= index)
                    {
                        vessel.launchSiteIndex--;
                    }
                }
                foreach (var vessel in lc.BuildList)
                {
                    if (vessel.launchSiteIndex >= index)
                    {
                        vessel.launchSiteIndex--;
                    }
                }
                lc.LaunchPads.RemoveAt(index);
            }

            failReason = null;
            return true;
        }
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

        /// <summary>
        /// The call that turns a price into a build duration. The real body is
        /// <c>BP = Formula.GetConstructionBP(cost, oldCost, FacilityType)</c>,
        /// which is RP-1's own curve and is deliberately NOT reproduced: what a
        /// test can assert is that BOTH arguments reached it and which they were,
        /// so the sum below is only a deterministic function of the two and
        /// carries no claim about RP-1's arithmetic.
        /// </summary>
        public void SetBP(double cost, double oldCost)
        {
            BpCostArgument = cost;
            BpOldCostArgument = oldCost;
            BpCalls++;
            BP = cost + oldCost;
        }

        /// <summary>The price <see cref="SetBP"/> was given, for a test to check against the facility's own.</summary>
        public double? BpCostArgument;

        /// <summary>The cumulative prior cost <see cref="SetBP"/> was given, which is the half nothing else on the wire would reveal.</summary>
        public double? BpOldCostArgument;

        /// <summary>How many times the duration was set, so a test can pin RP-1's order rather than only its inputs.</summary>
        public int BpCalls;
    }

    public class FacilityUpgradeProject : ConstructionProject
    {
        public int upgradeLevel;
        public int currentLevel;
        public string id = "";

        protected SpaceCenterFacility sFacilityType;

        public override SpaceCenterFacility FacilityType => sFacilityType;

        public FacilityUpgradeProject()
        {
        }

        /// <summary>
        /// RP-1's five-argument constructor, which is the only way a facility
        /// upgrade is made. Arity is what production matches on, so the shape
        /// here has to be the shipped one exactly.
        /// </summary>
        public FacilityUpgradeProject(SpaceCenterFacility type, string facilityID, int newLevel, int oldLevel, string name)
        {
            sFacilityType = type;
            id = facilityID;
            upgradeLevel = newLevel;
            currentLevel = oldLevel;
            base.name = name;
        }

        public void SetFacility(SpaceCenterFacility facility) => sFacilityType = facility;

        /// <summary>
        /// RP-1's own duplicate guard, and it searches EVERY centre rather than
        /// the active one. Reproduced with that reach on purpose: a per-centre
        /// stand-in would let a test pass while production queued a second entry
        /// for a facility already being upgraded at another KSC.
        /// </summary>
        public static bool AlreadyInProgressByID(string id)
        {
            var scm = SpaceCenterManagement.Instance;
            if (scm == null)
            {
                return false;
            }
            foreach (var ksc in scm.KSCs)
            {
                foreach (var project in ksc.FacilityUpgrades)
                {
                    if (project.id == id)
                    {
                        return true;
                    }
                }
            }
            return false;
        }
    }

    public class LCConstructionProject : ConstructionProject
    {
        public bool isModify;
        public Guid lcID;
        public int engineersToReadd;

        /// <summary>
        /// A fresh Guid per renovation on the real type, and the complex's own
        /// ModID for a build. What RP-1 stamps a specification's generation with,
        /// so a vehicle integrated under the old limits can be told apart.
        /// </summary>
        public Guid modId;

        /// <summary>
        /// The specification the complex becomes when the project completes. A
        /// COPY on the real type, made through <c>SetFrom</c>: a project holding
        /// the caller's own object would change under it.
        /// </summary>
        public LCData lcData = new LCData();
    }

    public class PadConstructionProject : ConstructionProject
    {
        public Guid id = Guid.NewGuid();
    }

    /// <summary>
    /// RP-1's queued tech node. The seven <c>[Persistent]</c> fields are the
    /// checklist the research command's whole route stands on, and they carry the
    /// attribute here for the same reason the real ones do: the stand-in
    /// <c>ConfigNode.LoadObjectFromConfig</c> is driven by it, so a key
    /// production forgets to author leaves its field at the constructor's default
    /// exactly as the shipped game would.
    /// </summary>
    public class ResearchProject
    {
        [Persistent]
        public int scienceCost;

        [Persistent]
        public int startYear;

        [Persistent]
        public int endYear;

        [Persistent]
        public string techName = "";

        [Persistent]
        public string techID = "";

        [Persistent]
        public double progress;

        [Persistent]
        public double workRate = 1.0;

        public ProtoTechNode? ProtoNode;

        private double _buildRate = -1.0;

        /// <summary>The index UpdateBuildRate was last called with, or absent if it never was.</summary>
        public int? BuildRateIndex { get; private set; }

        public void SetBuildRate(double rate) => _buildRate = rate;

        /// <summary>RP-1's own two lines, unchanged: the object loader, then the proto node.</summary>
        public void Load(ConfigNode node)
        {
            ConfigNode.LoadObjectFromConfig(this, node);
            ProtoNode = new ProtoTechNode(node.GetNode("ProtoNode")!);
        }

        /// <summary>
        /// Records the index rather than reproducing RP-1's rate formula, which
        /// reaches a preset, a leader table and Planetarium: what a test can
        /// meaningfully hold is that the queue POSITION handed over is the one
        /// the node landed at, because that is the argument production computes.
        /// </summary>
        public double UpdateBuildRate(int index)
        {
            BuildRateIndex = index;
            _buildRate = 1.0;
            return _buildRate;
        }
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
        /// <summary>Observable, for the reason <see cref="LCSpaceCenter.LCConstructions"/> is.</summary>
        public ROUtils.DataTypes.PersistentObservableList<PadConstructionProject> PadConstructions =
            new ROUtils.DataTypes.PersistentObservableList<PadConstructionProject>();

        public LaunchComplexType LcTypeValue = LaunchComplexType.Pad;
        public double RateValue;
        public int MaxEngineersValue = 100;
        public bool HumanRatedValue;
        public float MassMinValue;
        public float MassMaxValue = 100f;

        /// <summary>
        /// The tonnage the complex was built at. Defaulted to the same figure as
        /// <see cref="MassMaxValue"/>, which is the state RP-1 leaves a complex
        /// in until somebody renovates it.
        /// </summary>
        public float MassOrigValue = 100f;
        public UnityEngine.Vector3 SizeMaxValue = new UnityEngine.Vector3(100f, 100f, 100f);

        /// <summary>
        /// The owning centre. A private <c>_ksc</c> behind a public property on
        /// the real type, set by RP-1's own constructor; a fixture that puts a
        /// complex in a centre's list has to set it too, and the assignment
        /// command is what reads it (it needs the centre's unassigned pool).
        /// </summary>
        public LCSpaceCenter? Ksc;

        public Dictionary<string, double> ResourcesHandledValue = new Dictionary<string, double>();

        public Guid ID => _id;
        public LaunchComplexType LCType => LcTypeValue;
        public double Rate => RateValue;
        public int MaxEngineers => MaxEngineersValue;
        public bool IsHumanRated => HumanRatedValue;
        public float MassMin => MassMinValue;
        public float MassMax => MassMaxValue;
        public float MassOrig => MassOrigValue;

        /// <summary>
        /// Derived on the real type, and derived here for the same reason the
        /// walk reads it rather than counting <see cref="LaunchPads"/> itself:
        /// the answer is the OPERATIONAL pads, which is not the list's length.
        /// </summary>
        public int LaunchPadCount
        {
            get
            {
                var count = 0;
                foreach (var pad in LaunchPads)
                {
                    if (pad.isOperational)
                    {
                        count++;
                    }
                }
                return count;
            }
        }
        public UnityEngine.Vector3 SizeMax => SizeMaxValue;
        public LCSpaceCenter? KSC => Ksc;
        public Dictionary<string, double> ResourcesHandled => ResourcesHandledValue;

        /// <summary>Mirrors the real property, which returns 1.0 unless the complex is rushing.</summary>
        public double RushSalary => IsRushing ? Database.SettingsSC.RushSalaryMult : 1.0;

        /// <summary>
        /// The complex's persisted specification, which is where every price and
        /// every limit comes from.
        /// </summary>
        /// <remarks>
        /// A field behind a property on the real type, and the source of truth for
        /// the four figures the fields above also expose. Kept in SYNC by
        /// <see cref="SyncFromStats"/> rather than derived, because the real type
        /// carries both and a fixture where the two could disagree would let a
        /// reader that used the wrong one pass.
        /// </remarks>
        public LCData StatsValue = new LCData();

        public LCData Stats => StatsValue;

        private Guid _modId = Guid.NewGuid();

        /// <summary>The generation of specification vehicles here were integrated under.</summary>
        public Guid ModID => _modId;

        public LaunchComplex()
        {
        }

        /// <summary>
        /// RP-1's two-argument constructor, the only way a complex is made. It
        /// copies the specification rather than holding the caller's object, takes
        /// the name off it, and does NOT set IsOperational: a complex is under
        /// construction until its project completes.
        /// </summary>
        public LaunchComplex(LCData lcData, LCSpaceCenter ksc)
        {
            StatsValue = new LCData(lcData);
            Name = lcData.Name ?? string.Empty;
            Ksc = ksc;
            IsOperational = false;
            SyncFromStats();
            SpaceCenterManagement.Instance?.RegisterLC(this);
        }

        /// <summary>
        /// Brings the convenience fields into line with <see cref="StatsValue"/>,
        /// which is what the real type gets for free by deriving them.
        /// </summary>
        public void SyncFromStats()
        {
            MassMaxValue = StatsValue.massMax;
            MassOrigValue = StatsValue.massOrig;
            MassMinValue = StatsValue.MassMin;
            SizeMaxValue = StatsValue.sizeMax;
            HumanRatedValue = StatsValue.isHumanRated;
            LcTypeValue = StatsValue.lcType;
            ResourcesHandledValue = StatsValue.resourcesHandled;
        }

        /// <summary>
        /// Whether nothing is going on here at all, which is the ONE gate a
        /// dismantle turns on.
        /// </summary>
        /// <remarks>
        /// DERIVED from the same four lists the real property reads, deliberately,
        /// rather than exposed as a settable bool. A fixture that let a test set
        /// this could set it inconsistently with the state the test built, and the
        /// property that makes a dismantle test meaningful is that the refusal and
        /// the reason come from the same place.
        ///
        /// <para>The warehouse condition is the one that matters most and the one
        /// our own spec had wrong: RP-1 will not dismantle a complex that holds a
        /// finished vehicle, which makes its own warehouse-scrapping loop
        /// unreachable.</para>
        /// </remarks>
        public bool CanModifyButton
        {
            get
            {
                if (BuildList.Count != 0 || Warehouse.Count != 0)
                {
                    return false;
                }
                foreach (var operation in Recon_Rollout)
                {
                    if (operation.RRType != ReconRolloutProject.RolloutReconType.Reconditioning)
                    {
                        return false;
                    }
                }
                return VesselRepairs.Count == 0;
            }
        }

        public bool CanDismantle => CanModifyButton;

        /// <summary>
        /// The weaker gate a RENOVATION turns on: it permits a complex with
        /// vehicles in it and only refuses one with an operation moving a vehicle.
        /// </summary>
        public bool CanModifyReal
        {
            get
            {
                foreach (var operation in Recon_Rollout)
                {
                    if (operation.RRType != ReconRolloutProject.RolloutReconType.Reconditioning)
                    {
                        return false;
                    }
                }
                return VesselRepairs.Count == 0;
            }
        }

        /// <summary>
        /// RP-1's own rename, which validates NOTHING: it writes the name in two
        /// places and stops. Reproduced without a duplicate check, because the
        /// command's duplicate refusal is ours and a fixture that checked would
        /// make it untestable.
        /// </summary>
        public void Rename(string newName)
        {
            Name = newName;
            StatsValue.Name = newName;
        }

        /// <summary>Applies a new specification, which is what a completed renovation does.</summary>
        public void Modify(LCData data, Guid modId)
        {
            _modId = modId;
            StatsValue.SetFrom(data);
            SyncFromStats();
            if (StatsValue.lcType == LaunchComplexType.Pad)
            {
                var level = StatsValue.GetPadFracLevel();
                foreach (var pad in LaunchPads)
                {
                    pad.fractionalLevel = level;
                    pad.level = (int)level;
                }
            }
        }

        /// <summary>
        /// RP-1's own delete, in the four things it does that matter here: it drops
        /// the complex's efficiency contribution, CLEARS a staff target that named
        /// it, unregisters its pads, and removes it from its centre.
        /// </summary>
        /// <remarks>
        /// The efficiency drop is the one a test needs to be able to see, because
        /// it is the loss RP-1's own dialog names nowhere: removing the last
        /// complex from a group clears the group, and the earned figure is gone for
        /// good.
        /// </remarks>
        public void Delete()
        {
            var scm = SpaceCenterManagement.Instance;
            if (scm != null && scm.LCToEfficiency.TryGetValue(this, out var efficiency))
            {
                efficiency._lcs.Remove(this);
                scm.LCToEfficiency.Remove(this);
                if (efficiency._lcs.Count == 0)
                {
                    scm.ClearedEfficiencyRecords++;
                }
            }

            if (scm != null && scm.staffTarget.LCID == ID)
            {
                scm.staffTarget.Clear();
            }

            var ksc = Ksc;
            if (ksc != null)
            {
                var index = ksc.LaunchComplexes.IndexOf(this);
                if (index >= 0)
                {
                    ksc.LaunchComplexes.RemoveAt(index);
                    if (ksc.LCIndex >= index)
                    {
                        ksc.LCIndex--;
                    }
                }
            }
        }

        /// <summary>
        /// The engineers a specification can hold.
        /// </summary>
        /// <remarks>
        /// NOT RP-1's curve. The cost model only passes this answer through, so a
        /// deterministic stand-in carries no claim about the shipped arithmetic
        /// while still proving the three arguments reached it in the right order.
        /// Resolved by first-parameter TYPE in production, which is why the float
        /// comes first here.
        /// </remarks>
        public static int MaxEngineersCalc(float massMax, UnityEngine.Vector3 sizeMax, bool isHuman) =>
            (int)Math.Max(1.0, Math.Floor(massMax / 10.0)) * (isHuman ? 2 : 1);
    }

    /// <summary>
    /// RP-1's shim over KSCSwitcher, which is where a space centre's DISPLAY name
    /// comes from: RP-1 itself keeps only the id.
    /// </summary>
    /// <remarks>
    /// The real method returns null outright when KSCSwitcher is not installed,
    /// and substitutes a site's id when it declares no display name. Both are
    /// reproduced, because both are conditions the walk has to answer absent for
    /// rather than pass through.
    /// </remarks>
    public static class KSCSwitcherInterop
    {
        /// <summary>Null is KSCSwitcher absent, which is a whole class of RP-1 career.</summary>
        public static List<(string id, string displayName)>? Sites;

        public static List<(string id, string displayName)>? GetAvailableSites() => Sites;
    }

    public class LCSpaceCenter
    {
        public string KSCName = "";
        public int Engineers;

        /// <summary>
        /// Which complex the game's own view is on. Present because a dismantle has
        /// to move it off the complex it is about to remove, and because
        /// <c>Delete</c> shifts it.
        /// </summary>
        public int LCIndex;

        /// <summary>How many times the selection was switched away, so a test can pin that it was and BEFORE the delete.</summary>
        public int SwitchAwayCalls;

        /// <summary>
        /// RP-1's own selection switch. ARITY ONE, not zero: the parameter is
        /// optional in C# and reflection applies no defaults, so a production
        /// invoke has to pass it and a fixture declaring the zero-argument form
        /// would let a broken lookup pass.
        /// </summary>
        public void SwitchToPrevLaunchComplex(bool padOnly = false)
        {
            SwitchAwayCalls++;
            if (LaunchComplexes.Count >= 2 && LCIndex > 0)
            {
                LCIndex--;
            }
        }
        public List<LaunchComplex> LaunchComplexes = new List<LaunchComplex>();
        /// <summary>
        /// A <c>PersistentObservableList</c> rather than a plain list, and that is
        /// the whole point of it: its <c>Add</c> SHADOWS <c>List&lt;T&gt;.Add</c>
        /// and fires the events RP-1's own UI listens on, so a handler that bound
        /// to the base overload would queue the project and tell nobody while a
        /// count-based assertion agreed with it completely.
        /// </summary>
        public ROUtils.DataTypes.PersistentObservableList<LCConstructionProject> LCConstructions =
            new ROUtils.DataTypes.PersistentObservableList<LCConstructionProject>();
        public List<FacilityUpgradeProject> FacilityUpgrades = new List<FacilityUpgradeProject>();

        public string? GroundStation;

        public string? AssociatedGroundStation => GroundStation;

        /// <summary>
        /// DERIVED on the real type, exactly as here: hired minus the sum of what
        /// the complexes hold. So assigning a complex a crew moves this without
        /// anything writing to it, which is why the assignment command reads it
        /// again after every change rather than tracking a pool of its own.
        /// </summary>
        public int UnassignedEngineers
        {
            get
            {
                var assigned = 0;
                foreach (var lc in LaunchComplexes)
                {
                    assigned += lc.Engineers;
                }
                return Engineers - assigned;
            }
        }
    }

    /// <summary>
    /// The standing hire instruction, carrying RP-1's own definitions rather than
    /// convenient ones: <c>IsValid</c> is a positive headcount, and the kind of
    /// staff is inferred from whether a complex is named rather than stored.
    ///
    /// <para>NO <c>GetFractionComplete</c>. RP-1 has one and it divides two ints
    /// before widening, so it reads zero until the last hire lands; leaving it out
    /// here keeps a test from ever asserting on the broken shape.</para>
    /// </summary>
    public class HireStaffProject
    {
        public int targetCrewCount;
        public int CurrentAmount { get; set; }
        public Guid LCID { get; set; } = Guid.Empty;

        /// <summary>What the estimate answers, so a test can tell it was called.</summary>
        public double TimeLeft { get; set; }

        public bool IsValid => targetCrewCount > 0;

        public bool IsResearch => LCID == Guid.Empty;

        public int NumLeftToHire => targetCrewCount - CurrentAmount;

        public double GetTimeLeft() => TimeLeft;

        /// <summary>
        /// Withdraws the instruction, which is what RP-1 does silently when the
        /// complex it named is renovated or dismantled: the order stops existing
        /// and nothing on screen says so. The value being readable is what lets an
        /// operator watch it go rather than believe in a schedule that has
        /// stopped.
        /// </summary>
        public void Clear()
        {
            targetCrewCount = 0;
            CurrentAmount = 0;
            LCID = Guid.Empty;
        }
    }

    /// <summary>
    /// The warp's fund stop-condition. Its two figures are PRIVATE exactly as
    /// RP-1 declares them, so a test that reads them proves the production walk
    /// reaches a non-public field rather than proving a convenient fixture.
    /// </summary>
    public class FundTargetProject : ISpaceCenterProject
    {
        private double targetFunds;
        private double origFunds;

        public double TimeLeft { get; set; }

        /// <summary>
        /// RP-1's own rule, and not simply "non-zero": a figure equal to the
        /// balance it was set at is no target at all.
        /// </summary>
        public bool IsValid => targetFunds != origFunds && targetFunds > 0.0;

        public void Set(double target, double original)
        {
            targetFunds = target;
            origFunds = original;
        }

        public FundTargetProject()
        {
        }

        /// <summary>
        /// A standing target, as RP-1's own set command makes one. The original
        /// balance is a parameter here where the real type reads it off Funding,
        /// because this assembly has no Funding and the pair is what IsValid turns
        /// on.
        /// </summary>
        public FundTargetProject(double target, double origFunds)
        {
            targetFunds = target;
            this.origFunds = origFunds;
        }

        public double GetTimeLeft() => TimeLeft;

        /// <summary>
        /// What RP-1 calls a fund target, and the reason this type implements the
        /// project interface at all: RP-1 puts the fund target in its own project
        /// list beside the rockets, so warping to it is the same call rather than a
        /// separate mechanism.
        /// </summary>
        public string GetItemName() => $"Fund Target: {targetFunds:N0}";

        /// <summary>Reached when the target is no longer a standing instruction.</summary>
        public bool IsComplete() => !IsValid;
    }

    public class SpaceCenterManagement
    {
        /// <summary>
        /// RP-1's cached Tool-All total for the ship in the editor, kept current by
        /// its own editor-ship-modified handler. STATIC, as the real one is.
        ///
        /// <para>The reading takes this rather than asking RP-1's window to price
        /// the ship, because the window prices by performing every purchase for
        /// real and rolling the database back.</para>
        /// </summary>
        public static double EditorToolingCosts;

        public static SpaceCenterManagement? Instance { get; set; }

        public bool enabledForSave = true;
        public int Researchers;
        public int Applicants;

        /// <summary>
        /// RP-1's first-run flag, set the moment a career's first complex is
        /// queued. Present because the build command has to set it: RP-1 gates its
        /// own start-up tutorial on it, and a career whose first complex was
        /// ordered from here would otherwise still be told to order one.
        /// </summary>
        public bool StarterLCBuilding;

        /// <summary>Every complex registered, so a test can pin that the constructor did.</summary>
        public List<LaunchComplex> RegisteredComplexes = new List<LaunchComplex>();

        /// <summary>
        /// How many efficiency records were CLEARED by a dismantle, which is the
        /// permanent loss RP-1's own dialog names nowhere.
        /// </summary>
        public int ClearedEfficiencyRecords;

        public void RegisterLC(LaunchComplex lc) => RegisteredComplexes.Add(lc);

        /// <summary>Always present, exactly as RP-1 constructs it; validity is the question, not existence.</summary>
        public HireStaffProject staffTarget = new HireStaffProject();

        public FundTargetProject fundTarget = new FundTargetProject();
        public LCSpaceCenter? ActiveSC;
        public List<LCSpaceCenter> KSCs = new List<LCSpaceCenter>();

        /// <summary>
        /// A <c>PersistentObservableList</c> rather than a plain list, and that
        /// is the whole point of it: its <c>Add</c> SHADOWS <c>List&lt;T&gt;.Add</c>
        /// and fires the events RP-1's own UI listens on, so a handler that bound
        /// to the base overload would queue the node and tell nobody while a
        /// count-based assertion agreed with it completely.
        /// </summary>
        public ROUtils.DataTypes.PersistentObservableList<ResearchProject> TechList =
            new ROUtils.DataTypes.PersistentObservableList<ResearchProject>();

        /// <summary>RP-1's own membership test, over the queue's stored tech ids.</summary>
        public bool TechListHas(string techID) => TechListIndex(techID) != -1;

        public int TechListIndex(string techID)
        {
            var count = TechList.Count;
            while (count-- > 0)
            {
                if (TechList[count].techID == techID)
                {
                    return count;
                }
            }
            return -1;
        }
        public Dictionary<LaunchComplex, LCEfficiency> LCToEfficiency = new Dictionary<LaunchComplex, LCEfficiency>();

        /// <summary>
        /// Lifetime science points, the input RP-1 prices a confidence award
        /// from (<c>scienceToConfidence.Evaluate(Math.Max(0, SciPointsTotal))</c>).
        /// A public double field on the real type, and moved at earn time by
        /// <c>KCTUtilities.ProcessSciPointTotalChange</c> off an
        /// <c>OnCurrencyModified</c> handler with no reason filter at all, which
        /// makes it the second quantity derived from a neutralised science change.
        /// </summary>
        public double SciPointsTotal;

        /// <summary>
        /// A complex's effective engineer count for salary: assigned heads at the
        /// rush multiplier. The real body has three more branches (an idle
        /// complex, a hangar, a human-rated complex building an uncrewed vehicle),
        /// and none of them is what this fixture is for: what the walk has to get
        /// right is which OVERLOAD it called.
        /// </summary>
        public double GetEffectiveEngineersForSalary(LaunchComplex lc) =>
            lc.Engineers * lc.RushSalary;

        /// <summary>
        /// A centre's: its complexes' effective counts, plus its unassigned pool
        /// at the idle fraction. That last term is the one an operator cannot
        /// derive from the complexes, and the reason an idle pool is a cost.
        /// </summary>
        public double GetEffectiveIntegrationEngineersForSalary(LCSpaceCenter ksc)
        {
            var total = 0.0;
            foreach (var lc in ksc.LaunchComplexes)
            {
                total += GetEffectiveEngineersForSalary(lc);
            }
            return total + ksc.UnassignedEngineers * Database.SettingsSC.EngineerIdleSalaryMult;
        }

        /// <summary>
        /// The overload that makes the complex one findable by accident: same
        /// name, same arity, a whole centre's payroll instead of one complex's.
        /// Present so a resolver ignoring parameter types is wrong HERE too.
        /// </summary>
        public double GetEffectiveEngineersForSalary(LCSpaceCenter ksc) =>
            GetEffectiveIntegrationEngineersForSalary(ksc);
        /// The complex with this id, across every centre, or null. RP-1's own
        /// lookup and the one its <c>LCID</c> setter resolves through, which is
        /// why binding a vehicle to a complex needs the manager to be live.
        /// </summary>
        public LaunchComplex? LC(Guid id)
        {
            foreach (var centre in KSCs)
            {
                foreach (var lc in centre.LaunchComplexes)
                {
                    if (lc.ID == id)
                    {
                        return lc;
                    }
                }
            }
            return null;
        }
    }

    /// <summary>
    /// RP-1's confidence balance. The two fields are private doubles on the real
    /// type, both <c>[KSPField(isPersistant = true)]</c>, and there is no public
    /// way to lower <c>confidenceEarned</c> at all: <c>AddConfidence</c> ratchets
    /// it on a positive delta only and <c>SetConfidence</c> does not touch it.
    /// That is why the withholder writes both by reflection.
    /// </summary>
    public class Confidence
    {
        public static Confidence? Instance { get; set; }

        /// <summary>
        /// The real type's push channel to its own UI. Static, and its ONLY
        /// subscriber in the shipped assembly is <c>ConfidenceWidget</c>, whose
        /// handler assigns the number straight into a text label. So the label
        /// changes on this event and on nothing else, and a balance put back
        /// without firing it leaves the leaked figure on the operator's screen.
        /// </summary>
        public static EventData<double, TransactionReasons> OnConfidenceChanged =
            new EventData<double, TransactionReasons>("OnConfidenceChanged");

        private double confidence;
        private double confidenceEarned;

        public Confidence(double current, double earned)
        {
            confidence = current;
            confidenceEarned = earned;
        }

        public double Current => confidence;

        public double Earned => confidenceEarned;

        /// <summary>
        /// <c>OnCurrenciesModified</c>'s arithmetic, verbatim from the shipped
        /// assembly: bank the award, fire the widget's event when the number
        /// moved, and ratchet the lifetime total on an increase only. This is the
        /// step that happens BEFORE the interceptor's neutralise gets a look in,
        /// which is the whole defect.
        /// </summary>
        public void AwardForScience(double award)
        {
            var before = confidence;
            confidence += award;
            if (confidence < 0.0)
            {
                confidence = 0.0;
            }
            if (confidence == before)
            {
                return;
            }
            var delta = confidence - before;
            OnConfidenceChanged.Fire(confidence, TransactionReasons.None);
            if (delta > 0.0)
            {
                confidenceEarned += delta;
            }
        }

        /// <summary>A career spend, so a test can put a real withdrawal between an observation and a withhold.</summary>
        public void Spend(double amount)
        {
            confidence -= amount;
            OnConfidenceChanged.Fire(confidence, TransactionReasons.None);
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

        /// <summary>
        /// How many times RP-1 was told its upkeep is stale. Training is a per-day
        /// charge rather than a purchase, so a course that started or ended without
        /// this leaves RP-1 quoting the old payroll until its own hourly timer.
        /// </summary>
        public int UpkeepUpdatesScheduled;

        public void ScheduleMaintenanceUpdate() => UpkeepUpdatesScheduled++;

        public double FacilityUpkeepValue;
        public double IntegrationSalaryValue;

        public double FacilityUpkeepPerDay => FacilityUpkeepValue;
        public double IntegrationSalaryPerDay => IntegrationSalaryValue;

        /// <summary>
        /// RP-1's own derivation of <see cref="UpkeepPerDayForDisplay"/>, copied
        /// line for line out of the shipped UpdateUpkeep so a test can assert that
        /// our parts add up to it rather than to a total the test itself chose.
        /// </summary>
        /// <remarks>
        /// The crew line is ONE query on base + in-flight here, because that is
        /// what UpdateUpkeep does. Our breakdown prices the two separately,
        /// matching RP-1's own Budget tab, so the two arrangements agree exactly
        /// while the SalaryCrew modifier is a pure multiplier and differ by one
        /// copy of a post-multiplier delta otherwise. Nothing in RP-1's leader
        /// model produces one; the stand-in can, so the difference is a thing a
        /// test can state rather than a thing that surprises someone later.
        /// </remarks>
        public void UpdateUpkeep()
        {
            UpkeepPerDayForDisplay =
                CurrencyUtils.Funds(TransactionReasonsRP0.StructureRepair, -FacilityUpkeepPerDay)
                + CurrencyUtils.Funds(TransactionReasonsRP0.StructureRepairLC, -LCsCostPerDay)
                + CurrencyUtils.Funds(TransactionReasonsRP0.SalaryEngineers, -IntegrationSalaryPerDay)
                + CurrencyUtils.Funds(TransactionReasonsRP0.SalaryResearchers, -ResearchSalaryPerDay)
                + CurrencyUtils.Funds(TransactionReasonsRP0.SalaryCrew, -NautBaseUpkeepPerDay - NautInFlightUpkeepPerDay)
                + CurrencyUtils.Funds(TransactionReasonsRP0.CrewTraining, -TrainingUpkeepPerDay);
        }

        /// <summary>Keyed by complex, so a test can price two complexes differently.</summary>
        public readonly Dictionary<LaunchComplex, double> LcUpkeepValues = new Dictionary<LaunchComplex, double>();

        /// <summary>What a complex the test did not price costs.</summary>
        public double DefaultLcUpkeep;

        public double LCUpkeep(LaunchComplex lc) =>
            LcUpkeepValues.TryGetValue(lc, out var cost) ? cost : DefaultLcUpkeep;

        /// <summary>
        /// The arity-2 overload, PRIVATE on the real type as it is here, so a
        /// lookup by public name and arity finds the one above and only the one
        /// above.
        /// </summary>
        private double LCUpkeep(LaunchComplex lc, int padCount) => 0.0;

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

// KSP's craft. Global-namespaced because that is where KSP declares it, and
// present here for one member: a pad hands back the vessel already sitting on it
// so a refusal can name it, and a refusal that said "a vessel" where it could
// have said "Atlas" is the difference between an operator knowing what to move
// and going to look.
public class Vessel
{
    public string vesselName = "";
}

// KSP's loaded craft, which the craft catalogue hands an Uplink as an opaque
// handle. Global-namespaced for the same reason the rest are, and present with
// the two fields RP-1's own vehicle constructor reads off it: the ship's name
// and which editor drew it, the second of which decides whether the vehicle is
// integrated at a launch complex or at the hangar.
//
// The Uplink never names this type. It appears here because the stand-in
// VesselProject constructor has to read the same two fields the shipped one
// reads, or a test would prove a constructor call that carries nothing.
public class ShipConstruct
{
    /// <summary>
    /// The parts on the editor's table, which is what the tooling reading walks.
    /// Empty on every craft-catalogue test and populated only by the tooling ones:
    /// a ship with no parts has no tooling, which is a real state.
    /// </summary>
    public List<Part> Parts { get; } = new List<Part>();

    public string shipName = "";

    public EditorFacility shipFacility = EditorFacility.VAB;

    // The measurements RP-1's constructor takes off the parts, standing in for
    // the part walk itself. Here as plain numbers because what a test needs to
    // see is that the vehicle CARRIES a cost and a mass it did not have before
    // the craft was loaded: a build priced at zero is the shape of a handler
    // that built its vehicle from nothing and charged the career accordingly.
    public float totalCost;

    public float totalMass;
}

// KSP's editor enum, as the craft file records it. Global-namespaced like the
// rest; the ordinals are KSP's own, because the catalogue's wire form is the
// ordinal and a renumbering here would make a test agree with nothing.
public enum EditorFacility
{
    None = 0,
    VAB = 1,
    SPH = 2,
}

// The craft node RP-1 stores a design in, from ROUtils. Only IsEmpty is here,
// because that is the only member read: RP-1's own copy step reaches the editor
// for a ship when the node is empty, and outside the editor there is not one, so
// emptiness is what separates a vehicle that can be copied from one that cannot.
namespace ROUtils.DataTypes
{
    /// <summary>
    /// RP-1's observable list, and the only member of it that matters here: an
    /// <c>Add</c> declared <c>new</c> over <c>List&lt;T&gt;.Add</c>, which fires
    /// the events its own UI listens on. Both overloads are public and take one
    /// argument, so a name-and-arity lookup can bind to either, and binding to
    /// the base one queues the item and notifies nobody.
    /// </summary>
    public class PersistentObservableList<T> : System.Collections.Generic.List<T>
    {
        /// <summary>Every item that went in through the SHADOWING Add, in order.</summary>
        public System.Collections.Generic.List<T> Observed { get; } = new System.Collections.Generic.List<T>();

        /// <summary>Made to throw, to pin what an operator is told when the queue refuses a node already paid for.</summary>
        public bool ThrowOnAdd;

        public new void Add(T item)
        {
            if (ThrowOnAdd)
            {
                throw new System.InvalidOperationException("the research queue rejected the node");
            }
            base.Add(item);
            Observed.Add(item);
        }
    }

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

        /// <summary>
        /// The squared length, which is what RP-1 prices a complex's integration
        /// half off. Squared rather than the length, exactly as the shipped formula
        /// uses it: taking a root here would make every size cost differently.
        /// </summary>
        public float sqrMagnitude => x * x + y * y + z * z;
    }
}

// KSP's own event primitive and transaction-reason enum, global-namespaced
// because that is where KSP declares them, and present for one reason: RP-1
// pushes its confidence balance to its own UI through
// Confidence.OnConfidenceChanged, so putting a balance back without firing that
// event leaves the leaked figure on screen. The withholder reaches Fire by
// reflection off whatever object the static field holds, so a stand-in with the
// same member shape exercises the real call path. This assembly references no
// KSP assembly, so there is nothing for these to collide with.
public enum TransactionReasons
{
    None = 0,
    VesselRecovery = 32,
    ScienceTransmission = 1024,

    /// <summary>
    /// The reason a tech node's science is charged under. KSP's own ordinal,
    /// which RP-1's TransactionReasonsRP0 mirrors at the same bit: the research
    /// command names this member to Enum.Parse, so a renumbering here would make
    /// a test agree with nothing.
    /// </summary>
    RnDTechResearch = 16384,
}

public class EventData<T1, T2>
{
    private readonly List<Action<T1, T2>> _handlers = new List<Action<T1, T2>>();

    public EventData(string name)
    {
        Name = name;
    }

    public string Name { get; }

    /// <summary>Every (value, reason) pair this event has carried, so a test can pin that the UI was told and told once.</summary>
    public List<(T1 Value, T2 Reason)> Fired { get; } = new List<(T1, T2)>();

    public void Add(Action<T1, T2> handler) => _handlers.Add(handler);

    public void Remove(Action<T1, T2> handler) => _handlers.Remove(handler);

    public void Fire(T1 value, T2 reason)
    {
        Fired.Add((value, reason));
        foreach (var handler in _handlers.ToArray())
        {
            handler(value, reason);
        }
    }
}
