// The launch-complex LIFECYCLE half of the RP-1 stand-in graph: the members the
// rename, dismantle and construction commands reach, and no others.
//
// A separate file from Rp0Fixture rather than more of it, for the reason the crew
// and programs halves are separate: this is a coherent slice with its own
// reasoning, and the reasoning is what a stand-in is for. Rp0Fixture's own
// LaunchComplex, LCLaunchPad, LCSpaceCenter and SpaceCenterManagement are
// EXTENDED by partial declarations here, so the shipped shape stays in one place
// per type and the lifecycle members it grows are readable together.
//
// WHAT A STAND-IN HERE HAS TO GET RIGHT, learned from the traps this Uplink has
// already hit:
//
//   THE SHAPES THAT MAKE A READER FAIL. LCLaunchPad's ctor takes three arguments
//   and LaunchComplex's takes two, so a production caller that matched on arity
//   alone would be caught. SwitchToPrevLaunchComplex takes ONE argument (the
//   optional bool), so a reflected invoke that passed none finds nothing.
//   LCConstructions and PadConstructions are PersistentObservableList, whose Add
//   SHADOWS the base, so binding to the base one queues the project and tells
//   nobody.
//
//   THE ARITHMETIC THAT MUST BE REAL. LCData.GetCostStats and ResModifyCost are
//   reproduced from the shipped source rather than stubbed, because
//   Rp1LcCostModel's whole job is to combine them correctly and a stub would let a
//   wrong combination pass. LaunchComplex.MaxEngineersCalc is NOT reproduced: the
//   cost model only passes its answer through, so a deterministic stand-in that
//   carries no claim about RP-1's curve is the honest shape.
//
//   THE GATES THAT MUST BE DERIVED. CanDismantle and CanModifyReal are computed
//   from the same four lists the real ones read, so a fixture cannot set them
//   inconsistently with the state a test set up. That is the property that lets a
//   test prove the dismantle refuses for the RIGHT reason.
//
// PROVENANCE. Every member and every constant was read out of an ilspycmd
// disassembly of the INSTALLED RP-1 v4.6.0.0 RP0.dll.
using System;
using System.Collections.Generic;

namespace RP0
{
    /// <summary>
    /// A launch complex's persisted specification: what it can lift, how big, whether
    /// it takes crew, and what it can fuel.
    /// </summary>
    /// <remarks>
    /// FOUR public constructors on the real type, three of which take a single
    /// argument (<c>LCData</c>, <c>LaunchComplex</c>, and the seven-argument one).
    /// All four are here, because a production caller that resolved one of the
    /// three by arity alone would pick whichever the runtime listed first, and a
    /// fixture with only the shapes production happens to use today cannot catch
    /// that.
    /// </remarks>
    public class LCData
    {
        public string? Name;
        public float massMax;
        public float massOrig;
        public UnityEngine.Vector3 sizeMax;
        public LaunchComplexType lcType = LaunchComplexType.Pad;
        public bool isHumanRated;

        /// <summary>
        /// A <c>PersistentDictionaryValueTypes&lt;string, double&gt;</c> on the
        /// real type, which is a <c>Dictionary&lt;string, double&gt;</c>
        /// underneath: RP-1's own code casts straight through to the base and this
        /// Uplink writes it through <c>IDictionary</c>, so a plain dictionary is
        /// the same surface.
        /// </summary>
        public Dictionary<string, double> resourcesHandled = new Dictionary<string, double>();

        /// <summary>The fraction of a complex's mass a vehicle must at least be. A settings value on the real type.</summary>
        public static float MassMinFraction = 0.5f;

        /// <summary>The upper renovation limit, derived from the BUILD tonnage rather than the current one.</summary>
        public float MaxPossibleMass => Math.Max(3f, (float)Math.Floor(massOrig * 2f));

        /// <summary>The lower renovation limit, same derivation.</summary>
        public float MinPossibleMass => Math.Max(1f, (float)Math.Ceiling(massOrig * 0.5f));

        public bool IsMassWithinUpgradeMargin => massMax <= MaxPossibleMass;

        public bool IsMassWithinDowngradeMargin => massMax >= MinPossibleMass;

        public bool IsMassWithinUpAndDowngradeMargins =>
            IsMassWithinUpgradeMargin && IsMassWithinDowngradeMargin;

        public float MassMin => massMax < float.MaxValue ? (float)Math.Floor(massMax * MassMinFraction) : 0f;

        public LCData()
        {
        }

        public LCData(LCData old) => SetFrom(old);

        public LCData(LaunchComplex lc) => SetFrom(lc.Stats);

        public LCData(
            string name,
            float massMax,
            float massOrig,
            UnityEngine.Vector3 sizeMax,
            LaunchComplexType lcType,
            bool isHumanRated,
            Dictionary<string, double> resourcesHandled)
        {
            Name = name;
            this.massMax = massMax;
            this.massOrig = massOrig;
            this.sizeMax = sizeMax;
            this.lcType = lcType;
            this.isHumanRated = isHumanRated;
            foreach (var entry in resourcesHandled)
            {
                this.resourcesHandled[entry.Key] = entry.Value;
            }
        }

