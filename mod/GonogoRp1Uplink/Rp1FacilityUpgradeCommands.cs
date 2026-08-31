// The RP-1-native facility upgrade: the command Rp1CareerProjectGate refuses
// career.facility.upgrade in favour of, and which until now did not exist.
//
// WHAT THE GATE SAYS AND WHY THIS ANSWERS IT. Core's career.facility.upgrade
// calls UpgradeableFacility.SetLevel and pays the stock price, which under RP-1
// jumps a tier instantly next to a construction queue that never heard of it.
// The gate refuses that, and its header sets out why it refuses rather than
// quietly enqueuing: enqueuing is a DIFFERENT ACT, at a different price, with a
// completion weeks away and a queue position that depends on how many engineers
// the centre has. That act belongs to a command of its own in this Uplink's own
// namespace, and this is it.
//
// WHAT IT REPRODUCES, AND WHY IT HAS TO. RP-1 performs the enqueue in
// RP0.Harmony.PatchKSCFacilityContextMenu.ProcessUpgrade, which is private
// static on a Harmony patch class and cannot be called. Every step it takes is
// independently reachable, so the procedure is reproduced call for call and in
// RP-1's own order:
//
//   1. the tech gate, which is RP-1's own rule and is read below rather than
//      reproduced
//   2. FacilityUpgradeProject.AlreadyInProgressByID(id), RP-1's own guard
//   3. new FacilityUpgradeProject(type, id, newLevel, oldLevel, name)
//   4. proj.SetBP(upgradeCost, cumulativeLevelCost), which is what turns a price
//      into a build duration
//   5. proj.cost = upgradeCost
//   6. SpaceCenterManagement.Instance.ActiveSC.FacilityUpgrades.Add(proj)
//   7. SCMEvents.OnFacilityUpgradeQueued.Fire(proj), inside a try/catch, exactly
//      as RP-1 wraps its own fire
//
// The one step RP-1's own code takes that this does not is the on-screen
// message, which has no operator on this side of the link to read it.
//
// NOTHING IS CHARGED HERE, and that is the design fact that shapes the whole
// command. ProcessUpgrade spends no funds at all: ConstructionProject.AddProgress
// draws them down incrementally as the project progresses, and it throttles
// itself to what the career can afford at the time (GetAffordableFundsFraction).
// So there is NO affordability refusal, and adding one would invent a rule RP-1
// does not have and refuse something the game permits. Rp1BuildCommands' "the
// money check cannot be skipped" lesson does not transfer: there the spend was
// immediate and unguarded, here RP-1 guards it continuously.
//
// THE HOUSE RULE IS STILL OBEYED. Queueing this commits the career to a drain,
// so the price and the balance travel together. BEFORE the press they are
// already on the wire, on core's career.status: facilities[<name>].upgradeCost
// is the identical UpgradeableFacility.GetUpgradeCost() call ProcessUpgrade
// makes, and economy.funds sits beside it in the same payload (confirmed on the
// live Deck stream, 2026-08-30). AFTER it, the result payload carries both again
// so the confirmation an operator reads names what was committed and what is
// left, without a second round trip.
//
// THE SCENE CONSTRAINT IS REAL AND WAS CONFIRMED LIVE, not inferred.
// FacilityUpgradeProject.GetFacilityReferencesById reaches
// ScenarioUpgradeableFacilities.protoUpgradeables[id].facilityRefs, and that
// list is filled by RegisterUpgradeable, called from the UpgradeableFacility
// MonoBehaviours, which exist in the SPACECENTER scene only. protoUpgradeables
// ITSELF is four-scene (it is rebuilt from the save in OnLoad), so the dictionary
// answers everywhere and the refs list inside it does not. The live facility is
// also the only source of GetUpgradeCost() and of upgradeLevels[i].levelCost,
// which are the price and the build points.
//
//   Confirmed on the running Deck install on 2026-08-30: with
//   spaceCenter.scene = "Flight", every entry of career.status.facilities
//   reported currentTier, maxTier and upgradeCost as null, which is core's
//   guarded read of exactly this refs list coming back empty.
//
// So the command declares a requirement for it, and the control is dark with its
// reason before anyone presses it rather than discovering an empty list at
// dispatch. The requirement asks whether the refs list is populated rather than
// whether the scene is SPACECENTER, which is the same answer today and the more
// honest question: see GateKind for why this Uplink declares a kind of its own
// instead of borrowing core's scene gate.
//
// LOCKED FACILITIES: FIVE OF THE NINE ARE NOT UPGRADED BY RP-1 AT ALL, and this
// was the refusal the design arrived without. It was found on the rig rather
// than in the disassembly, because it is a fact about RP-1's CONFIG and not
// about its code.
//
//   Read off the running Deck career on 2026-08-30, at the space centre:
//
//     Administration    tier 0 of 8   upgrade  40,000f
//     AstronautComplex  tier 0 of 4   upgrade  30,000f
//     MissionControl    tier 0 of 4   upgrade  60,000f
//     TrackingStation   tier 0 of 10  upgrade  50,000f
//     LaunchPad         tier 0 of 2   upgrade       1f
//     Runway            tier 0 of 2   upgrade       1f
//     VehicleAssemblyBuilding, SpaceplaneHangar, ResearchAndDevelopment
//                       tier 0 of 2   upgrade       1f
//
//   The five costing a single fund are the ones RP-1's CustomBarnKit.cfg gives
//   `upgrades = 1, 1, 1`, under its own comment "Cosmetic only - level set by
//   code to match other buildings". RP-1 loads exactly that value into
//   Database.LockedFacilities, and FacilityUpgradeProject.UpgradeLockedFacilities
//   then DRIVES their level from the mean of the ones it does upgrade, after
//   every real upgrade completes. Under RP-1 the capacity those five used to buy
//   is bought elsewhere entirely: a launch complex, or the research queue.
//
// So a project queued against one of them would cost nothing, finish almost at
// once, and then have the level it set overwritten by RP-1's own averaging. That
// is the same "state RP-1's own model has no way to produce" that
// Rp1CareerProjectGate exists to keep the stock command out of, arriving through
// this command's door instead. RP-1's own menu never offers it: its patch tests
// IsUpgradeable(facility) and disables the button. This command asks the SAME
// private predicate, and refuses.
//
// THREE TRAPS ON THIS PATH, all of which bite before any scene question:
//
//   1. GetFacilityType(SpaceCenterBuilding) is also private static, and
//      reflecting it does not help: it takes the clickable scene MonoBehaviour
//      and this command starts from an id string, so it is not callable on these
//      inputs. The SpaceCenterFacility is parsed from the id's last segment
//      instead, which is the same segment ProcessUpgrade passes as the project's
//      display name. A FAILED MATCH REFUSES and never defaults: for a modded or
//      KSCSwitcher site the last segment need not be an enum name, and the
//      absence of an answer is not VehicleAssemblyBuilding, which is what
//      ProcessUpgrade's own fall-through would make it. Defaulting there would
//      queue an upgrade against the WRONG BUILDING. The segment is matched
//      against Enum.GetNames rather than handed to Enum.Parse, because Parse
//      ALSO accepts an ordinal and a comma-separated flags list: an id ending in
//      "2" would come back as LaunchPad from a segment naming no building at
//      all, which is the same bug in a second costume.
//   2. FacilityUpgradeProject.GetFacilityReferencesById is a BARE INDEXER over
//      protoUpgradeables and throws KeyNotFoundException on a missing key, where
//      every other read on this path returns null or an empty list. It is
//      therefore not called at all: the dictionary is read with a guarded
//      TryGetValue here.
//   3. It does not sanitize the id and its sibling does.
//      ScenarioUpgradeableFacilities.GetFacilityLevel calls SlashSanitize first
//      and then TryGetValue; GetFacilityReferencesById does neither. So an id
//      that works perfectly with one throws in the other, and the asymmetry
//      passes every headless test and fires once, on the rig, on the one facility
//      whose id has a slash. The id is sanitized ONCE here, up front, and the
//      sanitized form is what reaches the project, the in-progress check and the
//      dictionary, so nothing downstream can disagree about which id this is.
//
// THE MEMBERS IT TOUCHES. RP-1's, each read off the shipped RP-1 v4.6.0.0
// RP0.dll:
//
//   PatchKSCFacilityContextMenu.GetTechGate(string, int)
//                                    PRIVATE static, one of the two non-public
//                                    members on this path, REFLECTED rather than
//                                    reproduced: its body is a lookup into a
//                                    dictionary RP-1 builds from its own
//                                    KCTBUILDINGTECHS config, so reproducing it
//                                    means re-parsing config this Uplink does not
//                                    own. It is a pure function and CheckLoadDict
//                                    self-initialises, so it is safe to call
//                                    cold. It is also the most fragile pin here,
//                                    a Harmony patch class being implementation
//                                    detail rather than API, which is why an
//                                    unreadable gate REFUSES
//   PatchKSCFacilityContextMenu.IsUpgradeable(UpgradeableFacility)
//                                    the other one, and the same bargain: its
//                                    answer comes out of Database.LockedFacilities
//                                    (RP-1's config again) and it matches by
//                                    case-insensitive SUBSTRING of the id rather
//                                    than by the enum. Unlike GetFacilityType
//                                    beside it, this one IS callable on our
//                                    inputs: it takes the UpgradeableFacility
//                                    this command already holds
//   FacilityUpgradeProject(SpaceCenterFacility, string, int, int, string)
//                                    public 5-arg ctor
//   FacilityUpgradeProject.AlreadyInProgressByID(string)
//                                    public static, and it searches EVERY centre
//                                    rather than the active one. It must: a
//                                    per-centre check would let a second queue
//                                    entry appear for a facility already being
//                                    upgraded at another KSC under KSCSwitcher
//   ConstructionProject.SetBP(double, double)
//                                    public, and the whole of how a price becomes
//                                    a duration (Formula.GetConstructionBP)
//   ConstructionProject.cost         public double field, written after SetBP
//                                    reads it, in RP-1's own order
//   SpaceCenterManagement.Instance.ActiveSC.FacilityUpgrades
//                                    public, already read by Rp1ScReflection. The
//                                    Add is what makes the project real: the list
//                                    is a PersistentObservableList whose Added
//                                    handler puts the project into the centre's
//                                    Constructions list and recalculates every
//                                    build rate, so the queue's own rate and ETA
//                                    are RP-1's from the next tick onward and
//                                    nothing here has to compute them
//   SCMEvents.OnFacilityUpgradeQueued
//                                    public static EventData, fired inside a
//                                    try/catch because RP-1 fires its own that way
//
// And KSP's, none of which is RP-1's to guard:
//
//   ScenarioUpgradeableFacilities.SlashSanitize / .protoUpgradeables
//   UpgradeableFacility.FacilityLevel / .MaxLevel / .UpgradeLevels / .GetUpgradeCost()
//   UpgradeableObject.UpgradeLevel.levelCost
//   HighLogic.LoadedSceneIsGame / .CurrentGame.Parameters.Career.FundsLossMultiplier
//   ResearchAndDevelopment.GetTechnologyState(string)
//
// WHAT IS DELIBERATELY NOT CALLED. ConstructionProject.GetTimeLeft() and
// GetBuildRate(), for the reason Rp1ScReflection's own header gives for going
// round them: GetBuildRate writes its own _buildRate and memoises a centre
// reference found by walking the roster, and GetTimeLeft answers an infinity on a
// project RP-1 has not costed yet. The estimate an operator wants reaches them on
// rp1.constructions within one capture, computed the way that file already
// computes it, so there is nothing to gain here and a side effect to lose.
//
// Every arm that cannot read its answer refuses, which is the existing rule on
// this Uplink and the safe direction for a write that queues a spend.
//
// PROVENANCE. Every member here was read out of an ilspycmd disassembly of the
// INSTALLED RP-1 v4.6.0.0 RP0.dll and the installed Assembly-CSharp. The
// disassembly verifies SHAPE and never VALUE, so every hop is null-safe. The one
// claim confirmed against a RUNNING game is the scene constraint above.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The handler for <c>rp1.facility.upgrade</c>, and the evaluator for the one
    /// condition its control can be darkened on before anyone presses it.
    ///
    /// <para>Both on one class, like <see cref="Rp1BuildCommands"/>: the gate asks
    /// the same question the handler's own first refusal asks, off the same
    /// resolved types, and two objects would be two places for that answer to
    /// drift.</para>
    /// </summary>
    public sealed class Rp1FacilityUpgradeCommands : ICommandGateEvaluator
    {
        /// <summary>Queue a space-centre facility's next tier as an RP-1 construction project.</summary>
        public const string UpgradeCommand = "rp1.facility.upgrade";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string ProjectTypeName = "RP0.FacilityUpgradeProject";
        private const string EventsTypeName = "RP0.SCMEvents";

        /// <summary>
        /// The Harmony patch class that owns the tech gate. Named rather than
        /// derived, and pinned in the compatibility manifest, because a patch
        /// class is RP-1 implementation detail and is likelier to be renamed than
        /// anything else this command reaches.
        /// </summary>
        private const string PatchTypeName = "RP0.Harmony.PatchKSCFacilityContextMenu";

        private const string ScenarioTypeName = "ScenarioUpgradeableFacilities";
        private const string FacilityEnumTypeName = "SpaceCenterFacility";
        private const string ResearchTypeName = "ResearchAndDevelopment";
        private const string HighLogicTypeName = "HighLogic";

        /// <summary>The one <c>RDTech.State</c> that means a node has been researched.</summary>
        private const string ResearchedState = "Available";

        /// <summary>
        /// The requirement kind this answers. Namespaced to this Uplink because a
        /// kind may only be claimed once across the whole engine.
        /// </summary>
        /// <remarks>
        /// <para><b>Its own kind rather than core's <c>scene</c>.</b> Core does
        /// ship a scene gate, and <c>Quantity = "SPACECENTER"</c> would very
        /// nearly say this. Two things are wrong with borrowing it. First, an
        /// Uplink cannot verify it: the kind's constant lives in
        /// <c>Gonogo.KSP</c>, which an Uplink may not reference, and a declared
        /// kind with no evaluator is a startup failure for the WHOLE mod, so
        /// naming somebody else's string is betting every other Uplink on a
        /// spelling nothing here can check. Second, and the better reason, the
        /// scene is a PROXY. What the command actually needs is a live
        /// <c>UpgradeableFacility</c> to price a tier from, and that is a thing
        /// this Uplink can read directly. Asking the real question means the
        /// control is dark exactly when the command would refuse, rather than
        /// whenever a scene name happens to differ.</para>
        /// </remarks>
        public const string GateKind = "rp1.facilities";

        /// <summary>The quantity this kind answers: the space centre's facilities are loaded.</summary>
        public const string LiveFacilities = "liveFacilities";

        /// <summary>
        /// What an operator reads wherever the facilities are not loaded, used by
        /// the gate AND by the handler, so the reason a control is dark and the
        /// reason a press was refused are the same sentence.
        /// </summary>
        private const string NotLoadedDetail =
            "KSP only builds the space centre's facilities while the space centre is on screen, "
            + "so their tiers and prices cannot be read from anywhere else";

        private readonly Type? _scm;
        private readonly Type? _project;
        private readonly Type? _events;
        private readonly Type? _patch;
        private readonly Type? _scenario;
        private readonly Type? _facilityEnum;
        private readonly Type? _research;
        private readonly Type? _highLogic;

        public Rp1FacilityUpgradeCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _project = Rp1Types.Find(ProjectTypeName);
            _events = Rp1Types.Find(EventsTypeName);
            _patch = Rp1Types.Find(PatchTypeName);
            _scenario = Rp1Types.Find(ScenarioTypeName);
            _facilityEnum = Rp1Types.Find(FacilityEnumTypeName);
            _research = Rp1Types.Find(ResearchTypeName);
            _highLogic = Rp1Types.Find(HighLogicTypeName);
        }

        /// <summary>
        /// The command can run: RP-1's construction model and the KSP types the
        /// procedure reads both resolved.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1PersonnelCommands.IsAvailable"/> gives: a method-level
        /// gate on the MANIFEST cannot say why it fired, because a command that
        /// was never declared looks exactly like one nobody wrote. Every method
        /// and constructor lookup happens at the press and refuses with a sentence
        /// naming what was not recognised.</para>
        ///
        /// <para><see cref="_events"/> is deliberately NOT in this test. The event
        /// is a notification to whatever else is watching the queue, and a build
        /// that had renamed it would still enqueue correctly; withholding the
        /// whole command over it would cost an operator a facility upgrade to
        /// protect a fire-and-forget. It is pinned in the manifest and reported by
        /// <see cref="MethodDiagnosis"/> instead.</para>
        /// </summary>
        public bool IsAvailable =>
            _scm != null && _project != null && _patch != null
            && _scenario != null && _facilityEnum != null && _research != null && _highLogic != null;

        /// <summary>
        /// The requirement to declare on the command, so the control is drawn dark
        /// with its reason outside the space centre rather than only answering the
        /// press.
        /// </summary>
        /// <remarks>
        /// No <see cref="CommandRequirement.Needs"/>: the engine decides it with
        /// an empty argument bag, because whether the facilities are loaded at all
        /// does not depend on which one was named.
        /// </remarks>
        public static CommandRequirement FacilitiesRequirement() =>
            new CommandRequirement { Kind = GateKind, Quantity = LiveFacilities };

        public string Kind => GateKind;

        /// <summary>
        /// Whether the space centre's facilities are loaded, which is the one
        /// condition this command turns on that can be answered before an
        /// operator names a building.
        /// </summary>
        /// <remarks>
        /// <para>Reads the registry rather than the scene, for the reason
        /// <see cref="GateKind"/> gives: the scene is a proxy and the refs list is
        /// the thing. It follows that this passes wherever the command would work,
        /// including any future scene KSP decided to build the facilities in,
        /// without this file being told about it.</para>
        ///
        /// <para>Unknown on anything unreadable, which refuses, in keeping with
        /// the rest of this Uplink.</para>
        /// </remarks>
        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var quantity = requirement?.Quantity ?? "";
            if (quantity != LiveFacilities)
            {
                return GateVerdict.Unknown($"RP-1 imposes no facility condition called \"{quantity}\"");
            }

            if (_scenario == null)
            {
                return GateVerdict.Unknown("KSP's facility registry could not be resolved");
            }

            var protos = Rp1Types.StaticValue(_scenario, "protoUpgradeables");
            if (protos == null)
            {
                return GateVerdict.Unknown("KSP's facility registry is not loaded");
            }

            foreach (var entry in Rp1Types.Enumerate(protos))
            {
                foreach (var reference in Rp1Types.Enumerate(
                             Rp1Types.Member(Rp1Types.Member(entry, "Value"), "facilityRefs")))
                {
                    if (reference != null)
                    {
                        return GateVerdict.Pass();
                    }
                }
            }
            return GateVerdict.Fail(CommandErrorCode.WrongScene, NotLoadedDetail);
        }

        /// <summary>
        /// Whether the members this command invokes resolved, as a sentence for a
        /// health fact. Same reasoning as
        /// <see cref="Rp1PersonnelCommands.MethodDiagnosis"/>: a withheld command
        /// and an absent one are indistinguishable from outside, and naming the
        /// member is the difference between "nobody wrote this" and "RP-1 renamed
        /// GetTechGate".
        /// </summary>
        public string MethodDiagnosis()
        {
            if (!IsAvailable)
            {
                return "RP-1 facility-construction types not found";
            }
            try
            {
                var missing = new List<string>();
                if (TechGateMethod() == null)
                {
                    missing.Add("PatchKSCFacilityContextMenu.GetTechGate(string, int)");
                }
                if (_patch == null || Rp1Types.NonPublicStaticMethod(_patch, "IsUpgradeable", 1) == null)
                {
                    missing.Add("PatchKSCFacilityContextMenu.IsUpgradeable(UpgradeableFacility)");
                }
                if (Rp1Types.Constructor(_project!, 5) == null)
                {
                    missing.Add("FacilityUpgradeProject's five-argument constructor");
                }
                if (Rp1Types.StaticMethod(_project!, "AlreadyInProgressByID", 1) == null)
                {
                    missing.Add("FacilityUpgradeProject.AlreadyInProgressByID(string)");
                }
                if (Rp1Types.StaticMethod(_scenario!, "SlashSanitize", 1) == null)
                {
                    missing.Add("ScenarioUpgradeableFacilities.SlashSanitize(string)");
                }
                if (Rp1Types.StaticMethod(_research!, "GetTechnologyState", 1) == null)
                {
                    missing.Add("ResearchAndDevelopment.GetTechnologyState(string)");
                }
                if (_events == null || Rp1Types.StaticValue(_events, "OnFacilityUpgradeQueued") == null)
                {
                    // Reported and never fatal: see IsAvailable.
                    missing.Add("SCMEvents.OnFacilityUpgradeQueued (the queue will still be written, unannounced)");
                }
                return missing.Count == 0
                    ? "every invoked member resolved"
                    : "facility upgrade will refuse at the press: " + string.Join("; ", missing.ToArray()) + " not found";
            }
            catch (Exception ex)
            {
                // Runs from Health, on the Courier thread. A diagnostic that takes
                // the health surface down with it is worse than no diagnostic.
                return "facility upgrade will refuse at the press: a member lookup threw: "
                    + Rp1Types.ExceptionReason(ex);
            }
        }

        /// <summary>
        /// Queues the named facility's NEXT tier as an RP-1 construction project.
        ///
        /// <para>One tier, never a target tier, because that is the only move
        /// RP-1 models: <c>ProcessUpgrade</c> builds a project from
        /// <c>FacilityLevel + 1</c> and there is no such thing as a two-tier
        /// project. A command taking a destination tier would have to queue
        /// several, and the second could not be costed until the first
        /// completed.</para>
        ///
        /// <para>NOT idempotent in the way the set-shaped commands beside it are,
        /// and it cannot be: pressing it twice would mean two tiers. The second
        /// press is refused by RP-1's own
        /// <c>AlreadyInProgressByID</c>, which is what makes a stale view
        /// safe here.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> Upgrade(Rp1FacilityUpgradeArgs? args)
        {
            var named = args?.Facility;
            if (string.IsNullOrWhiteSpace(named))
            {
                return Fail(CommandErrorCode.NotFound, "the command named no facility");
            }

            if (!IsAvailable)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's facility-construction model could not be resolved, so nothing was queued");
            }

            var scm = Rp1Types.StaticValue(_scm!, "Instance");
            if (scm == null)
            {
                return Fail(CommandErrorCode.ModeUnavailable, "RP-1's space centre is not loaded");
            }

            if (Rp1Types.ReadBool(scm, "enabledForSave") != true)
            {
                // Not this Uplink's act at all. On a save RP-1 declines to run in
                // there is no construction queue, the stock purchase is the whole
                // of what happens, and core's career.facility.upgrade is the
                // command for it: Rp1CareerProjectGate passes in exactly this
                // case, so the two commands are never both refused.
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 is not managing this save, so a facility upgrade is the outright purchase "
                    + "career.facility.upgrade makes rather than a construction project");
            }

            var centre = Rp1Types.Member(scm, "ActiveSC");
            if (centre == null)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say which space centre is active, so there is no queue to add to");
            }

            string id;
            try
            {
                var sanitize = Rp1Types.StaticMethod(_scenario!, "SlashSanitize", 1);
                if (sanitize == null)
                {
                    return Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this install has no facility-id normaliser this Uplink recognises, so nothing was queued");
                }
                // KSP's own rule, called rather than copied: an id with a slash is
                // already whole, one without is a bare facility name and is
                // prefixed. Called ONCE, so the project, the in-progress check and
                // the dictionary lookup all see the same string. See trap 3.
                id = sanitize.Invoke(null, new object?[] { named }) as string ?? "";
            }
            catch (Exception ex)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "KSP would not normalise \"" + named + "\" into a facility id: " + Rp1Types.ExceptionReason(ex));
            }

            if (id.Length == 0)
            {
                return Fail(CommandErrorCode.NotFound, "\"" + named + "\" is not a facility id KSP recognises");
            }

            var segments = id.Split('/');
            var leaf = segments[segments.Length - 1];

            object facilityType;
            try
            {
                // See trap 1. Matched to a NAME and never defaulted: RP-1 derives
                // this from the clickable building rather than from the id, and
                // its own fall-through answers VehicleAssemblyBuilding for
                // anything it does not recognise. Queueing an upgrade against the
                // wrong building is worse than refusing one.
                //
                // A name match rather than a bare Enum.Parse, because Parse also
                // accepts an ORDINAL and a comma-separated flags list: "2" would
                // come back as LaunchPad from an id that names no building at all,
                // and the refusal an operator then got would be about the wrong
                // thing entirely.
                if (Array.IndexOf(Enum.GetNames(_facilityEnum!), leaf) < 0)
                {
                    return Fail(
                        CommandErrorCode.NotFound,
                        "\"" + leaf + "\" is not one of KSP's own space-centre facilities, and this command will "
                        + "not guess which building a site of that name upgrades");
                }
                facilityType = Enum.Parse(_facilityEnum!, leaf);
            }
            catch (Exception ex)
            {
                return Fail(
                    CommandErrorCode.NotFound,
                    "\"" + leaf + "\" could not be matched to one of KSP's own space-centre facilities: "
                    + Rp1Types.ExceptionReason(ex));
            }

            if (!TryLiveFacility(id, out var facility))
            {
                return Fail(CommandErrorCode.WrongScene, NotLoadedDetail);
            }

            var upgradeable = IsUpgradeable(facility);
            if (upgradeable == null)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "whether RP-1 upgrades " + leaf + " at all could not be decided, so nothing was queued");
            }
            if (upgradeable == false)
            {
                // RP-1's OWN answer, and the refusal the settled design was
                // missing. See LOCKED FACILITIES in this file's header: RP-1
                // neuters these five to a 1-fund ladder it calls "cosmetic only"
                // and drives their level itself, so a project queued here would
                // cost nothing, finish almost at once and then be overwritten by
                // RP-1's own averaging. Refusing is what stops the new command
                // reintroducing, through its own door, the exact "state RP-1's
                // model has no way to produce" that Rp1CareerProjectGate exists
                // to keep the stock command out of.
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 does not upgrade " + leaf + " as a building: it sets that tier itself from the "
                    + "buildings it does upgrade, and the capacity you are after is a launch complex "
                    + "(rp1.complexes) or the research queue rather than a tier here");
            }

            var currentLevel = ReadLevel(facility, "FacilityLevel");
            var maxLevel = ReadLevel(facility, "MaxLevel");
            if (currentLevel == null || maxLevel == null)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "KSP would not say what tier " + leaf + " is at or how many tiers it has");
            }

            var targetLevel = currentLevel.Value + 1;
            if (targetLevel > maxLevel.Value)
            {
                return Fail(
                    CommandErrorCode.AlreadyAtMaximum,
                    new LimitBreach
                    {
                        Facility = leaf,
                        FacilityLevel = currentLevel.Value,
                        Quantity = "tier",
                        Limit = maxLevel.Value,
                        Actual = targetLevel,
                    });
            }

            string? techGate;
            try
            {
                var gate = TechGateMethod();
                if (gate == null)
                {
                    // The gate is RP-1's rule and it is the reason a tier is
                    // unavailable early in a career. Unreadable means the answer
                    // is unknown, and Unknown refuses here as it does everywhere
                    // else on this Uplink: the operator loses a queueing they can
                    // still do in game.
                    return Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no facility tech gate this Uplink recognises, so whether "
                        + leaf + " tier " + Number(targetLevel) + " is unlocked could not be decided");
                }
                techGate = gate.Invoke(null, new object?[] { id, targetLevel }) as string;
            }
            catch (Exception ex)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's facility tech gate threw, so whether " + leaf + " tier " + Number(targetLevel)
                    + " is unlocked could not be decided: " + Rp1Types.ExceptionReason(ex));
            }

            if (!string.IsNullOrEmpty(techGate))
            {
                var researched = TechIsResearched(techGate!);
                if (researched == null)
                {
                    return Fail(
                        CommandErrorCode.ModeUnavailable,
                        "whether the tech node \"" + techGate + "\" has been researched could not be read, so "
                        + leaf + " tier " + Number(targetLevel) + " was not queued");
                }
                if (researched == false)
                {
                    // NAMED, which is strictly more than RP-1's own path gives: it
                    // returns early here and posts no message at all, so a player
                    // pressing the in-game button sees nothing happen.
                    return Fail(
                        CommandErrorCode.NotUnlocked,
                        "RP-1 gates " + leaf + " tier " + Number(targetLevel) + " behind the tech node \""
                        + techGate + "\", which this save has not researched");
                }
            }

            var inProgress = AlreadyQueued(id);
            if (inProgress == null)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no in-progress check this Uplink recognises, so a second queue entry "
                    + "for " + leaf + " could not be ruled out");
            }
            if (inProgress == true)
            {
                // RP-1's own guard, called rather than reimplemented, and it
                // searches EVERY centre. A per-centre check would let a second
                // entry appear for a facility already queued at another KSC.
                return Fail(
                    CommandErrorCode.WrongState,
                    leaf + " is already in a construction queue, at this space centre or another");
            }

            var cost = UpgradeCost(facility);
            if (cost == null)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "KSP would not price " + leaf + "'s next tier, so nothing was queued");
            }

            var oldCost = CumulativeLevelCost(facility, currentLevel.Value);
            if (oldCost == null)
            {
                // Refused rather than defaulted to zero. This figure is the second
                // argument to SetBP and therefore half of what decides the build
                // DURATION, so a wrong one is a project that finishes at the wrong
                // time with nothing on any surface saying so.
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "KSP would not say what " + leaf + " has cost so far, which is what sets how long the "
                    + "upgrade takes, so nothing was queued");
            }

            object project;
            try
            {
                var constructor = Rp1Types.Constructor(_project!, 5);
                if (constructor == null)
                {
                    return Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no facility upgrade project this Uplink recognises");
                }
                // The last id segment as the display name, which is what
                // ProcessUpgrade passes and therefore what RP-1's own construction
                // window shows.
                project = constructor.Invoke(
                    new object?[] { facilityType, id, targetLevel, currentLevel.Value, leaf })!;
            }
            catch (Exception ex)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 could not build an upgrade project for " + leaf + ": " + Rp1Types.ExceptionReason(ex));
            }

            double buildPoints;
            try
            {
                var setBp = Rp1Types.InstanceMethod(project, "SetBP", 2);
                if (setBp == null)
                {
                    return Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no construction-duration formula this Uplink recognises, so "
                        + leaf + " was not queued");
                }
                // RP-1's ORDER, kept: SetBP reads the project's own FacilityType,
                // which the constructor above set, and cost is written afterwards.
                setBp.Invoke(project, new object?[] { cost.Value, oldCost.Value });
                buildPoints = Rp1Types.ReadDouble(project, "BP") ?? 0.0;
            }
            catch (Exception ex)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 could not work out how long " + leaf + "'s upgrade would take: "
                    + Rp1Types.ExceptionReason(ex));
            }

            // ProcessUpgrade's absolute-value step is deliberately absent: it
            // exists for the DOWNGRADE arm, where the cost arrives negated, and
            // this command only upgrades. GetUpgradeCost is never negative.
            if (!Rp1Types.WriteDouble(project, "cost", cost.Value))
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept a price for " + leaf + "'s upgrade, so it was not queued");
            }

            // Nothing before this line is visible to RP-1, and nothing after it
            // can be taken back by this command: the Add is what makes the project
            // real, and its own Added handler puts the project into the centre's
            // Constructions list and recalculates every build rate.
            try
            {
                var queue = Rp1Types.Member(centre, "FacilityUpgrades");
                var add = queue == null ? null : Rp1Types.InstanceMethod(queue, "Add", 1);
                if (add == null)
                {
                    return Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no facility construction queue this Uplink recognises");
                }
                add.Invoke(queue, new[] { project });
            }
            catch (Exception ex)
            {
                return Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 refused " + leaf + "'s upgrade: " + Rp1Types.ExceptionReason(ex));
            }

            AnnounceQueued(project);

            var funds = Rp1Pricing.FundsBalance();
            return CommandResult<Dictionary<string, object?>>.Ok(new Dictionary<string, object?>
            {
                ["facility"] = leaf,
                ["facilityId"] = id,
                ["currentLevel"] = currentLevel.Value,
                ["targetLevel"] = targetLevel,
                // The house rule, on the answer as well as on the board: what this
                // press committed, and what the career has to meet it with. Funds
                // is null only when KSP's own Funding could not be read, which
                // costs the confirmation its second figure and nothing else.
                ["cost"] = cost.Value,
                ["funds"] = funds,
                ["buildPoints"] = buildPoints,
            });
        }

        /// <summary>
        /// RP-1's own tech gate, <c>private static</c> on a Harmony patch class.
        ///
        /// <para>The ONE non-public member this Uplink reaches, and reached rather
        /// than reproduced because its body is a lookup into a dictionary RP-1
        /// builds from its own <c>KCTBUILDINGTECHS</c> config. Reproducing it
        /// means re-parsing config this Uplink does not own, and drifting from it
        /// silently the day RP-1 changes how that config is merged.</para>
        /// </summary>
        private MethodInfo? TechGateMethod() =>
            _patch == null ? null : Rp1Types.NonPublicStaticMethod(_patch, "GetTechGate", 2);

        /// <summary>
        /// Whether RP-1 upgrades this building at all, asked of RP-1 rather than
        /// worked out here.
        /// </summary>
        /// <remarks>
        /// <para>The second non-public member on the same patch class, and CALLED
        /// rather than reproduced for the same reason the tech gate is: its answer
        /// comes out of <c>Database.LockedFacilities</c>, which RP-1 fills from its
        /// own config, and it matches by a case-insensitive SUBSTRING of the
        /// facility id rather than by the enum. Both halves of that are RP-1's to
        /// change.</para>
        ///
        /// <para>It takes an <c>UpgradeableFacility</c>, which this command has in
        /// hand by the time it asks, so unlike <c>GetFacilityType</c> beside it
        /// this one IS callable on our inputs.</para>
        ///
        /// <para>Null when the answer could not be read, which the caller refuses
        /// on.</para>
        /// </remarks>
        private bool? IsUpgradeable(object facility)
        {
            try
            {
                var method = _patch == null
                    ? null
                    : Rp1Types.NonPublicStaticMethod(_patch, "IsUpgradeable", 1);
                return method?.Invoke(null, new[] { facility }) as bool?;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Whether KSP considers this tech node researched.
        ///
        /// <para>Null when the answer could not be read at all, which the caller
        /// refuses on rather than treating as either verdict. Note that
        /// <c>GetTechnologyState</c> answers <c>Available</c> with no R&amp;D
        /// scenario at all, which is correct: a save without one has no tech tree
        /// to gate on.</para>
        /// </summary>
        private bool? TechIsResearched(string techId)
        {
            try
            {
                var state = Rp1Types.StaticMethod(_research!, "GetTechnologyState", 1);
                var value = state?.Invoke(null, new object?[] { techId });
                return value == null ? (bool?)null : value.ToString() == ResearchedState;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Whether RP-1 already holds a construction project for this facility id,
        /// at ANY of the career's centres.
        ///
        /// <para>Null when the check could not be made, which the caller refuses
        /// on: proceeding without it is how a facility ends up with two projects
        /// racing each other to set its level.</para>
        /// </summary>
        private bool? AlreadyQueued(string id)
        {
            try
            {
                var check = Rp1Types.StaticMethod(_project!, "AlreadyInProgressByID", 1);
                return check?.Invoke(null, new object?[] { id }) as bool?;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The live <c>UpgradeableFacility</c> behind this id, or false when there
        /// is none.
        /// </summary>
        /// <remarks>
        /// <para>A guarded <c>TryGetValue</c> rather than RP-1's own
        /// <c>GetFacilityReferencesById</c>, which is a bare indexer and throws
        /// <see cref="KeyNotFoundException"/> on a missing key where everything
        /// else on this path answers null or empty. See trap 2 in this file's
        /// header.</para>
        ///
        /// <para>An EMPTY refs list is the ordinary answer outside the space
        /// centre and is not an error: see the scene note in the header. The
        /// caller turns it into the scene refusal.</para>
        /// </remarks>
        private bool TryLiveFacility(string id, out object facility)
        {
            facility = null!;
            var protos = _scenario == null ? null : Rp1Types.StaticValue(_scenario, "protoUpgradeables");
            if (protos == null)
            {
                return false;
            }

            // Enumerated as a bare dictionary rather than indexed, so the key
            // comparison is the dictionary's own and a missing key is a miss
            // rather than a throw. KSP keys this by the sanitized id.
            foreach (var entry in Rp1Types.Enumerate(protos))
            {
                if (!string.Equals(Rp1Types.ReadString(entry, "Key"), id, StringComparison.Ordinal))
                {
                    continue;
                }
                foreach (var reference in Rp1Types.Enumerate(
                             Rp1Types.Member(Rp1Types.Member(entry, "Value"), "facilityRefs")))
                {
                    if (reference != null)
                    {
                        facility = reference;
                        return true;
                    }
                }
                return false;
            }
            return false;
        }

        /// <summary>
        /// What KSP charges for this facility's next tier, which is the figure
        /// <c>ProcessUpgrade</c> puts on the project.
        ///
        /// <para>The method is CALLED rather than derived from
        /// <c>upgradeLevels</c>, because it applies the career's own
        /// <c>FundsLossMultiplier</c> and answers zero at the top tier, and a copy
        /// of that arithmetic would disagree with the game the first time either
        /// changed.</para>
        /// </summary>
        private static double? UpgradeCost(object facility)
        {
            try
            {
                var cost = Rp1Types.InstanceMethod(facility, "GetUpgradeCost", 0);
                return cost == null ? (double?)null : Rp1Types.ToDouble(cost.Invoke(facility, null));
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// What this facility has cost to reach its current tier: the sum of every
        /// level cost from tier 0 up to and including the one it stands at, scaled
        /// by the career's funds multiplier while a game is loaded.
        ///
        /// <para>The second argument to <c>SetBP</c>, and therefore half of what
        /// decides the build duration. Reproduced from <c>ProcessUpgrade</c> line
        /// for line, including the <c>LoadedSceneIsGame</c> condition on the
        /// multiplier, because there is no public call that answers it.</para>
        ///
        /// <para>Null on anything unreadable, and the caller refuses rather than
        /// substituting zero: zero here is a legitimate figure for an
        /// un-upgraded facility, so it cannot double as "could not read".</para>
        /// </summary>
        private double? CumulativeLevelCost(object facility, int currentLevel)
        {
            var levels = Rp1Types.Member(facility, "UpgradeLevels");
            if (levels == null)
            {
                return null;
            }

            var total = 0.0;
            var index = 0;
            var seen = 0;
            foreach (var level in Rp1Types.Enumerate(levels))
            {
                if (index++ > currentLevel)
                {
                    break;
                }
                var levelCost = Rp1Types.ToDouble(Rp1Types.Member(level, "levelCost"));
                if (levelCost == null)
                {
                    return null;
                }
                total += levelCost.Value;
                seen++;
            }

            if (seen != currentLevel + 1)
            {
                // The facility reported a tier its own level table does not reach.
                // Nothing sensible can be summed from that, and a partial sum would
                // be a shorter build for no stated reason.
                return null;
            }

            var inGame = Rp1Types.StaticValue(_highLogic!, "LoadedSceneIsGame") as bool?;
            if (inGame == null)
            {
                return null;
            }
            if (inGame == false)
            {
                return total;
            }

            var multiplier = Rp1Types.ToDouble(
                Rp1Types.Member(
                    Rp1Types.Member(
                        Rp1Types.Member(Rp1Types.StaticValue(_highLogic!, "CurrentGame"), "Parameters"),
                        "Career"),
                    "FundsLossMultiplier"));
            return multiplier == null ? (double?)null : total * multiplier.Value;
        }

        /// <summary>
        /// Tells whatever is watching RP-1's queue that a project joined it, the
        /// way RP-1 tells them itself.
        ///
        /// <para>Inside a try/catch and never fatal, for the reason RP-1 wraps its
        /// own fire the same way: a subscriber that throws must not take the
        /// enqueue with it, and by this point the project is already in the queue
        /// and cannot be taken back.</para>
        /// </summary>
        private void AnnounceQueued(object project)
        {
            try
            {
                var raised = _events == null ? null : Rp1Types.StaticValue(_events, "OnFacilityUpgradeQueued");
                var fire = raised == null ? null : Rp1Types.InstanceMethod(raised, "Fire", 1);
                fire?.Invoke(raised, new[] { project });
            }
            catch (Exception)
            {
                // Deliberately swallowed. Nothing an operator can act on, and the
                // enqueue itself succeeded.
            }
        }

        /// <summary>
        /// A tier KSP keeps as an int. Absent rather than zero when unreadable:
        /// zero is a legitimate starting tier, and treating an unreadable member
        /// as one would queue an upgrade against a level nobody answered with.
        /// </summary>
        private static int? ReadLevel(object? target, string name)
        {
            switch (Rp1Types.Member(target, name))
            {
                case int i: return i;
                case long l: return (int)l;
                case short s: return s;
                default: return null;
            }
        }

        private static CommandResult<Dictionary<string, object?>> Fail(CommandErrorCode code, string detail) =>
            CommandResult<Dictionary<string, object?>>.Fail(code, detail);

        private static CommandResult<Dictionary<string, object?>> Fail(CommandErrorCode code, LimitBreach breach) =>
            CommandResult<Dictionary<string, object?>>.Fail(code, breach);

        /// <summary>Grouped, because these are read by a person.</summary>
        private static string Number(int value) => value.ToString("N0", CultureInfo.InvariantCulture);
    }
}
