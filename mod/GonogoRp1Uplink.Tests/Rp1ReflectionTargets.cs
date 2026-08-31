using System.Collections.Generic;
using System.Linq;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>What the production walk assumes about a member it reads by name.</summary>
    /// <remarks>
    /// These are the readers in <c>Rp1Types</c>, named by what they ACCEPT rather
    /// than by which method they are, because that is the thing a rename or a
    /// widening breaks. <c>ReadDouble</c> going through <c>ToDouble</c> accepts
    /// four widths; <c>ReadBool</c> accepts one type and returns absent for
    /// everything else, so a bool that became a byte reads as no answer at all.
    /// </remarks>
    public enum Rp1Reader
    {
        /// <summary>Read as an object and then walked, enumerated or cast. No claim about its type.</summary>
        Presence,

        /// <summary>ReadDouble / ReadInt, both through ToDouble: Double, Single, Int32 or Int64.</summary>
        Numeric,

        /// <summary>WriteDouble: numeric as above, and settable, because the withholder puts a balance back.</summary>
        NumericWrite,

        /// <summary>ReadBool: Boolean exactly.</summary>
        Bool,

        /// <summary>ReadString: String exactly.</summary>
        Text,

        /// <summary>ReadGuidString: Guid or String, because RP-1 keeps an identity as both.</summary>
        GuidText,

        /// <summary>
        /// WriteMember with a Guid: settable, and Guid or String, because the
        /// value handed to it is another RP-1 member's Guid. Its own kind rather
        /// than <see cref="Presence"/> because settability is the load-bearing
        /// half: a member that lost its setter would leave a vehicle bound to
        /// whichever complex happened to be active.
        /// </summary>
        GuidWrite,

        /// <summary>ReadEnumName: an enum, read as its name rather than its ordinal.</summary>
        EnumText,
    }

    /// <summary>A type the Uplink resolves by full name, and whose absence means "RP-1 is not here".</summary>
    public sealed record Rp1TypeTarget(string Assembly, string Type, string CallSite);

    /// <summary>A field or property the Uplink reads, or writes, by name.</summary>
    public sealed record Rp1MemberTarget(
        string Assembly,
        string Type,
        string Member,
        Rp1Reader Reader,
        bool Static,
        string CallSite);

    /// <summary>A method the Uplink invokes, matched by name and arity the way production matches it.</summary>
    /// <param name="Public">
    /// The accessibility the production lookup asks for, and a real assertion
    /// rather than a formality. Nearly every method here is public API and a
    /// public-only lookup is what makes an accidental reach into RP-1's internals
    /// fail loudly; ONE is deliberately not
    /// (<c>PatchKSCFacilityContextMenu.GetTechGate</c>), and a guard that could
    /// only express "public" would have reported success on the single most
    /// fragile pin in the manifest, because a private member simply would not be
    /// found and the mismatch would read as a missing overload of a public one.
    /// Defaulted, so declaring a public method stays a five-field statement.
    /// </param>
    public sealed record Rp1MethodTarget(
        string Assembly,
        string Type,
        string Method,
        int Arity,
        bool Static,
        string CallSite,
        bool Public = true);

    /// <summary>
    /// A constructor the Uplink invokes, matched by arity the way production
    /// matches it.
    /// </summary>
    /// <remarks>
    /// Its own record rather than a <see cref="Rp1MethodTarget"/> with the name
    /// <c>.ctor</c>, because a constructor has no staticness to declare and
    /// because these were the one reflected shape the guard could not see at all:
    /// two commands build an RP-1 object by arity, and a reshaped constructor
    /// would take the whole command out while every other check stayed green.
    /// </remarks>
    public sealed record Rp1ConstructorTarget(string Assembly, string Type, int Arity, string CallSite);

    /// <summary>An enum member the Uplink names to Enum.Parse, so a rename is an immediate throw.</summary>
    public sealed record Rp1EnumMemberTarget(string Assembly, string Type, string Member, string CallSite);

    /// <summary>
    /// Every RP-1 member the Uplink reaches by string, enumerated from the
    /// production walk rather than from the stand-in graph in
    /// <c>Rp0Fixture</c>.
    /// </summary>
    /// <remarks>
    /// <para><b>Why this list and the fixture are different things.</b>
    /// <c>Rp0Fixture</c> declares RP-1's names in RP-1's namespaces, so the walk
    /// resolves it exactly as it resolves the real assembly. That makes the
    /// fixture a self-consistency check and nothing more: rename
    /// <c>confidence</c> on RP-1's side and production stops resolving it while
    /// the fixture goes on carrying the old name, so every test stays green. This
    /// list exists to be compared against the SHIPPED binary instead, which is
    /// the only comparison a rename can fail.</para>
    ///
    /// <para><b>What it cannot do.</b> It proves the members exist, that they are
    /// the kind the walk resolves, and that their declared types are ones the
    /// reader accepts. It proves nothing about a running RP-1: not that
    /// <c>Instance</c> is non-null in any scene, not that a member holds the
    /// quantity its name suggests, not that <c>PredictWeightedEfficiency</c>
    /// returns an efficiency rather than the interval it returns on its early-out,
    /// and not that writing a balance back leaves RP-1 in a state it agrees with.
    /// A member that kept its name and changed its MEANING passes this list
    /// completely.</para>
    ///
    /// <para><b>Assemblies.</b> <c>RP0</c> is RP-1's own. <c>ROUtils</c> ships
    /// beside it and owns the curve keys and the compressed craft node. Members
    /// belonging to KSP itself are in <see cref="OutOfScope"/> with the reason,
    /// rather than silently missing.</para>
    /// </remarks>
    public static class Rp1ReflectionTargets
    {
        public const string Rp0 = "RP0";
        public const string RoUtils = "ROUtils";

        public static IReadOnlyList<Rp1TypeTarget> Types { get; } = new[]
        {
            new Rp1TypeTarget(Rp0, "RP0.SpaceCenterManagement", "Rp1ScReflection, Rp1LaunchGate, Rp1CareerProjectGate, Rp1BuildCommands, Rp1DerivedCurrencyWithholder"),
            new Rp1TypeTarget(Rp0, "RP0.Confidence", "Rp1ScReflection, Rp1DerivedCurrencyWithholder"),
            // RP-1's strategy base, which carries PerformActivate: the entire
            // fresh-activation procedure, and the door that does not ask
            // CanBeActivated's UI-dependent first arm.
            new Rp1TypeTarget(Rp0, "RP0.StrategyRP0", "Rp1StrategyWrites"),
            // Asserted POSITIVELY before any currency is charged: a leader is
            // defined negatively in RP-1 terms (any strategy whose department is
            // not Programs), and a negative definition is the wrong thing to bet a
            // spend on.
            new Rp1TypeTarget(Rp0, "RP0.Programs.ProgramStrategy", "Rp1StrategyWrites"),
            // Tells the two ActivateProgram overloads apart by first-parameter
            // type; a lookup by arity alone could take either.
            new Rp1TypeTarget(Rp0, "RP0.Programs.Program", "Rp1StrategyWrites"),
            new Rp1TypeTarget(Rp0, "RP0.LCEfficiency", "Rp1ScReflection"),
            new Rp1TypeTarget(Rp0, "RP0.KSCSwitcherInterop", "Rp1ScReflection"),
            new Rp1TypeTarget(Rp0, "RP0.Database", "Rp1ScReflection, Rp1CrewReflection, Rp1EconomyBackend"),
            new Rp1TypeTarget(Rp0, "RP0.MaintenanceHandler", "Rp1EconomyBackend, Rp1ScReflection"),
            new Rp1TypeTarget(Rp0, "RP0.MaintenanceHandler+SubsidyDetails", "Rp1EconomyBackend"),
            new Rp1TypeTarget(Rp0, "RP0.UnlockCreditHandler", "Rp1EconomyBackend"),
            new Rp1TypeTarget(Rp0, "RP0.KCTUtilities", "Rp1BuildCommands, Rp1VehicleCommands, Rp1PersonnelCommands"),
            new Rp1TypeTarget(Rp0, "RP0.ReconRolloutProject", "Rp1VehicleCommands"),
            new Rp1TypeTarget(Rp0, "RP0.LaunchComplex", "Rp1VehicleCommands, Rp1PersonnelCommands"),
            new Rp1TypeTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "Rp1BuildCommands"),
            new Rp1TypeTarget(Rp0, "RP0.TransactionReasonsRP0", "Rp1BuildCommands"),
            new Rp1TypeTarget(Rp0, "RP0.CurrencyRP0", "Rp1BuildCommands"),
            new Rp1TypeTarget(Rp0, "RP0.KCTUtilities", "Rp1BuildCommands, Rp1BuildStartCommands, Rp1VehicleCommands"),
            new Rp1TypeTarget(Rp0, "RP0.VesselProject", "Rp1BuildStartCommands"),
            new Rp1TypeTarget(Rp0, "RP0.ReconRolloutProject", "Rp1VehicleCommands"),
            new Rp1TypeTarget(Rp0, "RP0.LaunchComplex", "Rp1VehicleCommands"),
            new Rp1TypeTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "Rp1Pricing"),
            new Rp1TypeTarget(Rp0, "RP0.TransactionReasonsRP0", "Rp1Pricing"),
            new Rp1TypeTarget(Rp0, "RP0.CurrencyRP0", "Rp1Pricing"),
            new Rp1TypeTarget(Rp0, "RP0.CurrencyUtils", "Rp1EconomyUpkeepQuery"),
            new Rp1TypeTarget(Rp0, "RP0.TransactionReasonsRP0", "Rp1EconomyUpkeepQuery"),
            new Rp1TypeTarget(Rp0, "RP0.MaintenanceHandler", "Rp1EconomyUpkeepQuery"),
            // RP-1's queued tech node, and the only RP-1 type this Uplink
            // CONSTRUCTS and then hands back to RP-1's own deserialiser.
            new Rp1TypeTarget(Rp0, "RP0.ResearchProject", "Rp1ResearchCommands"),
            // Whether RP-1 queues research in this save at all. Its own prefix on
            // RDTech.UnlockTech consults it before anything else, and a save it
            // says no in has no research queue to add to.
            new Rp1TypeTarget(Rp0, "RP0.PresetManager", "Rp1ResearchCommands"),
            new Rp1TypeTarget(Rp0, "RP0.Database", "Rp1ResearchCommands"),
            new Rp1TypeTarget(Rp0, "RP0.KCTUtilities", "Rp1ResearchCommands"),
            new Rp1TypeTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "Rp1ResearchCommands"),
            new Rp1TypeTarget(Rp0, "RP0.TransactionReasonsRP0", "Rp1ResearchCommands"),
            new Rp1TypeTarget(Rp0, "RP0.CurrencyRP0", "Rp1ResearchCommands"),
            new Rp1TypeTarget(Rp0, "RP0.Crew.CrewHandler", "Rp1CrewReflection"),
            new Rp1TypeTarget(Rp0, "RP0.Programs.ProgramHandler", "Rp1ProgramsReflection"),
            // The construction project a facility upgrade IS under RP-1, and the
            // reason career.facility.upgrade is refused rather than allowed to
            // buy a tier outright.
            new Rp1TypeTarget(Rp0, "RP0.FacilityUpgradeProject", "Rp1FacilityUpgradeCommands"),
            // RP-1's event bus, for the one event an enqueue announces itself on.
            new Rp1TypeTarget(Rp0, "RP0.SCMEvents", "Rp1FacilityUpgradeCommands"),
            // A HARMONY PATCH CLASS, which is implementation detail rather than
            // API and is the likeliest name on this whole list to move. It is
            // here because the rule that decides whether a facility tier is
            // unlocked lives on it and nowhere else, and because an unresolvable
            // gate refuses every upgrade at the press with nothing else noticing.
            new Rp1TypeTarget(Rp0, "RP0.Harmony.PatchKSCFacilityContextMenu", "Rp1FacilityUpgradeCommands"),
        };

        public static IReadOnlyList<Rp1EnumMemberTarget> EnumMembers { get; } = new[]
        {
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "VesselPurchase", "Rp1Pricing"),
            new Rp1EnumMemberTarget(Rp0, "RP0.CurrencyRP0", "Funds", "Rp1Pricing"),
            // The six reasons UpdateUpkeep prices its six upkeep lines against.
            // A rename on RP-1's side takes the modified breakdown off the wire
            // rather than corrupting it, but it takes it off silently, which is
            // exactly what this manifest is for.
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "StructureRepair", "Rp1EconomyUpkeepQuery"),
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "StructureRepairLC", "Rp1EconomyUpkeepQuery"),
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "SalaryEngineers", "Rp1EconomyUpkeepQuery"),
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "SalaryResearchers", "Rp1EconomyUpkeepQuery"),
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "SalaryCrew", "Rp1EconomyUpkeepQuery"),
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "CrewTraining", "Rp1EconomyUpkeepQuery"),
            // The reason a tech node is priced and charged under, named to
            // Enum.Parse on both RP-1's flags enum and KSP's own of the same
            // member name. Only RP-1's half is checkable from here.
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "RnDTechResearch", "Rp1ResearchCommands"),
            new Rp1EnumMemberTarget(Rp0, "RP0.CurrencyRP0", "Science", "Rp1ResearchCommands"),
        };

        public static IReadOnlyList<Rp1ConstructorTarget> Constructors { get; } = new[]
        {
            // RP-1's ONLY constructor that measures a craft, and the whole of how
            // a build is started from a craft file: mass, size, cost, effective
            // cost, build points, part names and human rating all come off the
            // live parts inside it.
            new Rp1ConstructorTarget(Rp0, "RP0.VesselProject", 4, "Rp1BuildStartCommands"),
            // FOUR parameters with the last defaulted, because a reflected invoke
            // applies no defaults and has to pass all four.
            new Rp1ConstructorTarget(Rp0, "RP0.ReconRolloutProject", 4, "Rp1VehicleCommands"),
            // (SpaceCenterFacility, string facilityID, int newLevel, int oldLevel,
            // string name). The parameterless constructor sits beside it for
            // deserialisation, so arity is what tells the two apart and a
            // reshaped signature would silently resolve the wrong one.
            new Rp1ConstructorTarget(Rp0, "RP0.FacilityUpgradeProject", 5, "Rp1FacilityUpgradeCommands"),
            // The PARAMETERLESS one, and the arity matters as much here as the
            // four above: it is the constructor that seeds workRate to 1 and the
            // two lazy -1 rate sentinels, none of which Load(ConfigNode) sets. A
            // release that gave it a parameter would leave this command building
            // a project through whatever else arity 0 matched, or nothing.
            new Rp1ConstructorTarget(Rp0, "RP0.ResearchProject", 0, "Rp1ResearchCommands"),
        };

        public static IReadOnlyList<Rp1MethodTarget> Methods { get; } = new[]
        {
            new Rp1MethodTarget(Rp0, "RP0.LCEfficiency", "PredictWeightedEfficiency", 5, false, "Rp1ScReflection"),
            // The whole fresh-activation procedure for a strategy, and the reason
            // a leader can be appointed with the Administration Building shut:
            // ActivateOverride is nothing but CanBeActivated plus this call, and
            // this one never asks CanBeActivated, whose first statement
            // dereferences the UI singleton. Confirmed at IL as public, arity 1
            // and NON-VIRTUAL.
            //
            // Pinning it is not the whole assertion. The day RP-1 adds a step to
            // ActivateOverride, our path silently stops doing it with no compile
            // error and no test failure, which is why Rp1StrategyWritesTests also
            // asserts that method's SHAPE rather than only this member's
            // existence.
            new Rp1MethodTarget(Rp0, "RP0.StrategyRP0", "PerformActivate", 1, false, "Rp1StrategyWrites"),
            // The program half that ProgramStrategy.OnRegister skips whenever the
            // Administration screen is shut. Resolved by first-parameter TYPE
            // because ActivateProgram(string, Program.Speed) sits beside it, and
            // a lookup by arity alone could take either.
            new Rp1MethodTarget(Rp0, "RP0.Programs.ProgramHandler", "ActivateProgram", 1, false, "Rp1StrategyWrites"),
            // The only route to a space centre's DISPLAY name. RP-1 keeps the id
            // on LCSpaceCenter and nothing else, and its shim is what reads
            // KSCSwitcher's site config for the name beside it.
            new Rp1MethodTarget(Rp0, "RP0.KSCSwitcherInterop", "GetAvailableSites", 0, true, "Rp1ScReflection"),
            new Rp1MethodTarget(Rp0, "RP0.MaintenanceHandler", "FillSubsidyDetails", 3, true, "Rp1EconomyBackend"),
            // THREE parameters with the last defaulted, because a reflected
            // invoke applies no defaults. UpdateUpkeep calls the two-argument
            // form, which is this one with includeHidden left false.
            new Rp1MethodTarget(Rp0, "RP0.CurrencyUtils", "Funds", 3, true, "Rp1EconomyUpkeepQuery"),
            new Rp1MethodTarget(Rp0, "RP0.KCTUtilities", "AddVesselToBuildList", 2, true, "Rp1BuildCommands, Rp1BuildStartCommands"),
            new Rp1MethodTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "RunQuery", 4, true, "Rp1Pricing"),
            new Rp1MethodTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "CanAfford", 1, false, "Rp1Pricing"),
            new Rp1MethodTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "GetTotal", 2, false, "Rp1Pricing"),
            new Rp1MethodTarget(Rp0, "RP0.VesselProject", "CreateCopy", 0, false, "Rp1BuildCommands"),
            new Rp1MethodTarget(Rp0, "RP0.VesselProject", "MeetsFacilityRequirements", 1, false, "Rp1BuildCommands, Rp1BuildStartCommands"),
            new Rp1MethodTarget(Rp0, "RP0.VesselProject", "GetTotalCost", 0, false, "Rp1Pricing"),
            // One out parameter, so arity ONE. The only way to learn that a pad
            // reading Free has a craft standing on it in PRELAUNCH, because
            // LCLaunchPad.State deliberately does not consult FlightGlobals.
            new Rp1MethodTarget(Rp0, "RP0.LCLaunchPad", "HasVesselWaitingToBeLaunched", 1, false, "Rp1ScReflection, Rp1VehicleCommands"),
            new Rp1MethodTarget(Rp0, "RP0.ReconRolloutProject", "SwitchDirection", 0, false, "Rp1VehicleCommands"),
            new Rp1MethodTarget(Rp0, "RP0.KCTUtilities", "ScrapVessel", 1, true, "Rp1VehicleCommands"),
            new Rp1MethodTarget(Rp0, "RP0.KCTUtilities", "ChangeEngineers", 2, true, "Rp1VehicleCommands, Rp1PersonnelCommands"),
            // The money calls. All three are read-only on the shipped assembly
            // and are CALLED rather than mirrored for that reason: they return a
            // figure RP-1 actually bills, and the salary ladder behind them has
            // four branches nothing here could keep in step.
            new Rp1MethodTarget(Rp0, "RP0.MaintenanceHandler", "LCUpkeep", 1, false, "Rp1ScReflection"),
            // Each target's own estimate of its wait, called only when the target
            // reports itself valid: both dereference Funding.Instance unguarded,
            // and the fund one iterates against the income curve up to 256 times.
            new Rp1MethodTarget(Rp0, "RP0.HireStaffProject", "GetTimeLeft", 0, false, "Rp1ScReflection"),
            // The cancel. A pure field reset on both, which is what makes
            // withdrawing a target safe to offer when setting one is not.
            new Rp1MethodTarget(Rp0, "RP0.HireStaffProject", "Clear", 0, false, "Rp1TargetCommands"),
            new Rp1MethodTarget(Rp0, "RP0.FundTargetProject", "Clear", 0, false, "Rp1TargetCommands"),
            new Rp1MethodTarget(Rp0, "RP0.FundTargetProject", "GetTimeLeft", 0, false, "Rp1ScReflection"),
            new Rp1MethodTarget(Rp0, "RP0.SpaceCenterManagement", "GetEffectiveEngineersForSalary", 1, false, "Rp1ScReflection"),
            new Rp1MethodTarget(Rp0, "RP0.SpaceCenterManagement", "GetEffectiveIntegrationEngineersForSalary", 1, false, "Rp1ScReflection"),
            // ── The facility upgrade ────────────────────────────────────────
            // THE ONE NON-PUBLIC MEMBER THIS UPLINK REACHES, and the reason
            // Rp1MethodTarget carries an accessibility at all. RP-1's rule for
            // whether a facility tier is unlocked, private static on a Harmony
            // patch class, reached rather than reproduced because its body is a
            // lookup into a dictionary RP-1 builds from its own KCTBUILDINGTECHS
            // config: reproducing it means re-parsing config this Uplink does not
            // own, and drifting from it the day RP-1 changes how that config
            // merges. Declared private here on purpose. A public expectation
            // would not find it, and the failure would read as a missing overload
            // of a member that is present and working.
            new Rp1MethodTarget(
                Rp0, "RP0.Harmony.PatchKSCFacilityContextMenu", "GetTechGate", 2, true,
                "Rp1FacilityUpgradeCommands", Public: false),
            // The second, and the refusal the design arrived without: RP-1 gives
            // five of the nine facilities a 1-fund ladder its own config calls
            // "cosmetic only" and drives their level itself, so a project queued
            // against one is overwritten as soon as it lands. Its answer comes out
            // of Database.LockedFacilities and it matches by case-insensitive
            // SUBSTRING of the id, both of which are RP-1's to change, so it is
            // called rather than reproduced. Private, like its neighbour.
            new Rp1MethodTarget(
                Rp0, "RP0.Harmony.PatchKSCFacilityContextMenu", "IsUpgradeable", 1, true,
                "Rp1FacilityUpgradeCommands", Public: false),
            // RP-1's own duplicate guard, and it searches EVERY centre rather
            // than the active one. Called rather than reimplemented for exactly
            // that reason: a per-centre check would let a second construction
            // project appear for a facility already being upgraded at another KSC.
            new Rp1MethodTarget(Rp0, "RP0.FacilityUpgradeProject", "AlreadyInProgressByID", 1, true, "Rp1FacilityUpgradeCommands"),
            // The whole of how a price becomes a build DURATION
            // (Formula.GetConstructionBP). Declared on the base that owns it;
            // production invokes it on the FacilityUpgradeProject instance, whose
            // public method set includes it.
            new Rp1MethodTarget(Rp0, "RP0.ConstructionProject", "SetBP", 2, false, "Rp1FacilityUpgradeCommands"),

            // The research queue's write half. Load is RP-1's OWN deserialiser
            // and is the whole route: this Uplink authors a ConfigNode and RP-1
            // reconstructs the project from it, so none of RP-1's arithmetic is
            // reproduced anywhere. A rename here takes the command out with a
            // sentence naming the member rather than silently queuing nothing.
            new Rp1MethodTarget(Rp0, "RP0.ResearchProject", "Load", 1, false, "Rp1ResearchCommands"),
            new Rp1MethodTarget(Rp0, "RP0.ResearchProject", "UpdateBuildRate", 1, false, "Rp1ResearchCommands"),
            new Rp1MethodTarget(Rp0, "RP0.SpaceCenterManagement", "TechListHas", 1, false, "Rp1ResearchCommands"),
            new Rp1MethodTarget(Rp0, "RP0.KCTUtilities", "AddNodePartsToExperimental", 1, true, "Rp1ResearchCommands"),
            new Rp1MethodTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "RunQuery", 4, true, "Rp1ResearchCommands"),
            new Rp1MethodTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "CanAfford", 1, false, "Rp1ResearchCommands"),
            new Rp1MethodTarget(Rp0, "RP0.CurrencyModifierQueryRP0", "GetTotal", 2, false, "Rp1ResearchCommands"),
        };

        public static IReadOnlyList<Rp1MemberTarget> Members { get; } = BuildMembers();

        /// <summary>
        /// Members the walk reaches that RP-1 does not own, so this guard cannot
        /// check them. Listed rather than omitted: an unlisted name would look
        /// like a manifest that had drifted, and the coverage test would say so.
        /// </summary>
        public static IReadOnlyDictionary<string, string> OutOfScope { get; } = new Dictionary<string, string>
        {
            // Stock's Strategies.Strategy and StrategySystem, not RP-1's. RP-1
            // subclasses them but does not own these members, so a rename here is
            // KSP's to make and Assembly-CSharp's to answer for.
            // Stock's ProtoCrewMember, not RP-1's. RP-1 WRITES it (SetInactive at
            // course start, for 120% of base time) but the field is KSP's, and it
            // is read here because it outlasts the course: it is the date a crew
            // member can fly again, which is not the date their training ends.
            ["inactiveTimeEnd"] = "stock ProtoCrewMember.inactiveTimeEnd, the ground-until date that outlasts a training course",
            ["IsActive"] = "stock Strategies.Strategy.IsActive, read to refuse a strategy that is already committed",
            ["Factor"] = "stock Strategies.Strategy.Factor, the commitment level, written before the gate and restored on a refusal",
            ["GroupTags"] = "stock Strategies.Strategy.GroupTags, handed to HasConflictingActiveStrategies as arm 2's input",
            ["CanActivate"] = "stock Strategies.Strategy.CanActivate(ref string), arm 8, where RP-1 puts its program slot cap by override",
            ["Effects"] = "stock Strategies.Strategy.Effects, arm 9's roster: each StrategyEffect is asked its own CanActivate, and any mod's effect can refuse",
            ["HasConflictingActiveStrategies"] = "stock Strategies.StrategySystem's arm 2, the only arm that reads the system rather than the strategy",
            ["Strategies"] = "stock StrategySystem.Strategies, the roster walked to resolve a strategy by name",
            ["Name"] = "stock Strategies.Strategy.Name, the id a command names a strategy by",
            ["Config"] = "stock Strategies.Strategy.Config, the fallback identity when Name is empty",
            // KSP's own facility and difficulty tables. GetStrategyCommitRange is
            // the method Administration.Start caches arm 3's ceiling from, and it
            // is VIRTUAL, so calling through GameVariables.Instance inherits a
            // facility-retiering mod's override where copying the numbers would
            // not.
            ["GameVariables"] = "KSP's difficulty table, which owns the strategy commit range; not RP-1's to guard",
            ["GetStrategyCommitRange"] = "KSP GameVariables.GetStrategyCommitRange, arm 3's ceiling, from the source Administration.Start reads it from",
            ["ScenarioUpgradeableFacilities"] = "KSP's facility-level scenario module, four-scene and not RP-1's",
            ["GetFacilityLevel"] = "KSP ScenarioUpgradeableFacilities.GetFacilityLevel, the Administration level arm 3 is asked at",
            ["SpaceCenterFacility"] = "KSP's facility enum, named to resolve the Administration member",
            ["Fire"] = "KSP's EventData<T1,T2>.Fire, reached off Confidence.OnConfidenceChanged, and matched by arity and first parameter type rather than by name alone",
            ["Funds"] = "KSP's Funding.Funds, read only to put a balance beside a refusal (and also the name of RP0.CurrencyRP0.Funds, which IS checked)",
            ["Instance"] = "checked on every RP-1 handler that has one; ALSO KSP's Funding.Instance, which is not RP-1's to guard",
            ["Funding"] = "KSP's own career balance type, resolved by the same Find as RP-1's types but belonging to Assembly-CSharp",
            ["vesselName"] = "KSP's Vessel.vesselName, read off the craft LCLaunchPad.HasVesselWaitingToBeLaunched hands back so a refusal can name it",
            ["Add"] = "the list's own Add, on ROUtils.DataTypes.PersistentObservableList<T> from a separate assembly, resolved by arity on whatever collection LaunchComplex.Recon_Rollout hands back rather than named on an RP-1 type",
            ["name"] = "checked on RP-1's own types; ALSO KSP's ProtoCrewMember.name, read off the students in a training course",
            ["Item1"] = "System.ValueTuple, the (id, displayName) pair KSCSwitcherInterop.GetAvailableSites returns; RP-1 names neither half",
            ["Item2"] = "System.ValueTuple, the (id, displayName) pair KSCSwitcherInterop.GetAvailableSites returns; RP-1 names neither half",
            // KSP's own, and the reason the research command needs them: it does
            // not merely read RP-1, it AUTHORS a ConfigNode and charges a
            // currency, and both of those are KSP's to declare. Nothing in RP0.dll
            // can be held to account for any of these, so they are named here with
            // what they are rather than left to look like an oversight.
            ["ResearchAndDevelopment"] = "KSP's R&D scenario module, the science ledger and the tech-state table",
            ["AssetBase"] = "KSP's asset singleton, the only route to the loaded tech tree",
            ["ConfigNode"] = "KSP's config tree, which the research command authors for RP-1's own Load to parse",
            ["GameVariables"] = "KSP's difficulty curves, which price the R&D complex's science-cost ceiling",
            ["ScenarioUpgradeableFacilities"] = "KSP's facility-level module, read at the R&D complex",
            ["TransactionReasons"] = "KSP's own transaction-reason enum (RP0.TransactionReasonsRP0 mirrors it and IS checked)",
            ["RnDTechTree"] = "AssetBase.RnDTechTree, KSP's loaded tech tree",
            ["GetTreeTechs"] = "RDTechTree.GetTreeTechs, KSP's own",
            ["GetTechnologyState"] = "ResearchAndDevelopment.GetTechnologyState, KSP's own, and the PLAYER's state rather than the tree asset's",
            ["GetTechnologyTitle"] = "ResearchAndDevelopment.GetTechnologyTitle, KSP's own",
            ["GetTechState"] = "ResearchAndDevelopment.GetTechState, KSP's own, read for the parts already purchased off a node",
            ["AddScience"] = "ResearchAndDevelopment.AddScience, KSP's own signature; RP-1 replaces the BODY with a Harmony prefix and leaves the member alone",
            ["Science"] = "ResearchAndDevelopment.Science, read only to put a balance beside a refusal (and also the name of RP0.CurrencyRP0.Science, which IS checked)",
            ["GetFacilityLevel"] = "ScenarioUpgradeableFacilities.GetFacilityLevel, KSP's own, the string overload",
            ["GetScienceCostLimit"] = "GameVariables.GetScienceCostLimit, KSP's own",
            ["AddValue"] = "ConfigNode.AddValue, KSP's own, resolved by exact parameter types because a dozen overloads share its arity",
            ["AddNode"] = "ConfigNode.AddNode, KSP's own",
            ["partsPurchased"] = "ProtoTechNode.partsPurchased, KSP's own, copied out by part name into the authored node",
            ["Key"] = "System.Collections.Generic.KeyValuePair, walked over RP-1's TechNodePeriods rather than casting to a generic dictionary from another assembly",
            ["Value"] = "System.Collections.Generic.KeyValuePair, the other half of the same walk",
            ["Count"] = "the list's own Count, on whatever collection SpaceCenterManagement.TechList hands back",
            ["x"] = "UnityEngine.Vector3, read off LaunchComplex.SizeMax and VesselProject.ShipSize",
            ["y"] = "UnityEngine.Vector3, read off LaunchComplex.SizeMax and VesselProject.ShipSize",
            ["z"] = "UnityEngine.Vector3, read off LaunchComplex.SizeMax and VesselProject.ShipSize",

            // ── KSP's own facility model ────────────────────────────────────
            // Reached by the facility-upgrade command, and none of it RP-1's to
            // guard: RP-1 reads the very same members from ProcessUpgrade, so a
            // rename here breaks RP-1 itself before it breaks this Uplink.
            ["ScenarioUpgradeableFacilities"] = "KSP's facility registry, resolved by the same Find as RP-1's types but belonging to Assembly-CSharp",
            ["protoUpgradeables"] = "KSP's ScenarioUpgradeableFacilities.protoUpgradeables, the id-to-facility dictionary RP-1 reads through GetFacilityReferencesById",
            ["facilityRefs"] = "KSP's ProtoUpgradeable.facilityRefs, the live UpgradeableFacility list, which is empty outside the SPACECENTER scene",
            ["SlashSanitize"] = "KSP's own id normaliser, called rather than copied so a bare facility name and a full id cannot disagree about which building was meant",
            ["Key"] = "System.Collections.Generic.KeyValuePair, walking protoUpgradeables as a bare IEnumerable rather than indexing it, because RP-1's own indexer throws on a miss",
            ["Value"] = "System.Collections.Generic.KeyValuePair, the other half of the pair above",
            ["FacilityLevel"] = "KSP's UpgradeableObject.FacilityLevel, the tier a facility stands at",
            ["MaxLevel"] = "KSP's UpgradeableObject.MaxLevel, the TOP tier's own index rather than a count",
            ["UpgradeLevels"] = "KSP's UpgradeableObject.UpgradeLevels, the public property over the protected level table",
            ["levelCost"] = "KSP's UpgradeableObject.UpgradeLevel.levelCost, summed to the figure that sets a construction's duration",
            ["GetUpgradeCost"] = "KSP's UpgradeableFacility.GetUpgradeCost, the identical call ProcessUpgrade prices a facility upgrade with",
            ["HighLogic"] = "KSP's own game-state statics, resolved by the same Find as RP-1's types but belonging to Assembly-CSharp",
            ["LoadedSceneIsGame"] = "KSP's HighLogic.LoadedSceneIsGame, the condition ProcessUpgrade puts on the funds multiplier",
            ["CurrentGame"] = "KSP's HighLogic.CurrentGame, walked only to reach the career's funds multiplier",
            ["Parameters"] = "KSP's Game.Parameters, the same walk",
            ["Career"] = "KSP's GameParameters.Career, the same walk",
            ["FundsLossMultiplier"] = "KSP's CareerParams.FundsLossMultiplier, which scales what a facility has cost so far",
            ["ResearchAndDevelopment"] = "KSP's R&D scenario, resolved by the same Find as RP-1's types but belonging to Assembly-CSharp",
            ["GetTechnologyState"] = "KSP's ResearchAndDevelopment.GetTechnologyState, which is what RP-1's own facility tech gate asks",
            ["SpaceCenterFacility"] = "KSP's facility enum, parsed from the facility id because RP-1's own derivation takes a scene MonoBehaviour this command never has",
        };

        /// <summary>
        /// Single-word string literals on a reflection line that are not member
        /// names, so the coverage sweep can hold every other one to account.
        /// </summary>
        public static IReadOnlyDictionary<string, string> NotMemberNames { get; } = new Dictionary<string, string>
        {
            ["Hangar"] = "LaunchComplexType value the complex read compares against, not a member",
            ["HasClamps"] = "ClampsState value the launch gate compares against",
            ["Pad"] = "construction-kind label this Uplink stamps on a row",
            ["FacilityUpgrade"] = "construction-kind label this Uplink stamps on a row",
            ["LaunchComplex"] = "construction-kind label this Uplink stamps on a row",
            ["BuildList"] = "list name threaded through TryFindIn as an argument, and checked as a member of RP0.LaunchComplex",
            ["Warehouse"] = "list name threaded through TryFindIn as an argument, and checked as a member of RP0.LaunchComplex",
            ["managedSave"] = "a gate-fact id on this Uplink's own contract",
            ["integrated"] = "a gate-fact id on this Uplink's own contract",
            ["withinComplexLimits"] = "a gate-fact id on this Uplink's own contract",
            ["rolledOut"] = "a gate-fact id on this Uplink's own contract",
            ["funds"] = "a quantity label in a refusal payload",
        };

        private static Rp1MemberTarget[] BuildMembers()
        {
            var members = new List<Rp1MemberTarget>();

            void Add(string type, string member, Rp1Reader reader, string callSite, bool @static = false) =>
                members.Add(new Rp1MemberTarget(Rp0, type, member, reader, @static, callSite));

            void AddRo(string type, string member, Rp1Reader reader, string callSite) =>
                members.Add(new Rp1MemberTarget(RoUtils, type, member, reader, false, callSite));

            const string Sc = "Rp1ScReflection";
            const string Gate = "Rp1LaunchGate";
            const string Projects = "Rp1CareerProjectGate";
            const string Build = "Rp1BuildCommands";
            const string Start = "Rp1BuildStartCommands";
            const string Vehicles = "Rp1VehicleCommands";
            const string Withhold = "Rp1DerivedCurrencyWithholder";
            const string Economy = "Rp1EconomyBackend";
            const string Upkeep = "Rp1EconomyUpkeepQuery";
            const string Crew = "Rp1CrewReflection";
            const string Programs = "Rp1ProgramsReflection";
            const string Staffing = "Rp1PersonnelCommands";
            const string StrategyWrites = "Rp1StrategyWrites";
            const string Facilities = "Rp1FacilityUpgradeCommands";

            // ── The space centre ────────────────────────────────────────────
            Add("RP0.SpaceCenterManagement", "Instance", Rp1Reader.Presence, Sc + ", " + Gate + ", " + Projects + ", " + Build + ", " + Withhold + ", " + Facilities, @static: true);
            Add("RP0.SpaceCenterManagement", "enabledForSave", Rp1Reader.Bool, Sc + ", " + Gate + ", " + Projects + ", " + Build + ", " + Facilities);
            Add("RP0.SpaceCenterManagement", "IsSimulatedFlight", Rp1Reader.Bool, Sc);
            Add("RP0.SpaceCenterManagement", "Researchers", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterManagement", "Applicants", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterManagement", "KSCs", Rp1Reader.Presence, Sc + ", " + Gate + ", " + Build + ", " + Start);
            // WRITTEN, and the only write outside the currency withholder: the
            // same assignment RP-1's own overrideLC argument makes, and the whole
            // of how a vehicle is built somewhere other than the active complex.
            Add("RP0.VesselProject", "LCID", Rp1Reader.GuidWrite, Start);
            Add("RP0.SpaceCenterManagement", "ActiveSC", Rp1Reader.Presence, Sc + ", " + Facilities);

            // ── The two standing targets ────────────────────────────────────
            // Both project objects always EXIST, so presence says nothing about
            // whether an instruction stands; IsValid is what answers that, and
            // each defines it differently. A hire target is valid on a positive
            // headcount; a fund target is valid only when the figure DIFFERS from
            // the balance it was set at, so a target equal to the balance is not
            // a target at all.
            // ── The training courses, course-level ──────────────────────────
            // The seat bounds are the load-bearing pair: they decide whether an
            // operator is offered Cancel (the whole course) or Remove (one
            // student), because dropping below the minimum would strand the rest.
            Add("RP0.Crew.TrainingCourse", "Description", Rp1Reader.Text, Crew);
            Add("RP0.Crew.TrainingCourse", "SeatMin", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.TrainingCourse", "SeatMax", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.TrainingCourse", "IsTemporary", Rp1Reader.Bool, Crew);
            Add("RP0.SpaceCenterManagement", "staffTarget", Rp1Reader.Presence, Sc);
            Add("RP0.SpaceCenterManagement", "fundTarget", Rp1Reader.Presence, Sc);
            Add("RP0.HireStaffProject", "IsValid", Rp1Reader.Bool, Sc);
            Add("RP0.HireStaffProject", "NumLeftToHire", Rp1Reader.Numeric, Sc);
            Add("RP0.HireStaffProject", "CurrentAmount", Rp1Reader.Numeric, Sc);
            Add("RP0.HireStaffProject", "IsResearch", Rp1Reader.Bool, Sc);
            Add("RP0.HireStaffProject", "LCID", Rp1Reader.GuidText, Sc);
            Add("RP0.FundTargetProject", "IsValid", Rp1Reader.Bool, Sc);
            // PRIVATE, and read rather than derived because the figure the
            // operator committed to is not recoverable from anything public: the
            // fraction it feeds is the only public trace of it, and dividing back
            // out of that fraction cannot distinguish an unset target from one
            // already met.
            Add("RP0.FundTargetProject", "targetFunds", Rp1Reader.Numeric, Sc);
            Add("RP0.FundTargetProject", "origFunds", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterManagement", "TechList", Rp1Reader.Presence, Sc);
            Add("RP0.SpaceCenterManagement", "LCToEfficiency", Rp1Reader.Presence, Sc);

            // The second quantity RP-1 derives from a science credit, and the
            // reason it is written as well as read.
            Add("RP0.SpaceCenterManagement", "SciPointsTotal", Rp1Reader.NumericWrite, Withhold);

            Add("RP0.LCSpaceCenter", "KSCName", Rp1Reader.Text, Sc + ", " + Staffing);
            Add("RP0.LCSpaceCenter", "Engineers", Rp1Reader.Numeric, Sc);
            // DERIVED on RP-1's side: hired minus what the complexes hold. Read
            // rather than reproduced because it is the pool an assignment has to
            // fit inside, and a stale copy of it would let a write overdraw.
            Add("RP0.LCSpaceCenter", "UnassignedEngineers", Rp1Reader.Numeric, Staffing);
            Add("RP0.LCSpaceCenter", "LaunchComplexes", Rp1Reader.Presence, Sc + ", " + Gate + ", " + Build);
            Add("RP0.LCSpaceCenter", "FacilityUpgrades", Rp1Reader.Presence, Sc + ", " + Facilities);
            Add("RP0.LCSpaceCenter", "LCConstructions", Rp1Reader.Presence, Sc);
            Add("RP0.LCSpaceCenter", "AssociatedGroundStation", Rp1Reader.Text, Sc);

            Add("RP0.LaunchComplex", "ID", Rp1Reader.GuidText, Sc);
            Add("RP0.LaunchComplex", "Name", Rp1Reader.Text, Sc + ", " + Gate + ", " + Build + ", " + Staffing);
            Add("RP0.LaunchComplex", "LCType", Rp1Reader.EnumText, Sc + ", " + Gate);
            Add("RP0.LaunchComplex", "Engineers", Rp1Reader.Numeric, Sc + ", " + Staffing);
            Add("RP0.LaunchComplex", "MaxEngineers", Rp1Reader.Numeric, Sc + ", " + Staffing);
            Add("RP0.LaunchComplex", "IsRushing", Rp1Reader.Bool, Sc);
            Add("RP0.LaunchComplex", "IsOperational", Rp1Reader.Bool, Sc + ", " + Gate + ", " + Build + ", " + Staffing);
            // The owning centre, so an assignment can ask the pool it draws from.
            Add("RP0.LaunchComplex", "KSC", Rp1Reader.Presence, Staffing);
            Add("RP0.LaunchComplex", "ResourcesHandled", Rp1Reader.Presence, Sc);
            Add("RP0.LaunchComplex", "IsHumanRated", Rp1Reader.Bool, Sc + ", " + Gate);
            Add("RP0.LaunchComplex", "Rate", Rp1Reader.Numeric, Sc);
            // Operational pads, RP-1's own count, and the number its pad-dismantle
            // rule is stated against. Not the same question as the LaunchPads list
            // below, which is every pad the complex has.
            Add("RP0.LaunchComplex", "LaunchPadCount", Rp1Reader.Numeric, Sc);
            Add("RP0.LaunchComplex", "MassMin", Rp1Reader.Numeric, Sc + ", " + Gate);
            Add("RP0.LaunchComplex", "MassMax", Rp1Reader.Numeric, Sc + ", " + Gate);
            // The renovation envelope's basis. A rename here takes the envelope
            // off the wire; it must never leave a zero behind it.
            Add("RP0.LaunchComplex", "MassOrig", Rp1Reader.Numeric, Sc);
            Add("RP0.LaunchComplex", "SizeMax", Rp1Reader.Presence, Sc + ", " + Gate);
            Add("RP0.LaunchComplex", "LaunchPads", Rp1Reader.Presence, Sc + ", " + Gate);
            Add("RP0.LaunchComplex", "BuildList", Rp1Reader.Presence, Sc + ", " + Gate + ", " + Build);
            Add("RP0.LaunchComplex", "Warehouse", Rp1Reader.Presence, Sc + ", " + Gate + ", " + Build);
            Add("RP0.LaunchComplex", "Recon_Rollout", Rp1Reader.Presence, Sc + ", " + Gate);
            Add("RP0.LaunchComplex", "VesselRepairs", Rp1Reader.Presence, Sc);
            Add("RP0.LaunchComplex", "PadConstructions", Rp1Reader.Presence, Sc);

            Add("RP0.LCLaunchPad", "id", Rp1Reader.GuidText, Sc);
            Add("RP0.LCLaunchPad", "name", Rp1Reader.Text, Sc + ", " + Gate);
            Add("RP0.LCLaunchPad", "launchSiteName", Rp1Reader.Text, Sc);
            Add("RP0.LCLaunchPad", "level", Rp1Reader.Numeric, Sc);
            Add("RP0.LCLaunchPad", "fractionalLevel", Rp1Reader.Numeric, Sc);
            Add("RP0.LCLaunchPad", "State", Rp1Reader.EnumText, Sc);
            Add("RP0.LCLaunchPad", "isOperational", Rp1Reader.Bool, Gate);
            Add("RP0.LCLaunchPad", "IsDestroyed", Rp1Reader.Bool, Gate);

            Add("RP0.LCEfficiency", "MaxEfficiency", Rp1Reader.Numeric, Sc, @static: true);
            Add("RP0.LCEfficiency", "Efficiency", Rp1Reader.Numeric, Sc);
            // The complexes attached to one record, which is what makes a shared
            // efficiency visible. The LIVE list, not the persisted _lcIDs beside
            // it: relinking prunes ids whose complex is gone, so the persisted one
            // can name a complex that is on no other channel.
            Add("RP0.LCEfficiency", "_lcs", Rp1Reader.Presence, Sc);

            Add("RP0.Database", "SettingsSC", Rp1Reader.Presence, Sc + ", " + Economy, @static: true);
            Add("RP0.Database", "SettingsCrew", Rp1Reader.Presence, Crew, @static: true);
            Add("RP0.SpaceCenterSettings", "RushRateMult", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterSettings", "RushSalaryMult", Rp1Reader.Numeric, Sc);
            // Ints on RP-1's side, which Numeric accepts: a full year per head.
            Add("RP0.SpaceCenterSettings", "salaryEngineers", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterSettings", "salaryResearchers", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterSettings", "EngineerIdleSalaryMult", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterSettings", "repPortionLostPerDay", Rp1Reader.Numeric, Economy);

            // ── Vehicles ────────────────────────────────────────────────────
            Add("RP0.VesselProject", "KCTPersistentID", Rp1Reader.Text, Sc + ", " + Build);
            // A memoising PROPERTY over AreAllPartsValid, and pure to READ: the
            // memoisation happens on the first read, which RP-1's own window has
            // already done for any vehicle it has drawn. Read rather than
            // reproduced because the part list it walks is not reachable here.
            Add("RP0.VesselProject", "AllPartsValid", Rp1Reader.Bool, Sc + ", " + Vehicles);
            Add("RP0.VesselProject", "shipName", Rp1Reader.Text, Sc + ", " + Gate);
            Add("RP0.VesselProject", "shipID", Rp1Reader.GuidText, Gate);
            Add("RP0.VesselProject", "launchSite", Rp1Reader.Text, Sc);
            Add("RP0.VesselProject", "cost", Rp1Reader.Numeric, Sc);
            Add("RP0.VesselProject", "mass", Rp1Reader.Numeric, Sc + ", " + Gate);
            Add("RP0.VesselProject", "humanRated", Rp1Reader.Bool, Sc + ", " + Gate);
            Add("RP0.VesselProject", "Type", Rp1Reader.EnumText, Sc);
            Add("RP0.VesselProject", "clampState", Rp1Reader.EnumText, Gate);
            Add("RP0.VesselProject", "progress", Rp1Reader.Numeric, Sc);
            Add("RP0.VesselProject", "buildPoints", Rp1Reader.Numeric, Sc);
            Add("RP0.VesselProject", "ShipSize", Rp1Reader.Presence, Gate);

            // Both PRIVATE on the real type, which is the point: a walk that only
            // looked at public members would find neither, and the build rate is
            // reached from the private backing field precisely to avoid the getter
            // that writes to the save.
            Add("RP0.VesselProject", "_buildRate", Rp1Reader.Numeric, Sc);
            Add("RP0.VesselProject", "ShipNodeCompressed", Rp1Reader.Presence, Build);

            // ── Launch-complex operations ───────────────────────────────────
            // Declared per CONCRETE type rather than once on LCOpsProject, because
            // production meets the concrete instance and resolves through the base
            // chain. A member that moved down into one subclass would still pass a
            // check written against the base.
            foreach (var ops in new[] { "RP0.ReconRolloutProject", "RP0.VesselRepairProject" })
            {
                Add(ops, "BP", Rp1Reader.Numeric, Sc + ", " + Gate);
                Add(ops, "progress", Rp1Reader.Numeric, Sc + ", " + Gate);
                Add(ops, "cost", Rp1Reader.Numeric, Sc);
                Add(ops, "associatedID", Rp1Reader.Text, Sc + ", " + Gate);
                Add(ops, "launchPadID", Rp1Reader.Text, Sc + ", " + Gate);
                Add(ops, "IsBlocking", Rp1Reader.Bool, Sc);
                Add(ops, "IsReversed", Rp1Reader.Bool, Sc + ", " + Gate);
                Add(ops, "_buildRate", Rp1Reader.Numeric, Sc);
            }

            // Recon and rollback share one type and one kind field; a vessel repair
            // has no kind at all, so it is not claimed here.
            Add("RP0.ReconRolloutProject", "RRType", Rp1Reader.EnumText, Sc + ", " + Gate);

            // ── Construction ────────────────────────────────────────────────
            foreach (var construction in new[]
                     {
                         "RP0.FacilityUpgradeProject",
                         "RP0.LCConstructionProject",
                         "RP0.PadConstructionProject",
                     })
            {
                Add(construction, "progress", Rp1Reader.Numeric, Sc);
                Add(construction, "workRate", Rp1Reader.Numeric, Sc);
                Add(construction, "_buildRate", Rp1Reader.Numeric, Sc);
                Add(construction, "name", Rp1Reader.Text, Sc);
                Add(construction, "spentCost", Rp1Reader.Numeric, Sc);
                Add(construction, "spentRushCost", Rp1Reader.Numeric, Sc);
            }

            // BP and cost are lifted out of that loop for the facility upgrade
            // alone, because it is the one construction kind this Uplink WRITES.
            // Queueing one sets the price and reads back the build points the
            // duration formula derived, so both are settable-or-readable claims
            // the other two kinds do not make.
            Add("RP0.FacilityUpgradeProject", "cost", Rp1Reader.NumericWrite, Sc + ", " + Facilities);
            Add("RP0.FacilityUpgradeProject", "BP", Rp1Reader.Numeric, Sc + ", " + Facilities);
            Add("RP0.LCConstructionProject", "cost", Rp1Reader.Numeric, Sc);
            Add("RP0.LCConstructionProject", "BP", Rp1Reader.Numeric, Sc);
            Add("RP0.PadConstructionProject", "cost", Rp1Reader.Numeric, Sc);
            Add("RP0.PadConstructionProject", "BP", Rp1Reader.Numeric, Sc);

            // The event an enqueue announces itself on. Presence only: it is
            // KSP's EventData, whose Fire is matched by arity on whatever the
            // member hands back, and it is the one member on this path whose
            // absence is not fatal (the queue is still written, unannounced).
            Add("RP0.SCMEvents", "OnFacilityUpgradeQueued", Rp1Reader.Presence, Facilities, @static: true);

            Add("RP0.FacilityUpgradeProject", "FacilityType", Rp1Reader.EnumText, Sc);
            Add("RP0.FacilityUpgradeProject", "currentLevel", Rp1Reader.Numeric, Sc);
            Add("RP0.FacilityUpgradeProject", "upgradeLevel", Rp1Reader.Numeric, Sc);
            Add("RP0.LCConstructionProject", "lcID", Rp1Reader.GuidText, Sc);
            Add("RP0.LCConstructionProject", "isModify", Rp1Reader.Bool, Sc);
            Add("RP0.LCConstructionProject", "engineersToReadd", Rp1Reader.Numeric, Sc);
            Add("RP0.PadConstructionProject", "id", Rp1Reader.GuidText, Sc);

            // ── Research ────────────────────────────────────────────────────
            Add("RP0.ResearchProject", "techID", Rp1Reader.Text, Sc);
            Add("RP0.ResearchProject", "techName", Rp1Reader.Text, Sc);
            Add("RP0.ResearchProject", "scienceCost", Rp1Reader.Numeric, Sc);
            Add("RP0.ResearchProject", "progress", Rp1Reader.Numeric, Sc);
            Add("RP0.ResearchProject", "workRate", Rp1Reader.Numeric, Sc);
            Add("RP0.ResearchProject", "_buildRate", Rp1Reader.Numeric, Sc);
            Add("RP0.ResearchProject", "startYear", Rp1Reader.Numeric, Sc);
            Add("RP0.ResearchProject", "endYear", Rp1Reader.Numeric, Sc);

            // ── Confidence, and the balance the withholder puts back ────────
            Add("RP0.Confidence", "Instance", Rp1Reader.Presence, Sc + ", " + Withhold, @static: true);
            Add("RP0.Confidence", "confidence", Rp1Reader.NumericWrite, Sc + ", " + Withhold);
            Add("RP0.Confidence", "confidenceEarned", Rp1Reader.NumericWrite, Sc + ", " + Withhold);

            // RP-1's only push channel to its own confidence readout. A balance
            // put back without firing this leaves the leaked figure on screen, so
            // the field going missing is a display bug with a correct state
            // behind it, which is the hardest kind to notice.
            Add("RP0.Confidence", "OnConfidenceChanged", Rp1Reader.Presence, Withhold, @static: true);

            // ── The money model ────────────────────────────────────────────
            Add("RP0.MaintenanceHandler", "Instance", Rp1Reader.Presence, Economy + ", " + Upkeep + ", " + Sc, @static: true);
            Add("RP0.MaintenanceHandler", "UpkeepPerDayForDisplay", Rp1Reader.Numeric, Economy + ", " + Upkeep);
            Add("RP0.MaintenanceHandler", "FacilityUpkeepPerDay", Rp1Reader.Numeric, Economy + ", " + Upkeep);
            Add("RP0.MaintenanceHandler", "LCsCostPerDay", Rp1Reader.Numeric, Economy + ", " + Upkeep);
            Add("RP0.MaintenanceHandler", "ResearchSalaryPerDay", Rp1Reader.Numeric, Economy + ", " + Upkeep + ", " + Sc);
            Add("RP0.MaintenanceHandler", "TrainingUpkeepPerDay", Rp1Reader.Numeric, Economy + ", " + Upkeep);
            Add("RP0.MaintenanceHandler", "NautBaseUpkeepPerDay", Rp1Reader.Numeric, Economy + ", " + Upkeep);
            Add("RP0.MaintenanceHandler", "NautInFlightUpkeepPerDay", Rp1Reader.Numeric, Economy + ", " + Upkeep);
            Add("RP0.MaintenanceHandler", "IntegrationSalaryPerDay", Rp1Reader.Numeric, Economy + ", " + Upkeep + ", " + Sc);
            Add("RP0.MaintenanceHandler+SubsidyDetails", "subsidy", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler+SubsidyDetails", "minSubsidy", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler+SubsidyDetails", "maxSubsidy", Rp1Reader.Numeric, Economy);
            Add("RP0.UnlockCreditHandler", "Instance", Rp1Reader.Presence, Economy, @static: true);
            Add("RP0.UnlockCreditHandler", "TotalCredit", Rp1Reader.Numeric, Economy);

            // ── Crew ───────────────────────────────────────────────────────
            Add("RP0.Crew.CrewHandler", "Instance", Rp1Reader.Presence, Crew, @static: true);
            Add("RP0.Crew.CrewHandler", "RetirementEnabled", Rp1Reader.Bool, Crew);
            Add("RP0.Crew.CrewHandler", "CrewRnREnabled", Rp1Reader.Bool, Crew);
            Add("RP0.Crew.CrewHandler", "IsMissionTrainingEnabled", Rp1Reader.Bool, Crew);
            Add("RP0.Crew.CrewHandler", "ProfTrainRate", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.CrewHandler", "MissionTrainRate", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.CrewHandler", "TrainingCourses", Rp1Reader.Presence, Crew);

            // Four PRIVATE collections, walked as bare enumerables and probed
            // rather than copied. Private is what the walk assumes, and a walk
            // restricted to public members would find none of them.
            Add("RP0.Crew.CrewHandler", "_retirees", Rp1Reader.Presence, Crew);
            Add("RP0.Crew.CrewHandler", "_retireTimes", Rp1Reader.Presence, Crew);
            Add("RP0.Crew.CrewHandler", "_retireIncreases", Rp1Reader.Presence, Crew);
            Add("RP0.Crew.CrewHandler", "_expireTimes", Rp1Reader.Presence, Crew);

            Add("RP0.CrewSettings", "retireIncreaseCap", Rp1Reader.Numeric, Crew);

            Add("RP0.Crew.TrainingCourse", "id", Rp1Reader.Text, Crew);
            Add("RP0.Crew.TrainingCourse", "Target", Rp1Reader.Text, Crew);
            Add("RP0.Crew.TrainingCourse", "Type", Rp1Reader.EnumText, Crew);
            Add("RP0.Crew.TrainingCourse", "Started", Rp1Reader.Bool, Crew);
            Add("RP0.Crew.TrainingCourse", "Completed", Rp1Reader.Bool, Crew);
            Add("RP0.Crew.TrainingCourse", "progress", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.TrainingCourse", "BP", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.TrainingCourse", "_buildRate", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.TrainingCourse", "Students", Rp1Reader.Presence, Crew);

            Add("RP0.Crew.TrainingExpiration", "pcmName", Rp1Reader.Text, Crew);
            Add("RP0.Crew.TrainingExpiration", "expiration", Rp1Reader.Numeric, Crew);
            Add("RP0.Crew.TrainingExpiration", "training", Rp1Reader.Presence, Crew);
            Add("RP0.Crew.TrainingFlightEntry", "target", Rp1Reader.Text, Crew);

            // ── Programs ───────────────────────────────────────────────────
            Add("RP0.Programs.ProgramHandler", "Instance", Rp1Reader.Presence, Programs + ", " + StrategyWrites, @static: true);
            // NOT a UI flag, despite reading like one. It is RP-1's
            // fresh-activation-vs-restore discriminator: Strategy.Load() ends with
            // `isActive = true; Register();`, so OnRegister runs again on every
            // scene transition, and without this test a Program would re-Accept
            // several times a session, re-charging Confidence and resetting its
            // deadline each time. Read and branched on, NEVER assumed false: with
            // the screen open, PerformActivate's own Register() performs the
            // program half itself, and a caller that also performs it accepts
            // twice.
            Add("RP0.Programs.ProgramHandler", "IsInAdmin", Rp1Reader.Bool, StrategyWrites);
            // The TEMPLATE before acceptance and the accepted copy after. Accept()
            // assigns deadlineUT on the new instance it returns, never on the
            // template, so anything reading it too early gets zero, which is how
            // a KAC alarm ends up minted at UT 0.
            Add("RP0.Programs.ProgramStrategy", "Program", Rp1Reader.Presence, StrategyWrites);
            Add("RP0.Programs.ProgramHandler", "Programs", Rp1Reader.Presence, Programs, @static: true);
            Add("RP0.Programs.ProgramHandler", "Settings", Rp1Reader.Presence, Programs, @static: true);
            Add("RP0.Programs.ProgramHandler", "ProgramModifiers", Rp1Reader.Presence, Programs, @static: true);
            Add("RP0.Programs.ProgramHandler", "ActivePrograms", Rp1Reader.Presence, Programs);
            Add("RP0.Programs.ProgramHandler", "CompletedPrograms", Rp1Reader.Presence, Programs);
            Add("RP0.Programs.ProgramHandler", "DisabledPrograms", Rp1Reader.Presence, Programs);
            Add("RP0.Programs.ProgramHandler", "MaxProgramSlots", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.ProgramHandler", "ActiveProgramSlots", Rp1Reader.Numeric, Programs);

            Add("RP0.Programs.ProgramHandlerSettings", "defaultFundingCurve", Rp1Reader.Text, Programs);
            Add("RP0.Programs.ProgramHandlerSettings", "paymentCurves", Rp1Reader.Presence, Programs);

            Add("RP0.Programs.Program", "name", Rp1Reader.Text, Programs);
            Add("RP0.Programs.Program", "title", Rp1Reader.Text, Programs);
            Add("RP0.Programs.Program", "isDisabled", Rp1Reader.Bool, Programs);
            Add("RP0.Programs.Program", "isHSF", Rp1Reader.Bool, Programs);
            Add("RP0.Programs.Program", "slots", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "speed", Rp1Reader.EnumText, Programs);
            Add("RP0.Programs.Program", "nominalDurationYears", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "acceptedUT", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "deadlineUT", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "objectivesCompletedUT", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "completedUT", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "lastPaymentUT", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "fracElapsed", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "fundingCurve", Rp1Reader.Text, Programs);
            Add("RP0.Programs.Program", "baseFunding", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "TotalFunding", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "fundsPaidOut", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "repDeltaOnCompletePerYearEarly", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "repPenaltyPerYearLate", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "repPenaltyAssessed", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.Program", "AllRequirementsMet", Rp1Reader.Bool, Programs);
            Add("RP0.Programs.Program", "AllObjectivesMet", Rp1Reader.Bool, Programs);
            Add("RP0.Programs.Program", "CanAccept", Rp1Reader.Bool, Programs);
            Add("RP0.Programs.Program", "CanComplete", Rp1Reader.Bool, Programs);
            Add("RP0.Programs.Program", "requirementsPrettyText", Rp1Reader.Text, Programs);
            Add("RP0.Programs.Program", "objectivesPrettyText", Rp1Reader.Text, Programs);
            Add("RP0.Programs.Program", "programsToDisableOnAccept", Rp1Reader.Presence, Programs);
            Add("RP0.Programs.Program", "confidenceCosts", Rp1Reader.Presence, Programs);

            Add("RP0.Programs.ProgramModifier", "srcProgram", Rp1Reader.Text, Programs);
            Add("RP0.Programs.ProgramModifier", "tgtProgram", Rp1Reader.Text, Programs);
            Add("RP0.Programs.ProgramModifier", "nominalDurationYears", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.ProgramModifier", "baseFunding", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.ProgramModifier", "fundingCurve", Rp1Reader.Text, Programs);
            Add("RP0.Programs.ProgramModifier", "repDeltaOnCompletePerYearEarly", Rp1Reader.Numeric, Programs);
            Add("RP0.Programs.ProgramModifier", "repPenaltyPerYearLate", Rp1Reader.Numeric, Programs);

            // ── The research queue's write half ─────────────────────────────
            const string Research = "Rp1ResearchCommands";

            // Whether RP-1 queues research in this save at all, which its own
            // Harmony prefix asks before anything else. All three have to hold or
            // the prefix lets the stock instant unlock through, and a project
            // queued in that save is one nothing will work through.
            Add("RP0.PresetManager", "Instance", Rp1Reader.Presence, Research, @static: true);
            Add("RP0.PresetManager", "ActivePreset", Rp1Reader.Presence, Research);
            Add("RP0.KCT_Preset", "GeneralSettings", Rp1Reader.Presence, Research);
            Add("RP0.KCT_Preset_General", "Enabled", Rp1Reader.Bool, Research);
            Add("RP0.KCT_Preset_General", "TechUnlockTimes", Rp1Reader.Bool, Research);
            Add("RP0.KCT_Preset_General", "BuildTimes", Rp1Reader.Bool, Research);

            // The era table, and the two ints out of it that decide a node's
            // research RATE. A wrong pair here is the quietest failure this
            // command has: the node queues, it is charged correctly, and it
            // researches at the wrong speed for the rest of the career.
            Add("RP0.Database", "TechNodePeriods", Rp1Reader.Presence, Research, @static: true);
            Add("RP0.TechPeriod", "startYear", Rp1Reader.Numeric, Research);
            Add("RP0.TechPeriod", "endYear", Rp1Reader.Numeric, Research);

            Add("RP0.SpaceCenterManagement", "Instance", Rp1Reader.Presence, Research, @static: true);
            Add("RP0.SpaceCenterManagement", "enabledForSave", Rp1Reader.Bool, Research);
            Add("RP0.SpaceCenterManagement", "TechList", Rp1Reader.Presence, Research);

            // ── ROUtils, which ships beside RP-1 and owns these two shapes ──
            AddRo("ROUtils.HermiteCurve+Key", "time", Rp1Reader.Numeric, Programs);
            AddRo("ROUtils.HermiteCurve+Key", "value", Rp1Reader.Numeric, Programs);
            AddRo("ROUtils.HermiteCurve+Key", "inTangent", Rp1Reader.Numeric, Programs);
            AddRo("ROUtils.HermiteCurve+Key", "outTangent", Rp1Reader.Numeric, Programs);
            AddRo("ROUtils.DataTypes.PersistentCompressedCraftNode", "IsEmpty", Rp1Reader.Bool, Build);

            return members.ToArray();
        }

        /// <summary>Every member name the manifest claims, for the coverage sweep.</summary>
        public static IReadOnlySet<string> MemberNames { get; } =
            Members.Select(m => m.Member)
                .Concat(Methods.Select(m => m.Method))
                .Concat(EnumMembers.Select(m => m.Member))
                .ToHashSet();
    }
}