        public void SetFrom(LCData old)
        {
            Name = old.Name;
            massMax = old.massMax;
            massOrig = old.massOrig;
            sizeMax = old.sizeMax;
            lcType = old.lcType;
            isHumanRated = old.isHumanRated;
            resourcesHandled.Clear();
            foreach (var entry in old.resourcesHandled)
            {
                resourcesHandled[entry.Key] = entry.Value;
            }
        }

        /// <summary>
        /// The tonnage band a pad is built at.
        /// </summary>
        /// <remarks>
        /// The real one interpolates over <c>KCTUtilities.PadTons</c> and returns
        /// -1 when the table is absent. A linear stand-in over a fixed table here:
        /// the cost model only passes the answer through to a pad, so what matters
        /// is that the -1 case exists and is distinguishable from the legitimate
        /// zero the lowest band gives.
        /// </remarks>
        public float PadFracLevelValue = 0f;

        public float GetPadFracLevel() => PadFracLevelValue;

        /// <summary>
        /// The three-way price of this specification, reproduced from the shipped
        /// source clause for clause.
        /// </summary>
        /// <remarks>
        /// Reproduced rather than stubbed, and that is the point of this fixture:
        /// <see cref="GonogoRp1Uplink.Rp1LcCostModel"/> exists to COMBINE these
        /// three figures into a renovation price, and a stub returning round
        /// numbers would let a wrong combination agree with itself. The return is
        /// their sum, which is separately what a renovation's prior cost is.
        /// </remarks>
        public double GetCostStats(out double costPad, out double costVAB, out double costResources)
        {
            var size = sizeMax;
            bool padIgnore;
            if (lcType == LaunchComplexType.Pad)
            {
                padIgnore = true;
                double mass = massMax;
                costPad = Math.Max(
                    0.0,
                    Math.Pow(mass, 0.65) * 2000.0 + Math.Pow(Math.Max(mass - 350.0, 0.0), 1.5) * 2.0 - 2500.0) + 500.0;
            }
            else
            {
                padIgnore = false;
                costPad = 0.0;
                size = new UnityEngine.Vector3(size.x, size.y * 5f, size.z);
            }

            costVAB = Math.Max(1000.0, size.sqrMagnitude * 25.0);
            if (isHumanRated)
            {
                costPad *= 1.5;
                costVAB *= 2.0;
            }
            costPad *= 0.5;
            costVAB *= 0.5;

            costResources = 0.0;
            foreach (var entry in resourcesHandled)
            {
                if (!ResourceIgnored(entry.Key, padIgnore))
                {
                    costResources += Formula.ResourceTankCost(entry.Key, entry.Value, isModify: false, lcType);
                }
            }

            return costVAB + costPad + costResources;
        }

        /// <summary>
        /// The price of the resource DIFFERENCE, which is asymmetric: a reduction
        /// is charged at a tenth of a tank, and the whole difference then at 0.6 of
        /// a fresh one.
        /// </summary>
        /// <remarks>
        /// The real one accumulates its resource names into a static set it never
        /// clears, so the set grows for the process lifetime. Not reproduced,
        /// because a leaked name reads zero from both dictionaries and
        /// <c>ResourceTankCost</c> returns zero for a zero amount: the leak cannot
        /// change a price, and a fixture that reproduced it would only make tests
        /// order-dependent for no gain.
        /// </remarks>
        public double ResModifyCost(LCData old)
        {
            var names = new HashSet<string>();
            foreach (var key in old.resourcesHandled.Keys)
            {
                names.Add(key);
            }
            foreach (var key in resourcesHandled.Keys)
            {
                names.Add(key);
            }

            var total = 0.0;
            foreach (var name in names)
            {
                old.resourcesHandled.TryGetValue(name, out var before);
                resourcesHandled.TryGetValue(name, out var after);
                var delta = after - before;
                if (delta < 0.0)
                {
                    delta *= -0.1;
                }
                total += Formula.ResourceTankCost(name, delta, isModify: true, lcType);
            }
            return total;
        }

        /// <summary>
        /// Whether a complex of this kind ignores a resource, which is the FLAG
        /// arithmetic RP-1's own resource list does inline. Fuel is 1, PadIgnore is
        /// 4, HangarIgnore is 8.
        /// </summary>
        private static bool ResourceIgnored(string resource, bool padIgnore)
        {
            if (!Database.ResourceInfo.LCResourceTypes.TryGetValue(resource, out var flags))
            {
                return true;
            }
            var ignored = padIgnore ? 4 : 8;
            return (flags & 1) == 0 || (flags & ignored) != 0;
        }
    }

    /// <summary>
    /// The resource catalogue a complex's fluids are validated and priced against,
    /// keyed the way RP-1 keys it and carrying its flag values as ints.
    /// </summary>
    /// <remarks>
    /// Ints rather than an enum, deliberately: the Uplink cannot reference RP-1's
    /// <c>LCResourceType</c> and reads the value through <c>Convert.ToInt32</c>, so
    /// a fixture that used a real enum would exercise a conversion production never
    /// performs. Fuel is 1, PadIgnore is 4, HangarIgnore is 8.
    /// </remarks>
    public class ResourceInfo
    {
        public Dictionary<string, int> LCResourceTypes = new Dictionary<string, int>();
    }

