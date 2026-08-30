// Putting a tech node on RP-1's research queue. No compile-time reference to
// RP0.dll, the same arm's-length reflection pattern as Rp1ScReflection, whose
// header carries the provenance rules this file follows.
//
// WHAT WAS WRONG WITHOUT IT. Rp1CareerProjectGate REFUSES career.tech.unlock
// under a managed save, and is right to: core's handler calls
// ResearchAndDevelopment.UnlockProtoTechNode, nothing of RP-1's patches that, so
// the stock write walks straight past RP-1's model and hands the career a node
// it never researched at a price RP-1 never quoted. The refusal names a queue
// the operator is meant to start the job on instead, and until now there was no
// way to start it from here at all: rp1.research published the queue and nothing
// could add to it. This is the command that gate defers to.
//
// THE ROUTE: ResearchProject.Load(ConfigNode), NOT a minted RDTech.
//
// RP-1 itself mints a throwaway RDTech on a bare GameObject inside
// ResearchProject.IncrementProgress (three field writes, Warmup(), destroy) to
// fire an event whose payload has to be one. Copying that and calling the real
// ResearchProject(RDTech) constructor is the obvious route and it is the wrong
// one. That constructor reads FOUR fields off the node and RP-1's mint writes
// THREE: nothing sets `title`, Warmup() sets only partsAssigned/partsPurchased,
// and Start() never runs because Unity schedules it for the next frame and the
// object is destroyed in the same call. The result would persist techName = null
// into the save. RP-1 gets away with three fields because its node is a CARRIER
// FOR AN EVENT; ours would be an ARGUMENT TO A CONSTRUCTOR, a different job with
// a longer read-list. RDTech.techState is private besides, and RP-1 only assigns
// it because it compiles against a publicised Assembly-CSharp.
//
// The deciding criterion is the FAILURE MODE. Load(ConfigNode) fails as a
// CHECKLIST: assert every [Persistent] key is present in the node we author,
// seven, all declared on one class, and Rp1InstalledCompatibilityTests reads
// that list off the SHIPPED assembly rather than trusting this comment. The mint
// fails as a reading-comprehension test over the constructor AND Warmup() AND
// every future edit to either. Prefer the construction path whose failure mode
// can be enumerated.
//
// Load is RP-1's OWN deserialiser and is public. We author a ConfigNode; the
// game reconstructs the object. No RP-1 arithmetic is reproduced here.
//
// THE PROCEDURE, in the order RP0.Harmony.PatchRDTech.Prefix_UnlockTech and
// RDTech.ResearchTech run it between them:
//
//   the preset arm   Prefix_UnlockTech returns TRUE, i.e. lets the stock unlock
//                    proceed, unless GeneralSettings.Enabled, .TechUnlockTimes
//                    and .BuildTimes all hold. In a save where they do not, a
//                    queued project is a state RP-1's own patch declines to
//                    produce, so this refuses rather than enqueuing one
//   the tree         the ProtoTechNode for the techID, off
//                    AssetBase.RnDTechTree.GetTreeTechs()
//   already done     GetTechnologyState == Available, which is what UnlockTech
//                    sets and therefore means RESEARCHED here
//   already queued   SpaceCenterManagement.TechListHas, asked BEFORE the charge,
//                    or a double press double-spends
//   affordability    CurrencyModifierQueryRP0.RunQuery(RnDTechResearch, ...)
//                    .CanAfford(Science), which is exactly what the stock
//                    CurrencyModifierQuery.RunQuery inside ResearchTech BECOMES
//                    under RP-1's PatchCMQ prefix
//   the ceiling      GameVariables.GetScienceCostLimit at the R&D building's
//                    normalised level, in ResearchTech's own order, after
//                    affordability and before the charge
//   the charge       ResearchAndDevelopment.Instance.AddScience(-cost,
//                    RnDTechResearch), a method RP-1 prefixes with its own body.
//                    The charge happens AT ENQUEUE, not on completion
//   the enlistment   TechList.Add, UpdateBuildRate(Count - 1),
//                    KCTUtilities.AddNodePartsToExperimental
//
// ONE DEPARTURE FROM THAT ORDER, and it is within the same route rather than a
// change of it: the ResearchProject is CONSTRUCTED before the science is
// charged, not after. Nothing in constructing it touches the game (the
// parameterless constructor sets three fields, Load parses the node we just
// wrote), so moving it above the charge costs nothing and means the only steps
// between money leaving and the node being queued are Add and two calls that
// cannot fail on their own account. The unavoidable residue is stated where it
// happens: if the Add throws, the science is gone and the queue is empty, and
// the refusal says so rather than reading as "nothing happened".
//
// TWO THINGS THE ROUTE MAKES US AUTHOR, and both are read from the LIVE game
// rather than from the tree asset:
//
//   state   ResearchAndDevelopment.GetTechnologyState(techID) is the player's
//           state. The ProtoTechNode hanging off AssetBase.RnDTechTree carries
//           the CONFIG DEFAULT and would be a different question answered
//           confidently. Under this route the field is a decision we make, which
//           is the advantage of the route: it can be sourced correctly
//   parts    the live ProtoTechNode's partsPurchased, written out as the `part`
//           values ProtoTechNode(ConfigNode) reads back. RP-1's own constructor
//           reaches the same list through RDTech.Start's alias of it
//
// WHAT THE `part` VALUES DO AND DO NOT REPRODUCE. RP-1's constructor ALIASES the
// live parts list, so a part bought while the node sits in the queue is still on
// the project's ProtoNode when it completes. Ours is a fresh list holding the
// same names, so a purchase made after this command runs is not on it. That is
// not a divergence from RP-1: ResearchProject.Load is RP-1's own load path, it
// builds `new ProtoTechNode(node.GetNode("ProtoNode"))` every time, and so any
// queued project that has survived one save/load in a normal game is already
// detached exactly this way. Reproducing the alias would give this command an
// object identity RP-1's own round-trip does not have.
//
// THE ONE GAP, MEASURED AND ACCEPTED. SCMEvents.OnTechQueued is an
// EventData<RDTech> and this route has no RDTech to fire it with. It is fired in
// exactly one place in the shipped RP0.dll and RP-1 SUBSCRIBES TO IT NOWHERE: it
// is a public extension point for third parties. So a third-party listener will
// NOT hear a research queued by this command. Bounded, and named here rather
// than left to be discovered.
//
// THE BALANCE IS ALREADY ON THE WIRE, which is what lets a control that spends
// science show it: core publishes career.status.economy.science (the banked
// balance, off ResearchAndDevelopment.Science) and career.status.tech.nodes[]
// with each node's scienceCost and live unlocked flag. The cost published there
// is the same integer this command charges, because RP-1 neither re-prices a
// node nor stores a cost of its own: ResearchProject.scienceCost is assigned
// straight from the tree. A refusal carries both figures again as a LimitBreach,
// for the case where the operator's view was stale.
//
// WHAT IS READ, and why each is safe:
//
//   SpaceCenterManagement.Instance / .enabledForSave
//                                    the same two reads Rp1ScReflection opens
//                                    with, vouched for there
//   SpaceCenterManagement.TechList   the queue Rp1ScReflection already walks
//   PresetManager.Instance / .ActivePreset / KCT_Preset.GeneralSettings
//                                    plain fields and one auto-property
//   KCT_Preset_General.Enabled / .TechUnlockTimes / .BuildTimes
//                                    plain public bools
//   Database.TechNodePeriods         public static readonly, a
//                                    Dictionary<string, TechPeriod> underneath,
//                                    walked as a bare IEnumerable so no cast to
//                                    a generic from another assembly is taken
//   TechPeriod.startYear / .endYear  plain ints; they feed YearBasedRateMult and
//                                    therefore the RATE, so a wrong pair makes a
//                                    node research at the wrong speed silently.
//                                    A missing key leaves them at 0, which is
//                                    what RP-1's own TryGetValue miss does
//   ResearchAndDevelopment.Instance / .Science / .GetTechState / .GetTechnologyState
//   ResearchAndDevelopment.GetTechnologyTitle
//   AssetBase.RnDTechTree / RDTechTree.GetTreeTechs
//   ProtoTechNode.techID / .scienceCost / .partsPurchased
//   GameVariables.Instance / .GetScienceCostLimit
//   ScenarioUpgradeableFacilities.GetFacilityLevel
//                                    KSP's own, read to reproduce ResearchTech's
//                                    ceiling test
//
// WHAT IS INVOKED, each a write or a query RP-1 itself performs on the same
// click:
//
//   new ResearchProject()            the parameterless constructor, which is what
//                                    seeds workRate 1 and the two lazy -1
//                                    sentinels Load does not touch
//   ResearchProject.Load(ConfigNode) RP-1's own deserialiser
//   ResearchProject.UpdateBuildRate(int)
//   TechList.Add                     resolved MOST-DERIVED on purpose: RP-1's
//                                    list is a PersistentObservableList whose Add
//                                    SHADOWS List<T>.Add and fires its Added and
//                                    Updated events. Binding to the base method
//                                    would queue the node and tell nobody
//   ResearchAndDevelopment.AddScience(float, TransactionReasons)
//   KCTUtilities.AddNodePartsToExperimental(string)
//   CurrencyModifierQueryRP0.RunQuery / .CanAfford / .GetTotal
//
// PROVENANCE. Every member named above was read out of an ilspycmd disassembly
// of the INSTALLED RP-1 v4.6.0.0 RP0.dll, of ROUtils.dll beside it, and of the
// installed Assembly-CSharp.dll for the KSP half. The disassembly verifies SHAPE
// and never VALUE: nothing here has been exercised against a running game, so
// every hop is null-safe and every failure to read refuses the command rather
// than guessing at it.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>The handler for <c>rp1.tech.research</c>.</summary>
    public sealed class Rp1ResearchCommands
    {
        /// <summary>Put a tech node on RP-1's research queue. Must match the client's constant.</summary>
        public const string ResearchCommand = "rp1.tech.research";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string ProjectTypeName = "RP0.ResearchProject";
        private const string DatabaseTypeName = "RP0.Database";
        private const string PresetsTypeName = "RP0.PresetManager";
        private const string UtilitiesTypeName = "RP0.KCTUtilities";
        private const string CurrencyQueryTypeName = "RP0.CurrencyModifierQueryRP0";
        private const string TransactionReasonsTypeName = "RP0.TransactionReasonsRP0";
        private const string CurrencyTypeName = "RP0.CurrencyRP0";

        /// <summary>RP-1's transaction reason for researching a node, and KSP's own name for it.</summary>
        private const string ResearchReason = "RnDTechResearch";

        /// <summary>The currency a node is priced in.</summary>
        private const string ScienceCurrency = "Science";

        /// <summary>
        /// <c>RDTech.State.Available</c>, which <c>UnlockTech</c> sets and which
        /// therefore means RESEARCHED rather than "can be researched". Compared
        /// by NAME because the ordinal is KSP's to renumber.
        /// </summary>
        private const string ResearchedState = "Available";

        /// <summary>The facility whose level decides the science-cost ceiling, by KSP's own enum member name.</summary>
        private const string ResearchFacility = "ResearchAndDevelopment";

        private readonly Type? _scm;
        private readonly Type? _project;
        private readonly Type? _database;
        private readonly Type? _presets;
        private readonly Type? _utilities;
        private readonly Type? _currencyQuery;
        private readonly Type? _transactionReasons;
        private readonly Type? _currency;
        private readonly Type? _rnd;
        private readonly Type? _assets;
        private readonly Type? _configNode;
        private readonly Type? _gameVariables;
        private readonly Type? _facilities;
        private readonly Type? _kspTransactionReasons;

        public Rp1ResearchCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _project = Rp1Types.Find(ProjectTypeName);
            _database = Rp1Types.Find(DatabaseTypeName);
            _presets = Rp1Types.Find(PresetsTypeName);
            _utilities = Rp1Types.Find(UtilitiesTypeName);
            _currencyQuery = Rp1Types.Find(CurrencyQueryTypeName);
            _transactionReasons = Rp1Types.Find(TransactionReasonsTypeName);
            _currency = Rp1Types.Find(CurrencyTypeName);
            _rnd = Rp1Types.Find("ResearchAndDevelopment");
            _assets = Rp1Types.Find("AssetBase");
            _configNode = Rp1Types.Find("ConfigNode");
            _gameVariables = Rp1Types.Find("GameVariables");
            _facilities = Rp1Types.Find("ScenarioUpgradeableFacilities");
            _kspTransactionReasons = Rp1Types.Find("TransactionReasons");
        }

        /// <summary>
        /// The command can run: RP-1's space centre, its research project, its
        /// preset, its pricing and the KSP types this route authors against all
        /// resolved.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1VehicleCommands.IsAvailable"/> spells out at length: a
        /// method-level gate on the MANIFEST cannot say why it fired, because a
        /// command that was never declared looks exactly like one nobody wrote.
        /// The method lookups happen at the press and refuse with a sentence
        /// naming what was not recognised.</para>
        ///
        /// <para>KSP's own types are in the test as well as RP-1's, and that is
        /// deliberate rather than defensive. This route does not merely read
        /// RP-1: it AUTHORS a ConfigNode and charges a currency, and without
        /// <c>ConfigNode</c> or <c>ResearchAndDevelopment</c> there is no route
        /// at all, so a command declared without them would be one that can only
        /// refuse.</para>
        /// </summary>
        public bool IsAvailable =>
            _scm != null && _project != null && _database != null && _presets != null
            && _utilities != null && _currencyQuery != null && _transactionReasons != null
            && _currency != null && _rnd != null && _assets != null && _configNode != null
            && _gameVariables != null && _facilities != null && _kspTransactionReasons != null;

        /// <summary>
        /// Whether the members this command invokes resolved, as a sentence for a
        /// health fact. The same reasoning as
        /// <see cref="Rp1PersonnelCommands.MethodDiagnosis"/>: a withheld command
        /// and an absent one are indistinguishable from outside, and naming the
        /// member is the difference between "nobody wrote this" and "RP-1 renamed
        /// Load".
        /// </summary>
        public string MethodDiagnosis()
        {
            if (!IsAvailable)
            {
                return "RP-1 research types not found";
            }
            try
            {
                var missing = new List<string>();
                if (Rp1Types.Constructor(_project!, 0) == null)
                {
                    missing.Add("ResearchProject()");
                }
                if (ProjectMethod("Load", 1) == null)
                {
                    missing.Add("ResearchProject.Load(ConfigNode)");
                }
                if (ProjectMethod("UpdateBuildRate", 1) == null)
                {
                    missing.Add("ResearchProject.UpdateBuildRate(int)");
                }
                if (Rp1Types.StaticMethod(_utilities!, "AddNodePartsToExperimental", 1) == null)
                {
                    missing.Add("KCTUtilities.AddNodePartsToExperimental(string)");
                }
                if (Rp1Types.StaticMethod(_currencyQuery!, "RunQuery", 4) == null)
                {
                    missing.Add("CurrencyModifierQueryRP0.RunQuery");
                }
                return missing.Count == 0
                    ? "every invoked member resolved"
                    : "research will refuse at the press: " + string.Join(", ", missing.ToArray()) + " not found";
            }
            catch (Exception ex)
            {
                // Runs from Health, on the Courier thread. A diagnostic that takes
                // the health surface down with it is worse than no diagnostic.
                return "research will refuse at the press: the lookup threw: " + Rp1Types.ExceptionReason(ex);
            }
        }

        /// <summary>
        /// Queues a tech node for research, at RP-1's price and RP-1's rate.
        ///
        /// <para>NOT idempotent in the way the staffing command is, and it cannot
        /// be: this SPENDS. A node already on the queue is refused rather than
        /// quietly succeeding, because "the asked-for state is the state" would
        /// mean a second press of a control an operator thought had not landed
        /// paid for the same node twice.</para>
        /// </summary>
        public CommandResult Research(Rp1TechResearchArgs? args)
        {
            var techId = args?.TechId;
            if (string.IsNullOrWhiteSpace(techId))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no tech node");
            }

            if (!IsAvailable)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's research model could not be resolved, so nothing was queued");
            }

            var scm = Rp1Types.StaticValue(_scm!, "Instance");
            if (scm == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's space centre is not loaded");
            }

            if (Rp1Types.ReadBool(scm, "enabledForSave") != true)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 is not managing this save");
            }

            var queues = QueuesResearch();
            if (queues == null)
            {
                // The same direction Rp1CareerProjectGate takes on an unreadable
                // answer, and for the same reason: this is the branch that
                // decides whether RP-1 models research at all, and getting it
                // wrong charges a career for a project nothing will work through.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say whether it queues research in this save, so nothing was queued");
            }
            if (queues == false)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's preset has build and tech-unlock times switched off in this save, so research is not "
                    + "queued here and a node is bought outright at the R&D complex");
            }

            var rnd = Rp1Types.StaticValue(_rnd!, "Instance");
            if (rnd == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.CareerModeRequired,
                    "this save has no research and development, so nothing can be researched");
            }

            var tech = TreeTech(techId!, out var treeFailure);
            if (treeFailure != null)
            {
                return treeFailure;
            }
            if (tech == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no tech node with the id \"" + techId + "\" exists in this save's tech tree");
            }

            var scienceCost = ReadInt(tech, "scienceCost");
            if (scienceCost == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "the tech tree would not say what \"" + techId + "\" costs, so nothing was queued");
            }

            var title = Title(techId!);

            var state = TechnologyState(techId!, out var stateFailure);
            if (stateFailure != null)
            {
                return stateFailure;
            }
            if (state == ResearchedState)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    title + " has already been researched");
            }

            // BEFORE the charge, deliberately: RP-1's own patch asks this first
            // too, and a queued node charged a second time is money an operator
            // cannot get back.
            var queued = AlreadyQueued(scm, techId!, out var queuedFailure);
            if (queuedFailure != null)
            {
                return queuedFailure;
            }
            if (queued == true)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    title + " is already on the research queue");
            }

            var charge = Charge(scienceCost.Value, out var affordable, out var priceFailure);
            if (priceFailure != null)
            {
                return priceFailure;
            }
            if (!affordable)
            {
                return CommandResult.Fail(CommandErrorCode.InsufficientScience, new LimitBreach
                {
                    Quantity = "science",
                    Actual = charge,
                    Limit = ScienceBalance(rnd),
                    Unit = Units.Science,
                });
            }

            var ceiling = ScienceCostCeiling(out var level);
            if (ceiling == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "the science cost limit this save's R&D complex imposes could not be read, so nothing was queued");
            }
            if (scienceCost.Value > ceiling.Value)
            {
                return CommandResult.Fail(CommandErrorCode.LimitReached, new LimitBreach
                {
                    Facility = ResearchFacility,
                    FacilityLevel = level ?? 0.0,
                    Quantity = "science",
                    Actual = scienceCost.Value,
                    Limit = ceiling.Value,
                    Unit = Units.Science,
                });
            }

            // Built before the money moves. See this file's header: nothing in
            // constructing it touches the game, so the only steps left after the
            // charge are ones that either land or say plainly that they did not.
            var project = BuildProject(rnd, techId!, title, scienceCost.Value, state, out var buildFailure);
            if (buildFailure != null)
            {
                return buildFailure;
            }

            var charged = Spend(rnd, scienceCost.Value);
            if (charged != null)
            {
                return charged;
            }

            return Enlist(scm, project!, techId!, title);
        }

        // ── RP-1's model, asked ────────────────────────────────────────────

        /// <summary>
        /// Whether RP-1 turns a tech unlock into a queued project in this save,
        /// as its own Harmony prefix decides it.
        ///
        /// <para><c>Prefix_UnlockTech</c> returns TRUE, i.e. lets the stock
        /// instant unlock run, unless <c>Enabled</c>, <c>TechUnlockTimes</c> and
        /// <c>BuildTimes</c> all hold. A save where they do not has no research
        /// queue to add to, so this command has nothing to do there and the
        /// answer is a refusal rather than a project nothing will work through.
        /// Absent, never false, when any hop could not be read: the two are
        /// different facts and only one of them is RP-1 saying so.</para>
        /// </summary>
        private bool? QueuesResearch()
        {
            var settings = Rp1Types.Member(
                Rp1Types.Member(Rp1Types.StaticValue(_presets!, "Instance"), "ActivePreset"),
                "GeneralSettings");
            if (settings == null)
            {
                return null;
            }
            var enabled = Rp1Types.ReadBool(settings, "Enabled");
            var techTimes = Rp1Types.ReadBool(settings, "TechUnlockTimes");
            var buildTimes = Rp1Types.ReadBool(settings, "BuildTimes");
            if (enabled == null || techTimes == null || buildTimes == null)
            {
                return null;
            }
            return enabled.Value && techTimes.Value && buildTimes.Value;
        }

        /// <summary>
        /// The tree's own node for this id, or null when the tree has no such
        /// node. A refusal comes back through <paramref name="failure"/> for the
        /// different case where the tree itself could not be read, because "there
        /// is no such node" and "nobody could say" want different sentences.
        /// </summary>
        private object? TreeTech(string techId, out CommandResult? failure)
        {
            failure = null;
            try
            {
                var tree = Rp1Types.StaticValue(_assets!, "RnDTechTree");
                var treeTechs = tree == null ? null : Rp1Types.InstanceMethod(tree, "GetTreeTechs", 0);
                if (treeTechs == null)
                {
                    failure = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this save's tech tree is not loaded, so nothing was queued");
                    return null;
                }
                foreach (var node in Rp1Types.Enumerate(treeTechs.Invoke(tree, null)))
                {
                    if (Rp1Types.ReadString(node, "techID") == techId)
                    {
                        return node;
                    }
                }
                return null;
            }
            catch (Exception ex)
            {
                failure = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this save's tech tree could not be read, so nothing was queued: " + Rp1Types.ExceptionReason(ex));
                return null;
            }
        }

        /// <summary>
        /// The PLAYER's state for this node, by name, never the tree asset's
        /// config default. <c>Available</c> here means researched, because that
        /// is what <c>UnlockTech</c> sets it to.
        /// </summary>
        private string? TechnologyState(string techId, out CommandResult? failure)
        {
            failure = null;
            try
            {
                var getState = Rp1Types.StaticMethod(_rnd!, "GetTechnologyState", 1);
                if (getState == null)
                {
                    failure = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this KSP build has no tech-node state read this Uplink recognises, so nothing was queued");
                    return null;
                }
                var state = getState.Invoke(null, new object[] { techId });
                if (state == null)
                {
                    failure = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "the game would not say whether \"" + techId + "\" is already researched, so nothing was queued");
                    return null;
                }
                return state.ToString();
            }
            catch (Exception ex)
            {
                failure = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "whether \"" + techId + "\" is already researched could not be read, so nothing was queued: "
                    + Rp1Types.ExceptionReason(ex));
                return null;
            }
        }

        /// <summary>Whether RP-1 is already working this node, asked its own way.</summary>
        private bool? AlreadyQueued(object scm, string techId, out CommandResult? failure)
        {
            failure = null;
            try
            {
                var has = Rp1Types.InstanceMethod(scm, "TechListHas", 1);
                if (has == null)
                {
                    failure = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no research-queue membership test this Uplink recognises, so nothing was queued");
                    return null;
                }
                return has.Invoke(scm, new object[] { techId }) as bool?;
            }
            catch (Exception ex)
            {
                failure = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "whether \"" + techId + "\" is already queued could not be read, so nothing was queued: "
                    + Rp1Types.ExceptionReason(ex));
                return null;
            }
        }

        /// <summary>
        /// What the career is actually charged for this node once leaders and
        /// strategies have had their say, and whether it can bear it.
        ///
        /// <para>The same shape and the same reasoning as
        /// <see cref="Rp1Pricing.Price"/>, and the same query: RP-1's PatchCMQ
        /// prefixes stock's <c>CurrencyModifierQuery.RunQuery</c> with exactly
        /// this call, so asking RP-1's own overload directly is asking the
        /// question <c>ResearchTech</c> asks, not a different one.</para>
        ///
        /// <para>The CHARGE is the unmodified integer, because
        /// <c>ResearchTech</c>'s own <c>AddScience(-scienceCost, ...)</c> is: the
        /// modifier chain decides affordability there and does not decide the
        /// debit. What comes back here is the modified figure and it is used for
        /// the number in a refusal, so an operator reads the same total the R&amp;D
        /// screen's own tooltip shows them.</para>
        /// </summary>
        private double Charge(int scienceCost, out bool affordable, out CommandResult? failure)
        {
            affordable = false;
            failure = null;
            try
            {
                var runQuery = Rp1Types.StaticMethod(_currencyQuery!, "RunQuery", 4);
                if (runQuery == null)
                {
                    failure = Unpriceable(null);
                    return scienceCost;
                }
                var reason = Enum.Parse(_transactionReasons!, ResearchReason);
                var science = Enum.Parse(_currency!, ScienceCurrency);

                var query = runQuery.Invoke(null, new object[] { reason, 0.0, -(double)scienceCost, 0.0 });
                var canAfford = query?.GetType().GetMethod("CanAfford", new[] { _currency! });
                var getTotal = query?.GetType().GetMethod("GetTotal", new[] { _currency!, typeof(bool) });
                if (query == null || canAfford == null)
                {
                    failure = Unpriceable(null);
                    return scienceCost;
                }

                affordable = canAfford.Invoke(query, new[] { science }) is bool ok && ok;

                // Stated as a negative delta by the query, negated back for a
                // sentence an operator reads.
                var total = getTotal == null
                    ? (double?)null
                    : Rp1Types.ToDouble(getTotal.Invoke(query, new object[] { science, true }));
                return total.HasValue ? -total.Value : scienceCost;
            }
            catch (Exception ex)
            {
                failure = Unpriceable(ex);
                return scienceCost;
            }
        }

        /// <summary>
        /// The refusal for a price that could not be computed, and it REFUSES for
        /// the reason <see cref="Rp1Pricing"/> gives: RP-1's <c>AddScience</c>
        /// prefix performs no affordability test of its own, so proceeding on an
        /// unreadable price is how a career ends up at zero science with nothing
        /// queued.
        /// </summary>
        private static CommandResult Unpriceable(Exception? ex) => CommandResult.Fail(
            CommandErrorCode.ModeUnavailable,
            "RP-1's own price for this node could not be read, so nothing was queued"
            + (ex == null ? "" : ": " + Rp1Types.ExceptionReason(ex)));

        /// <summary>The banked science, for the number beside a refusal only.</summary>
        private static double? ScienceBalance(object rnd) => Rp1Types.ReadDouble(rnd, "Science");

        /// <summary>
        /// The most a node may cost at this save's R&amp;D complex, reproduced from
        /// <c>RDTech.ResearchTech</c>: <c>GameVariables.GetScienceCostLimit</c> at
        /// the facility's normalised level.
        ///
        /// <para>Absent when either hop could not be read, and the caller refuses
        /// on that. It sits BEFORE the charge, so refusing costs an operator a
        /// press and never a currency.</para>
        /// </summary>
        private double? ScienceCostCeiling(out double? level)
        {
            level = null;
            try
            {
                var getLevel = Rp1Types.StaticMethod(_facilities!, "GetFacilityLevel", 1);
                var variables = Rp1Types.StaticValue(_gameVariables!, "Instance");
                if (getLevel == null || variables == null)
                {
                    return null;
                }
                var getLimit = Rp1Types.InstanceMethod(variables, "GetScienceCostLimit", 1);
                if (getLimit == null)
                {
                    return null;
                }
                level = Rp1Types.ToDouble(getLevel.Invoke(null, new object[] { ResearchFacility }));
                if (level == null)
                {
                    return null;
                }
                return Rp1Types.ToDouble(getLimit.Invoke(variables, new object[] { (float)level.Value }));
            }
            catch (Exception)
            {
                return null;
            }
        }

        // ── The project, authored ──────────────────────────────────────────

        /// <summary>
        /// The seven <c>[Persistent]</c> keys <c>ConfigNode.LoadObjectFromConfig</c>
        /// reads off a <c>ResearchProject</c>, plus the <c>ProtoNode</c> subnode
        /// <c>ResearchProject.Load</c> hands to <c>new ProtoTechNode(node)</c>.
        ///
        /// <para>DATA rather than a ConfigNode, so the checklist this route stands
        /// on can be checked. <c>Rp1InstalledCompatibilityTests</c> reads the
        /// <c>[Persistent]</c> fields off the SHIPPED <c>RP0.ResearchProject</c>
        /// and asserts this covers every one of them, which is a different kind
        /// of check from a stand-in that agrees with whatever we wrote.</para>
        /// </summary>
        public sealed class ProjectNodeDraft
        {
            /// <summary>The seven <c>[Persistent]</c> keys, in the order RP-1 declares them.</summary>
            public IReadOnlyList<KeyValuePair<string, string>> Values { get; }

            /// <summary>The three <c>ProtoTechNode(ConfigNode)</c> reads: id, state and cost.</summary>
            public IReadOnlyList<KeyValuePair<string, string>> ProtoValues { get; }

            /// <summary>
            /// The repeated <c>part</c> key that constructor also reads, one per
            /// already-purchased part. Empty for a node nobody has bought
            /// anything from, which is the ordinary case.
            /// </summary>
            public IReadOnlyList<string> ProtoParts { get; }

            public ProjectNodeDraft(
                IReadOnlyList<KeyValuePair<string, string>> values,
                IReadOnlyList<KeyValuePair<string, string>> protoValues,
                IReadOnlyList<string> protoParts)
            {
                Values = values;
                ProtoValues = protoValues;
                ProtoParts = protoParts;
            }
        }

        /// <summary>The name <c>ResearchProject.Load</c> looks the child node up by.</summary>
        public const string ProtoNodeName = "ProtoNode";

        /// <summary>
        /// Every value the authored node carries, worked out from primitives that
        /// have already been read.
        ///
        /// <para>Pure, and public, because it IS the checklist: seven keys for the
        /// project and three plus the parts for its proto node. Nothing here
        /// touches the game, so a test can hold it to the shipped assembly's own
        /// field list without an install of anything.</para>
        ///
        /// <para><paramref name="progress"/> and <paramref name="workRate"/> are
        /// written even though the parameterless constructor already leaves
        /// <c>workRate</c> at 1: a key omitted because a default happens to agree
        /// with it is a key nobody notices when the default moves.</para>
        /// </summary>
        public static ProjectNodeDraft Draft(
            string techId,
            string techName,
            int scienceCost,
            string state,
            int startYear,
            int endYear,
            IReadOnlyList<string> purchasedParts)
        {
            var values = new List<KeyValuePair<string, string>>
            {
                Pair("scienceCost", Int(scienceCost)),
                Pair("startYear", Int(startYear)),
                Pair("endYear", Int(endYear)),
                Pair("techName", techName),
                Pair("techID", techId),
                Pair("progress", Int(0)),
                Pair("workRate", Int(1)),
            };

            var proto = new List<KeyValuePair<string, string>>
            {
                Pair("id", techId),
                Pair("state", state),
                Pair("cost", Int(scienceCost)),
            };

            return new ProjectNodeDraft(values, proto, purchasedParts);
        }

        private static KeyValuePair<string, string> Pair(string key, string value) =>
            new KeyValuePair<string, string>(key, value);

        /// <summary>
        /// A whole number as a ConfigNode value. Invariant, and integral on
        /// purpose: <c>progress</c> and <c>workRate</c> are doubles RP-1 parses
        /// back, and "0" and "1" carry no decimal separator for a culture to
        /// disagree about.
        /// </summary>
        private static string Int(int value) => value.ToString(CultureInfo.InvariantCulture);

        /// <summary>
        /// Constructs RP-1's own <c>ResearchProject</c> and lets RP-1 deserialise
        /// it out of the node this authors.
        /// </summary>
        private object? BuildProject(
            object rnd, string techId, string title, int scienceCost, string? state, out CommandResult? failure)
        {
            failure = null;
            try
            {
                var period = TechPeriod(techId);
                var draft = Draft(
                    techId,
                    title,
                    scienceCost,
                    state ?? "",
                    period.Key,
                    period.Value,
                    PurchasedParts(rnd, techId));

                var node = WriteNode(draft);
                if (node == null)
                {
                    failure = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this KSP build has no config node this Uplink can author, so nothing was queued");
                    return null;
                }

                var ctor = Rp1Types.Constructor(_project!, 0);
                if (ctor == null)
                {
                    failure = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no research project this Uplink can build, so nothing was queued");
                    return null;
                }
                var project = ctor.Invoke(null);

                var load = Rp1Types.InstanceMethod(project, "Load", 1);
                if (load == null)
                {
                    failure = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no research-project load step this Uplink recognises, so nothing was queued");
                    return null;
                }
                load.Invoke(project, new[] { node });
                return project;
            }
            catch (Exception ex)
            {
                failure = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not build a research project for \"" + techId + "\", so nothing was queued: "
                    + Rp1Types.ExceptionReason(ex));
                return null;
            }
        }

        /// <summary>Pours a draft into a real ConfigNode. Null when KSP's own node type would not build one.</summary>
        private object? WriteNode(ProjectNodeDraft draft)
        {
            var ctor = Rp1Types.Constructor(_configNode!, 1);
            var addValue = _configNode!.GetMethod("AddValue", new[] { typeof(string), typeof(string) });
            var addNode = _configNode.GetMethod("AddNode", new[] { typeof(string) });
            if (ctor == null || addValue == null || addNode == null)
            {
                return null;
            }

            var node = ctor.Invoke(new object[] { "Tech" });
            foreach (var value in draft.Values)
            {
                addValue.Invoke(node, new object[] { value.Key, value.Value });
            }

            var proto = addNode.Invoke(node, new object[] { ProtoNodeName });
            foreach (var value in draft.ProtoValues)
            {
                addValue.Invoke(proto, new object[] { value.Key, value.Value });
            }
            foreach (var part in draft.ProtoParts)
            {
                addValue.Invoke(proto, new object[] { "part", part });
            }
            return node;
        }

        /// <summary>
        /// The era this node belongs to, as RP-1's own table gives it, or (0, 0)
        /// for a node the table does not mention.
        ///
        /// <para>Zero is RP-1's own miss behaviour rather than a substituted
        /// guess: its constructor leaves both fields at their default when
        /// <c>TryGetValue</c> misses, and <c>CalculateYearBasedRateMult</c> reads
        /// a <c>startYear</c> below 1 as "no era model, rate multiplier 1". Any
        /// other invented pair would change how fast the node researches.</para>
        ///
        /// <para>Walked as a bare <see cref="System.Collections.IEnumerable"/>
        /// like every other RP-1 collection this Uplink reads, rather than cast
        /// to the <c>Dictionary&lt;string, TechPeriod&gt;</c> it is underneath: a
        /// generic cast across an assembly this one does not reference is a cast
        /// that happens to work today.</para>
        /// </summary>
        private KeyValuePair<int, int> TechPeriod(string techId)
        {
            foreach (var entry in Rp1Types.Enumerate(Rp1Types.StaticValue(_database!, "TechNodePeriods")))
            {
                if (!(Rp1Types.Member(entry, "Key") is string key) || key != techId)
                {
                    continue;
                }
                var period = Rp1Types.Member(entry, "Value");
                var start = ReadInt(period, "startYear");
                var end = ReadInt(period, "endYear");
                if (start != null && end != null)
                {
                    return new KeyValuePair<int, int>(start.Value, end.Value);
                }
                break;
            }
            return new KeyValuePair<int, int>(0, 0);
        }

        /// <summary>
        /// The names of parts already bought off this node, from the LIVE proto
        /// node. Empty for a node the save has never held state for, which is the
        /// ordinary case for anything about to be researched.
        /// </summary>
        private IReadOnlyList<string> PurchasedParts(object rnd, string techId)
        {
            var names = new List<string>();
            var getState = Rp1Types.InstanceMethod(rnd, "GetTechState", 1);
            if (getState == null)
            {
                return names;
            }
            object? live;
            try
            {
                live = getState.Invoke(rnd, new object[] { techId });
            }
            catch (Exception)
            {
                return names;
            }
            foreach (var part in Rp1Types.Enumerate(Rp1Types.Member(live, "partsPurchased")))
            {
                var name = Rp1Types.ReadString(part, "name");
                if (!string.IsNullOrEmpty(name))
                {
                    names.Add(name!);
                }
            }
            return names;
        }

        // ── The two acts ───────────────────────────────────────────────────

        /// <summary>
        /// Takes the science, through the method RP-1 prefixes with its own body.
        /// Null on success; a refusal when the charge could not be made, in which
        /// case nothing has been queued and nothing has been spent.
        /// </summary>
        private CommandResult? Spend(object rnd, int scienceCost)
        {
            try
            {
                var addScience = _rnd!.GetMethod("AddScience", new[] { typeof(float), _kspTransactionReasons! });
                if (addScience == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this KSP build has no science charge this Uplink recognises, so nothing was queued");
                }
                var reason = Enum.Parse(_kspTransactionReasons!, ResearchReason);
                addScience.Invoke(rnd, new object[] { -(float)scienceCost, reason });
                return null;
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "the science for this node could not be charged, so nothing was queued: "
                    + Rp1Types.ExceptionReason(ex));
            }
        }

        /// <summary>
        /// Puts the project on the queue, costs it, and offers its parts as
        /// experimental, which is the whole of what RP-1's own prefix does after
        /// the constructor.
        ///
        /// <para>The science is already gone by the time this runs, which is why
        /// a throw here does not report as a plain refusal: an operator reading
        /// "refused" would expect their science back, and it is not coming.</para>
        /// </summary>
        private CommandResult Enlist(object scm, object project, string techId, string title)
        {
            var list = Rp1Types.Member(scm, "TechList");
            var add = list == null ? null : MostDerived(list.GetType(), "Add", 1);
            if (add == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "the science for " + title + " has been spent and RP-1's research queue would not take the node: "
                    + "no queue this Uplink recognises. Check the R&D complex");
            }

            try
            {
                add.Invoke(list, new[] { project });
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "the science for " + title + " has been spent and RP-1 refused the node: "
                    + Rp1Types.ExceptionReason(ex) + ". Check the R&D complex");
            }

            // Both of these are RP-1 catching up with a queue that has already
            // changed, so neither failing is a reason to tell an operator the
            // command did not land: the node IS queued. The rate recomputes on
            // its own the first time anything reads it, because Load leaves the
            // lazy sentinel the parameterless constructor set.
            try
            {
                var count = Rp1Types.ToDouble(Rp1Types.Member(list, "Count"));
                var update = Rp1Types.InstanceMethod(project, "UpdateBuildRate", 1);
                if (update != null && count != null)
                {
                    update.Invoke(project, new object[] { (int)count.Value - 1 });
                }
            }
            catch (Exception)
            {
                // See above: the sentinel makes this an optimisation.
            }

            try
            {
                var experimental = Rp1Types.StaticMethod(_utilities!, "AddNodePartsToExperimental", 1);
                experimental?.Invoke(null, new object[] { techId });
            }
            catch (Exception)
            {
                // RP-1 offers the node's parts for early purchase as a
                // convenience. A career that does not get the offer has still
                // queued the node it asked to queue.
            }

            return CommandResult.Ok();
        }

        // ── Reflection oddments ────────────────────────────────────────────

        /// <summary>
        /// A method resolved MOST-DERIVED FIRST, walking the base chain rather
        /// than trusting the order <c>GetMethods</c> happens to return.
        /// </summary>
        /// <remarks>
        /// RP-1's <c>TechList</c> is a <c>PersistentObservableList&lt;T&gt;</c>,
        /// whose <c>Add</c> is declared <c>new</c> over <c>List&lt;T&gt;.Add</c>
        /// and fires its <c>Added</c> and <c>Updated</c> events. Both are public,
        /// both take one argument, and a name-and-arity lookup would take
        /// whichever reflection listed first: bind to the base one and the node
        /// is queued while every subscriber to the list is told nothing. That is
        /// a silent half-write, which is the shape of failure this whole Uplink
        /// is written to avoid.
        /// </remarks>
        private static MethodInfo? MostDerived(Type? type, string name, int parameterCount)
        {
            const BindingFlags flags =
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly;
            for (var t = type; t != null; t = t.BaseType)
            {
                MethodInfo[] candidates;
                try
                {
                    candidates = t.GetMethods(flags);
                }
                catch (Exception)
                {
                    return null;
                }
                foreach (var m in candidates)
                {
                    if (m.Name != name)
                    {
                        continue;
                    }
                    try
                    {
                        if (m.GetParameters().Length == parameterCount)
                        {
                            return m;
                        }
                    }
                    catch (Exception)
                    {
                        // One overload this runtime cannot resolve must not hide
                        // the rest; reading a parameter TYPE is what loads it.
                    }
                }
            }
            return null;
        }

        /// <summary>An instance method on the project type, for the diagnosis only.</summary>
        private MethodInfo? ProjectMethod(string name, int parameterCount) =>
            MostDerived(_project, name, parameterCount);

        /// <summary>
        /// The node's display name, or its id when the tree has no title for it.
        /// <c>GetTechnologyTitle</c> answers with the empty string on a miss, and
        /// an empty <c>techName</c> is the exact thing this route was chosen to
        /// avoid persisting.
        /// </summary>
        private string Title(string techId)
        {
            try
            {
                var getTitle = Rp1Types.StaticMethod(_rnd!, "GetTechnologyTitle", 1);
                var title = getTitle?.Invoke(null, new object[] { techId }) as string;
                return string.IsNullOrWhiteSpace(title) ? techId : title!;
            }
            catch (Exception)
            {
                return techId;
            }
        }

        /// <summary>
        /// An int RP-1 or KSP keeps at whatever width it declared. Absent rather
        /// than zero when unreadable: zero is a legitimate science cost and a
        /// legitimate year, and treating an unreadable member as either would
        /// author a node against a number nobody answered with.
        /// </summary>
        private static int? ReadInt(object? target, string name)
        {
            switch (Rp1Types.Member(target, name))
            {
                case int i: return i;
                case long l: return (int)l;
                case short s: return s;
                default: return null;
            }
        }
    }
}
