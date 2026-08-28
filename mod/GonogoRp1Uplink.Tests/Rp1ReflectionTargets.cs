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
    public sealed record Rp1MethodTarget(
        string Assembly,
        string Type,
        string Method,
        int Arity,
        bool Static,
        string CallSite);

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
            new Rp1TypeTarget(Rp0, "RP0.LCEfficiency", "Rp1ScReflection"),
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
            new Rp1TypeTarget(Rp0, "RP0.Crew.CrewHandler", "Rp1CrewReflection"),
            new Rp1TypeTarget(Rp0, "RP0.Programs.ProgramHandler", "Rp1ProgramsReflection"),
        };

        public static IReadOnlyList<Rp1EnumMemberTarget> EnumMembers { get; } = new[]
        {
            new Rp1EnumMemberTarget(Rp0, "RP0.TransactionReasonsRP0", "VesselPurchase", "Rp1Pricing"),
            new Rp1EnumMemberTarget(Rp0, "RP0.CurrencyRP0", "Funds", "Rp1Pricing"),
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
        };

        public static IReadOnlyList<Rp1MethodTarget> Methods { get; } = new[]
        {
            new Rp1MethodTarget(Rp0, "RP0.LCEfficiency", "PredictWeightedEfficiency", 5, false, "Rp1ScReflection"),
            new Rp1MethodTarget(Rp0, "RP0.MaintenanceHandler", "FillSubsidyDetails", 3, true, "Rp1EconomyBackend"),
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
            new Rp1MethodTarget(Rp0, "RP0.SpaceCenterManagement", "GetEffectiveEngineersForSalary", 1, false, "Rp1ScReflection"),
            new Rp1MethodTarget(Rp0, "RP0.SpaceCenterManagement", "GetEffectiveIntegrationEngineersForSalary", 1, false, "Rp1ScReflection"),
        };

        public static IReadOnlyList<Rp1MemberTarget> Members { get; } = BuildMembers();

        /// <summary>
        /// Members the walk reaches that RP-1 does not own, so this guard cannot
        /// check them. Listed rather than omitted: an unlisted name would look
        /// like a manifest that had drifted, and the coverage test would say so.
        /// </summary>
        public static IReadOnlyDictionary<string, string> OutOfScope { get; } = new Dictionary<string, string>
        {
            ["Fire"] = "KSP's EventData<T1,T2>.Fire, reached off Confidence.OnConfidenceChanged, and matched by arity and first parameter type rather than by name alone",
            ["Funds"] = "KSP's Funding.Funds, read only to put a balance beside a refusal (and also the name of RP0.CurrencyRP0.Funds, which IS checked)",
            ["Instance"] = "checked on every RP-1 handler that has one; ALSO KSP's Funding.Instance, which is not RP-1's to guard",
            ["Funding"] = "KSP's own career balance type, resolved by the same Find as RP-1's types but belonging to Assembly-CSharp",
            ["vesselName"] = "KSP's Vessel.vesselName, read off the craft LCLaunchPad.HasVesselWaitingToBeLaunched hands back so a refusal can name it",
            ["Add"] = "the list's own Add, on ROUtils.DataTypes.PersistentObservableList<T> from a separate assembly, resolved by arity on whatever collection LaunchComplex.Recon_Rollout hands back rather than named on an RP-1 type",
            ["name"] = "checked on RP-1's own types; ALSO KSP's ProtoCrewMember.name, read off the students in a training course",
            ["x"] = "UnityEngine.Vector3, read off LaunchComplex.SizeMax and VesselProject.ShipSize",
            ["y"] = "UnityEngine.Vector3, read off LaunchComplex.SizeMax and VesselProject.ShipSize",
            ["z"] = "UnityEngine.Vector3, read off LaunchComplex.SizeMax and VesselProject.ShipSize",
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
            const string Crew = "Rp1CrewReflection";
            const string Programs = "Rp1ProgramsReflection";
            const string Staffing = "Rp1PersonnelCommands";

            // ── The space centre ────────────────────────────────────────────
            Add("RP0.SpaceCenterManagement", "Instance", Rp1Reader.Presence, Sc + ", " + Gate + ", " + Projects + ", " + Build + ", " + Withhold, @static: true);
            Add("RP0.SpaceCenterManagement", "enabledForSave", Rp1Reader.Bool, Sc + ", " + Gate + ", " + Projects + ", " + Build);
            Add("RP0.SpaceCenterManagement", "IsSimulatedFlight", Rp1Reader.Bool, Sc);
            Add("RP0.SpaceCenterManagement", "Researchers", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterManagement", "Applicants", Rp1Reader.Numeric, Sc);
            Add("RP0.SpaceCenterManagement", "KSCs", Rp1Reader.Presence, Sc + ", " + Gate + ", " + Build + ", " + Start);
            // WRITTEN, and the only write outside the currency withholder: the
            // same assignment RP-1's own overrideLC argument makes, and the whole
            // of how a vehicle is built somewhere other than the active complex.
            Add("RP0.VesselProject", "LCID", Rp1Reader.GuidWrite, Start);
            Add("RP0.SpaceCenterManagement", "ActiveSC", Rp1Reader.Presence, Sc);
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
            Add("RP0.LCSpaceCenter", "FacilityUpgrades", Rp1Reader.Presence, Sc);
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
            Add("RP0.LaunchComplex", "MassMin", Rp1Reader.Numeric, Sc + ", " + Gate);
            Add("RP0.LaunchComplex", "MassMax", Rp1Reader.Numeric, Sc + ", " + Gate);
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
                Add(construction, "BP", Rp1Reader.Numeric, Sc);
                Add(construction, "workRate", Rp1Reader.Numeric, Sc);
                Add(construction, "_buildRate", Rp1Reader.Numeric, Sc);
                Add(construction, "name", Rp1Reader.Text, Sc);
                Add(construction, "cost", Rp1Reader.Numeric, Sc);
                Add(construction, "spentCost", Rp1Reader.Numeric, Sc);
                Add(construction, "spentRushCost", Rp1Reader.Numeric, Sc);
            }

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
            Add("RP0.MaintenanceHandler", "Instance", Rp1Reader.Presence, Economy + ", " + Sc, @static: true);
            Add("RP0.MaintenanceHandler", "UpkeepPerDayForDisplay", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler", "FacilityUpkeepPerDay", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler", "LCsCostPerDay", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler", "ResearchSalaryPerDay", Rp1Reader.Numeric, Economy + ", " + Sc);
            Add("RP0.MaintenanceHandler", "TrainingUpkeepPerDay", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler", "NautBaseUpkeepPerDay", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler", "NautInFlightUpkeepPerDay", Rp1Reader.Numeric, Economy);
            Add("RP0.MaintenanceHandler", "IntegrationSalaryPerDay", Rp1Reader.Numeric, Economy + ", " + Sc);
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
            Add("RP0.Programs.ProgramHandler", "Instance", Rp1Reader.Presence, Programs, @static: true);
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