    /// <summary>The price of a resource tank, whose only property the cost model relies on is that a zero amount is free.</summary>
    public static class Formula
    {
        /// <summary>Funds per unit, per resource. A resource absent from this is free, as it is in the shipped formula.</summary>
        public static Dictionary<string, double> TankCostPerUnit = new Dictionary<string, double>();

        /// <summary>RP-1's own multiplier for a tank being altered rather than built.</summary>
        public const double ModifyMultiplier = 0.6;

        public static double ResourceTankCost(string resource, double amount, bool isModify, LaunchComplexType type)
        {
            if (!TankCostPerUnit.TryGetValue(resource, out var perUnit))
            {
                return 0.0;
            }
            var cost = amount * perUnit;
            return isModify ? cost * ModifyMultiplier : cost;
        }
    }

}

namespace ROUtils
{
    /// <summary>
    /// The ONE thing this Uplink reaches in RP-1's utility assembly: whether the
    /// save is a career.
    /// </summary>
    /// <remarks>
    /// <para>It decides whether a construction is QUEUED against funding or applied
    /// at once, and it is a genuinely different answer from
    /// <c>SpaceCenterManagement.enabledForSave</c>, which is true for sandbox and
    /// science-sandbox as well. That is why the commands refuse rather than guess
    /// when this cannot be asked: a funded project on a save with no funding stalls
    /// forever with nothing saying why.</para>
    /// <para><see cref="Throws"/> exists for exactly that case, because "the method
    /// is there and it threw" is a state a reflected call has to survive and is not
    /// the same as the method being absent.</para>
    /// </remarks>
    public static class KSPUtils
    {
        /// <summary>What the career test answers. True is the normal RP-1 save.</summary>
        public static bool IsCareer = true;

        /// <summary>Makes the test throw, which a command must refuse on rather than assume either way.</summary>
        public static bool Throws;

        public static bool CurrentGameIsCareer()
        {
            if (Throws)
            {
                throw new System.InvalidOperationException("the game mode could not be read");
            }
            return IsCareer;
        }
    }
}

namespace RP0
{
    /// <summary>
    /// The interface RP-1's warp controller aims at: anything with a time left and
    /// a name, which is every project a career waits on.
    /// </summary>
    /// <remarks>
    /// Declared as an interface rather than a base class because RP-1 declares one,
    /// and because that is what lets a fund target and a half-built rocket be the
    /// same kind of warp target. The real one carries more, but a warp only ever
    /// asks these.
    /// </remarks>
    public interface ISpaceCenterProject
    {
        string GetItemName();

        double GetTimeLeft();

        bool IsComplete();
    }

    /// <summary>
    /// A project a test can put in front of the warp commands, with the two answers
    /// they read.
    /// </summary>
    public class FakeProject : ISpaceCenterProject
    {
        public string Name = "Atlas 3";

        public double TimeLeft = 86400.0;

        public bool Complete;

        /// <summary>
        /// Makes the project decline to name itself, which a refusal sentence has to
        /// survive. NULL rather than a throw, deliberately: RP-1's own Create reads
        /// the name too, so a throwing name would break Create rather than exercise
        /// the fallback, and the fallback is what is under test.
        /// </summary>
        public bool Nameless;

        public string GetItemName() => Nameless ? null! : Name;

        public double GetTimeLeft() => TimeLeft;

        public bool IsComplete() => Complete;
    }

    /// <summary>
    /// RP-1's warp controller, in the two members this Uplink reaches.
    /// </summary>
    /// <remarks>
    /// <para><c>Create</c> reproduces the shape that matters and the DEFECT that
    /// matters: a null target means "the next thing to finish", and RP-1 then
    /// dereferences that target's name WITHOUT a null check. So a Create called
    /// with nothing to warp to throws, exactly as the shipped one does, and a
    /// command that failed to guard would fail here rather than in a career.</para>
    /// <para>The real type is <c>internal</c>, which reflection reaches anyway;
    /// public here because a test assembly has no way to be inside RP-1's.</para>
    /// </remarks>
    public static class KCTWarpController
    {
        /// <summary>Every target Create was handed, so a test can pin which one it aimed at.</summary>
        public static readonly System.Collections.Generic.List<ISpaceCenterProject?> Created =
            new System.Collections.Generic.List<ISpaceCenterProject?>();

        /// <summary>Set to make Create throw AFTER recording, which is a warp that may have started.</summary>
        public static bool Throws;

        public static void Reset()
        {
            Created.Clear();
            Throws = false;
        }

        public static void Create(ISpaceCenterProject warpTarget)
        {
            var target = warpTarget ?? KCTUtilities.GetNextThingToFinish();
            Created.Add(target);
            if (Throws)
            {
                throw new System.InvalidOperationException("the warp controller could not be created");
            }
            // The shipped defect, reproduced: no null check before the name is read.
            _ = target.GetItemName();
        }
    }
}
