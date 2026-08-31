// The launch-complex acts that are QUEUED and COST FUNDS: build a complex, renovate
// one, add a pad to one.
//
// WHY THESE THREE ARE APART FROM THE OTHER FOUR. Renaming and demolishing write
// RP-1's own state and take effect at once; there is no figure to get wrong. These
// three put a project on RP-1's construction queue with a PRICE on it, and RP-1
// then draws that price down out of the career's funds as the project progresses.
// A wrong figure here does not throw and does not refuse: it is simply charged.
// The arithmetic lives in Rp1LcCostModel, apart again, with its own provenance
// block and its own pinned suite, because it is the only part of this Uplink that
// is neither an RP-1 call nor a plain read.
//
// WHAT NONE OF THEM DOES: spend anything at the moment it lands. Under RP-1 a
// construction is not a purchase. The project is added to a queue and the funds are
// drawn as it builds, at a rate that FALLS when the career is short, so a complex
// cannot overdraw a career and an up-front affordability check here would refuse
// work RP-1 itself would happily start and simply run slowly. That is the same
// reasoning Rp1FacilityUpgradeCommands' header gives for a facility, and the same
// conclusion: never refuse on affordability, because RP-1 does not.
//
// A NEW COMPLEX IS ALWAYS A PAD. RP-1's own new-complex path assigns
// `lcType = LaunchComplexType.Pad` unconditionally (KCT_GUI:561), and the single
// Hangar a career has is seeded at career start from LCData.StartingHangar. So
// there is no type argument: offering one would offer a choice the game does not
// have and a value whose consequences RP-1's own code paths do not expect.
//
// THE HANGAR IS A DIFFERENT SHAPE OF RENOVATION, not a special case bolted on. It
// has no pad, no tonnage limit and no human-rating toggle: RP-1 forces
// isHumanRated true for it, holds massMax at whatever it already was, and does not
// draw either field. So a modify naming the hangar REFUSES a tonnage or a rating
// rather than discarding it, because a discarded argument is a command that
// reported success for something it did not do.
//
// WHAT IS INVOKED, each of them a write RP-1 itself performs on the same click:
//
//   new LaunchComplex(LCData, LCSpaceCenter)
//                                    ARITY TWO. It copies the specification rather
//                                    than holding ours, registers the complex with
//                                    RP-1's scenario module and hooks its lists
//   new LCLaunchPad(Guid, string, float)
//                                    ARITY THREE, and isOperational starts FALSE:
//                                    a pad is under construction until its project
//                                    completes
//   KCTUtilities.ChangeEngineers(LaunchComplex, -Engineers)
//                                    what takes the complex's whole crew off, which
//                                    RP-1 does FIRST and tells the operator about
//                                    in a dialog. Resolved by first-parameter TYPE
//                                    through Rp1ComplexWrites, because the
//                                    LCSpaceCenter overload has the same arity and
//                                    moving a centre's pool instead would be silent
//   LCSpaceCenter.SwitchToPrevLaunchComplex(bool)
//                                    ARITY ONE: the parameter is optional in C# and
//                                    reflection applies no defaults
//   LaunchComplex.RecalculateBuildRates()
//                                    without it the complex keeps quoting the rate
//                                    it had before it went out of service
//   ConstructionProject.SetBP(double, double)
//                                    the price turned into a build duration, by
//                                    RP-1's own curve. INVOKED rather than
//                                    reimplemented, which is why Formula's
//                                    construction curve is absent from the cost model
//   LCData.SetFrom(LCData)           the COPY a project holds. A project keeping the
//                                    caller's object would change under it
//   PersistentObservableList.Add     on LCConstructions and PadConstructions, and it
//                                    must be the MOST-DERIVED Add: it shadows
//                                    List<T>.Add and fires the events RP-1's own UI
//                                    listens on, so binding to the base overload
//                                    queues the project and tells nobody. RP-1's IL
//                                    calls the derived one on both of these and the
//                                    BASE one on LaunchComplexes and LaunchPads,
//                                    which are plain PersistentList; each is matched
//                                    to whichever RP-1 uses
//   SCMEvents.OnLCConstructionQueued / OnPadConstructionQueued
//                                    fired last and inside their own try, as RP-1
//                                    does: a subscriber that throws must not make a
//                                    queued project report failure
//
// FIELDS WRITTEN DIRECTLY, because no RP-1 method sets them:
//   LaunchComplex.IsOperational      false for the whole of a construction
//   SpaceCenterManagement.StarterLCBuilding
//                                    RP-1's first-run flag, `|= !isModify`. It gates
//                                    RP-1's own start-up guidance, and a career
//                                    whose first complex was ordered from here would
//                                    otherwise still be told to order one
//   LCConstructionProject.lcID / cost / name / isModify / modId / lcData /
//   engineersToReadd, PadConstructionProject.id / cost / name
//                                    the project itself, which RP-1 builds with an
//                                    object initialiser and no constructor
//
// THE CAREER BRANCH IS MIRRORED, not assumed. RP-1 branches on
// ROUtils.KSPUtils.CurrentGameIsCareer(): outside a career it applies the change at
// once and queues nothing, because there is no funding to draw against. Note
// `enabledForSave` is TRUE for sandbox and science-sandbox too, so this is a real
// branch rather than a formality, and it is REFUSED rather than guessed when the
// method will not resolve: queueing a funded project on a save with no funding
// would leave it stalled forever with nothing saying why.
//
// PROVENANCE. Every member named above was read out of an ilspycmd disassembly of
// the INSTALLED RP-1 v4.6.0.0 RP0.dll; the write ORDER is KCT_GUI.ProcessNewLC's,
// and the list-Add resolution was checked against that method's IL rather than its
// decompilation. The disassembly verifies SHAPE and never VALUE: nothing here has
// been exercised against a running game, so every hop is null-safe and every
// failure to read refuses the command rather than guessing at it. The PRICE
// specifically has never been compared against RP-1's own displayed figure, which
// is the one live check this surface most wants (see Rp1LcCostModel's provenance).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The handlers for <c>rp1.complex.new</c>, <c>rp1.complex.modify</c> and
    /// <c>rp1.pad.new</c>.
    /// </summary>
    /// <remarks>
    /// No gate evaluator of its own. All three declare the single static
    /// requirement <see cref="Rp1BuildCommands.Requirements"/> already answers,
    /// because it is the same quantity for all of them (RP-1 is managing this save)
    /// and none of the per-complex conditions can be evaluated before the press.
    /// </remarks>
    public sealed class Rp1ComplexConstructionCommands
    {
        /// <summary>Build a launch complex the career does not have.</summary>
        public const string NewComplexCommand = "rp1.complex.new";

        /// <summary>Renovate a launch complex into a new envelope.</summary>
        public const string ModifyComplexCommand = "rp1.complex.modify";

        /// <summary>Add a launch pad to an existing complex.</summary>
        public const string NewPadCommand = "rp1.pad.new";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string LaunchComplexTypeName = "RP0.LaunchComplex";
        private const string LaunchPadTypeName = "RP0.LCLaunchPad";
        private const string LcDataTypeName = "RP0.LCData";
        private const string LcConstructionTypeName = "RP0.LCConstructionProject";
        private const string PadConstructionTypeName = "RP0.PadConstructionProject";
        private const string DatabaseTypeName = "RP0.Database";
        private const string UtilitiesTypeName = "RP0.KCTUtilities";
        private const string EventsTypeName = "RP0.SCMEvents";
        private const string KspUtilsTypeName = "ROUtils.KSPUtils";
        private const string Vector3TypeName = "UnityEngine.Vector3";

        private readonly Type? _scm;
        private readonly Type? _launchComplex;
        private readonly Type? _launchPad;
        private readonly Type? _lcData;
        private readonly Type? _lcConstruction;
        private readonly Type? _padConstruction;
        private readonly Type? _database;
        private readonly Type? _utilities;
        private readonly Type? _events;
        private readonly Type? _kspUtils;
        private readonly Type? _vector3;

        public Rp1ComplexConstructionCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _launchComplex = Rp1Types.Find(LaunchComplexTypeName);
            _launchPad = Rp1Types.Find(LaunchPadTypeName);
            _lcData = Rp1Types.Find(LcDataTypeName);
            _lcConstruction = Rp1Types.Find(LcConstructionTypeName);
            _padConstruction = Rp1Types.Find(PadConstructionTypeName);
            _database = Rp1Types.Find(DatabaseTypeName);
            _utilities = Rp1Types.Find(UtilitiesTypeName);
            _events = Rp1Types.Find(EventsTypeName);
            _kspUtils = Rp1Types.Find(KspUtilsTypeName);
            _vector3 = Rp1Types.Find(Vector3TypeName);
        }

        /// <summary>
        /// The complex commands can run: RP-1's space centre, its complex, its
        /// specification and its construction project all resolved, plus Unity's
        /// vector, which is the type a specification's envelope is.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1VehicleCommands.IsAvailable"/> spells out at length: a
        /// method-level gate on the MANIFEST cannot say why it fired, because a
        /// command that was never declared looks exactly like one nobody wrote.
        /// The method lookups happen at the press and refuse with a sentence
        /// naming what was not recognised.</para>
        ///
        /// <para><see cref="_events"/> is deliberately NOT part of this, and
        /// <see cref="_database"/> is not either: the first is how RP-1's own UI
        /// hears about a queued project and is fired last, and the second supplies
        /// a price MULTIPLIER that falls back to RP-1's shipped default. Neither
        /// should cost an install its ability to build a complex.</para>
        /// </summary>
        public bool IsAvailable =>
            _scm != null
            && _launchComplex != null
            && _lcData != null
            && _lcConstruction != null
            && _vector3 != null;

        /// <summary>
        /// Adding a pad needs one type the complex commands do not, and does NOT
        /// need the specification type at all: a pad inherits its complex's
        /// envelope rather than carrying one.
        ///
        /// <para>Its own flag for that reason, so a rename that cost RP-1 its
        /// LCData would still leave an operator able to add a pad.</para>
        /// </summary>
        public bool IsPadAvailable =>
            _scm != null && _launchComplex != null && _launchPad != null && _padConstruction != null;

        /// <summary>
        /// Whether the members these commands invoke resolved, as a sentence for a
        /// health fact. The same reasoning as
        /// <see cref="Rp1VehicleCommands.MethodDiagnosis"/>: a withheld command and
        /// an absent one are indistinguishable from outside, and naming the member
        /// is the difference between "nobody wrote this" and "RP-1 reshaped
        /// LaunchComplex's constructor".
        /// </summary>
        public string MethodDiagnosis()
        {
            if (!IsAvailable && !IsPadAvailable)
            {
                return "RP-1 launch-complex construction types not found";
            }

            var missing = new List<string>();
            try
            {
                if (_launchComplex != null
                    && Rp1Types.ConstructorOn(_launchComplex, LcDataTypeName, 2) == null)
                {
                    missing.Add("LaunchComplex(LCData, LCSpaceCenter)");
                }
                if (_launchPad != null && Rp1Types.Constructor(_launchPad, 3) == null)
                {
                    missing.Add("LCLaunchPad(Guid, string, float)");
                }
                if (_lcData != null && Rp1Types.Constructor(_lcData, 0) == null)
                {
                    missing.Add("LCData()");
                }
                if (_lcConstruction != null
                    && Rp1Types.MostDerivedInstanceMethod(_lcConstruction, "SetBP", 2) == null)
                {
                    missing.Add("ConstructionProject.SetBP(double, double)");
                }
                if (_utilities != null && Rp1ComplexWrites.ChangeEngineers(_utilities) == null)
                {
                    missing.Add("KCTUtilities.ChangeEngineers(LaunchComplex, int)");
                }
                if (_kspUtils == null || Rp1Types.StaticMethod(_kspUtils, "CurrentGameIsCareer", 0) == null)
                {
                    missing.Add("KSPUtils.CurrentGameIsCareer()");
                }
            }
            catch (Exception ex)
            {
                // Runs from Health, on the Courier thread. A diagnostic that takes
                // the health surface down with it is worse than no diagnostic.
                return "launch-complex construction will refuse at the press: member lookup threw: "
                    + Rp1Types.ExceptionReason(ex);
            }

            return missing.Count == 0
                ? "every invoked member resolved"
                : "launch-complex construction will refuse at the press: "
                  + string.Join(", ", missing.ToArray()) + " not found";
        }

        // ── Building a complex ────────────────────────────────────────────────

        /// <summary>
        /// Queues a new launch complex at a named space centre.
        ///
        /// <para>Always a PAD, for the reason this file's header gives. Spends
        /// nothing when it lands.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> NewComplex(Rp1ComplexNewArgs? args)
        {
            if (!TryScm(out var scm, out var refusal))
            {
                return Refuse(refusal!);
            }

            var name = Trimmed(args?.Name);
            if (name == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.Range,
                    "enter a name for the new launch complex"));
            }

            var kscName = Trimmed(args?.KscName);
            if (kscName == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no space centre, and a career under KSCSwitcher has several"));
            }

            if (!TryCentre(scm!, kscName, out var centre))
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no space centre called " + kscName + " exists in this career"));
            }

            foreach (var sibling in Rp1Types.Enumerate(Rp1Types.Member(centre, "LaunchComplexes")))
            {
                if (string.Equals(Rp1Types.ReadString(sibling, "Name"), name, StringComparison.OrdinalIgnoreCase))
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.Range,
                        "another launch complex with the same name already exists"));
                }
            }

            var mass = args?.MassMax;
            if (mass == null || mass.Value <= 0.0)
            {
                // RP-1's own words, and its own test: a zero tonnage limit is
                // refused rather than treated as unlimited.
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.Range,
                    "please enter a valid tonnage limit"));
            }

            if (!TrySize(args?.Size, out var size, out var sizeRefusal))
            {
                return Refuse(sizeRefusal!);
            }

            var humanRated = args?.HumanRated;
            if (humanRated == null)
            {
                // Refused rather than defaulted to false: human rating multiplies
                // the pad price by 1.5 and the integration price by 2, so either
                // default would halve or double the cost of the thing being bought.
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the command did not say whether the complex is human-rated, which decides its price"));
            }

            // Built at this tonnage, and that fixes the renovation envelope for the
            // complex's whole life: RP-1 holds every later modify to double and half
            // of massOrig, never of the current limit.
            if (!TryBuildSpec(
                    name,
                    (float)mass.Value,
                    (float)mass.Value,
                    size,
                    humanRated.Value,
                    isHangar: false,
                    args?.Resources,
                    out var spec,
                    out var specRefusal))
            {
                return Refuse(specRefusal!);
            }

            var quote = Rp1LcCostModel.QuoteNew(
                spec!, _launchComplex!, Rp1LcCostModel.AdditionalPadCostMult(_database));
            if (quote == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not price a complex of that specification, so nothing was queued"));
            }

            if (!TryCareer(out var career, out var careerRefusal))
            {
                return Refuse(careerRefusal!);
            }

            object complex;
            try
            {
                complex = Construct(_launchComplex!, LcDataTypeName, 2, spec!, centre);
            }
            catch (Exception ex)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not build a launch complex from that specification: "
                    + Rp1Types.ExceptionReason(ex)));
            }

            // RP-1's first-run flag, and it is set for a build whether or not the
            // save is a career: `StarterLCBuilding |= !isModify`, before the branch.
            Rp1Types.WriteMember(scm, "StarterLCBuilding", true);

            if (!career)
            {
                // No funding to draw against, so RP-1 applies the change at once.
                Rp1Types.WriteMember(complex, "IsOperational", true);
                if (!TryAddToList(centre, "LaunchComplexes", complex, observable: false, out var addRefusal))
                {
                    return Refuse(addRefusal!);
                }
                return Ok(name, quote, queued: false);
            }

            Rp1Types.WriteMember(complex, "IsOperational", false);
            if (!TryAddToList(centre, "LaunchComplexes", complex, observable: false, out var listRefusal))
            {
                return Refuse(listRefusal!);
            }

            if (!TryQueueComplex(
                    centre,
                    complex,
                    spec!,
                    name,
                    quote,
                    isModify: false,
                    engineersToReadd: args?.AssignEngineersOnComplete == true ? quote.MaxEngineers : 0,
                    out var queueRefusal))
            {
                return Refuse(queueRefusal!);
            }

            return Ok(name, quote, queued: true);
        }

        // ── Renovating a complex ──────────────────────────────────────────────

        /// <summary>
        /// Queues a renovation of an existing complex into a new envelope.
        ///
        /// <para><b>It takes the complex's whole crew off</b>, which is not a side
        /// effect this Uplink chose: RP-1 does it first and says so in a dialog. The
        /// returned payload reports how many, so a client can repeat the game's own
        /// sentence rather than inventing one.</para>
        ///
        /// <para><b>A reduction still costs.</b> The payload carries
        /// <c>isDowngrade</c> for exactly that: an operator shrinking a complex is
        /// the one most likely to expect a refund.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> ModifyComplex(Rp1ComplexModifyArgs? args)
        {
            if (!TryScm(out var scm, out var refusal))
            {
                return Refuse(refusal!);
            }

            var lcId = args?.LcId;
            if (string.IsNullOrWhiteSpace(lcId))
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no launch complex"));
            }

            if (!Rp1ComplexWrites.TryFind(scm!, lcId!, out var complex))
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no launch complex with that id exists at any space centre"));
            }

            var name = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";
            var isHangar = string.Equals(
                Rp1Types.ReadEnumName(complex, "LCType"), "Hangar", StringComparison.Ordinal);

            if (!TrySize(args?.Size, out var size, out var sizeRefusal))
            {
                return Refuse(sizeRefusal!);
            }

            // RP-1's own gate on a renovation, and the WEAKER of its two: unlike a
            // dismantle it permits a complex with vehicles in it, and refuses only
            // one with an operation moving a vehicle.
            var canModify = Rp1Types.ReadBool(complex, "CanModifyReal");
            if (canModify == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say whether " + name + " can be renovated, so nothing was queued"));
            }
            if (canModify != true)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "please wait for any rollout, rollback, or recovery at " + name + " to complete"));
            }

            var currentMass = Rp1Types.ReadDouble(complex, "MassMax");
            var currentOrig = Rp1Types.ReadDouble(complex, "MassOrig");
            var currentHumanRated = Rp1Types.ReadBool(complex, "IsHumanRated");
            if (currentMass == null || currentOrig == null || currentHumanRated == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say what " + name + " is built to, so nothing was queued"));
            }

            double mass;
            bool humanRated;
            if (isHangar)
            {
                // RP-1 draws neither field for the hangar and forces the rating
                // true. Refused rather than discarded: a discarded argument is a
                // command that reported success for something it did not do.
                if (args?.MassMax != null)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.Range,
                        "the hangar has no tonnage limit, so it cannot be renovated to one"));
                }
                if (args?.HumanRated != null)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.Range,
                        "the hangar is always human-rated, so that cannot be changed"));
                }
                mass = currentMass.Value;
                humanRated = true;
            }
            else
            {
                if (args?.MassMax == null || args.MassMax.Value <= 0.0)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.Range,
                        "please enter a valid tonnage limit"));
                }
                if (args?.HumanRated == null)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.Range,
                        "the command did not say whether the complex is human-rated, which decides its price"));
                }
                mass = args.MassMax.Value;
                humanRated = args.HumanRated.Value;
            }

            // massOrig is the complex's BUILD tonnage, carried through unchanged: it
            // fixes the renovation envelope and it is the curve the per-metre charge
            // is lerped over, so substituting the new limit would both widen the
            // envelope illegally and misprice every axis.
            if (!TryBuildSpec(
                    name,
                    (float)mass,
                    (float)currentOrig.Value,
                    size,
                    humanRated,
                    isHangar,
                    args?.Resources,
                    out var spec,
                    out var specRefusal))
            {
                return Refuse(specRefusal!);
            }

            if (!isHangar && !TryWithinEnvelope(spec!, out var envelopeRefusal))
            {
                return Refuse(envelopeRefusal!);
            }

            // RP-1's ModifyFailure, which names every vehicle the new limits would
            // strand. Ours names them the same way and refuses the whole command:
            // a renovation that stranded a half-built vehicle would leave it
            // unbuildable at the only complex that holds it.
            if (Stranded(complex, spec!, out var stranded))
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the new limits and supported resources for " + name
                    + " are incompatible with " + stranded
                    + ". Either scrap those vehicles or choose settings that still support them"));
            }

            var currentSpec = Rp1Types.Member(complex, "Stats");
            if (currentSpec == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say what " + name + " is specified as, so nothing was queued"));
            }

            var padCount = Rp1Types.Member(complex, "LaunchPadCount") as int?;
            if (padCount == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say how many working pads " + name + " has, so nothing was queued"));
            }

            var quote = Rp1LcCostModel.QuoteModify(
                spec!,
                complex,
                currentSpec,
                isHangar,
                padCount.Value,
                _launchComplex!,
                Rp1LcCostModel.AdditionalPadCostMult(_database));
            if (quote == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not price that renovation of " + name + ", so nothing was queued"));
            }

            if (!TryCareer(out var career, out var careerRefusal))
            {
                return Refuse(careerRefusal!);
            }

            var centre = Rp1Types.Member(complex, "KSC");
            var engineers = Rp1Types.Member(complex, "Engineers") as int? ?? 0;

            if (!career)
            {
                // Applied at once, as RP-1 does outside a career. Modify takes a
                // fresh generation id so a vehicle integrated under the old limits
                // can still be told apart.
                var modify = Rp1Types.InstanceMethodOn(complex, "Modify", LcDataTypeName, 2);
                if (modify == null)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no complex renovation this Uplink recognises, so nothing was changed"));
                }
                try
                {
                    modify.Invoke(complex, new object[] { spec!, Guid.NewGuid() });
                }
                catch (Exception ex)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1 failed part-way through renovating " + name + ": " + Rp1Types.ExceptionReason(ex)));
                }
                return Ok(name, quote, queued: false, engineersUnassigned: 0);
            }

            // RP-1's order, and it matters: the staff target goes before the crew
            // move, because clearing it afterwards would clear an order the crew
            // move had already invalidated.
            var staffTarget = Rp1Types.Member(scm, "staffTarget");
            var complexId = Rp1Types.ReadGuidString(complex, "ID");
            if (staffTarget != null
                && complexId != null
                && string.Equals(Rp1Types.ReadGuidString(staffTarget, "LCID"), complexId, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    Rp1Types.InstanceMethod(staffTarget, "Clear", 0)?.Invoke(staffTarget, Array.Empty<object>());
                }
                catch (Exception)
                {
                    // Fail-soft on purpose. A standing hire order that outlived the
                    // complex it named is a stale instruction, not a corrupt save,
                    // and it must not cost the operator the renovation.
                }
            }

            if (engineers > 0)
            {
                var changeEngineers = Rp1ComplexWrites.ChangeEngineers(_utilities);
                if (changeEngineers == null)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no engineer assignment this Uplink recognises, so "
                        + name + " was left as it was"));
                }
                try
                {
                    changeEngineers.Invoke(null, new object[] { complex, -engineers });
                }
                catch (Exception ex)
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1 failed taking " + name + "'s crew off, so check the complex before retrying: "
                        + Rp1Types.ExceptionReason(ex)));
                }
            }

            try
            {
                Rp1Types.InstanceMethod(centre!, "SwitchToPrevLaunchComplex", 1)
                    ?.Invoke(centre, new object[] { false });
            }
            catch (Exception)
            {
                // Cosmetic: it moves the GAME's own selection off a complex about to
                // go out of service. Not worth abandoning a renovation for.
            }

            // Every in-flight pad construction is repriced to the NEW pad cost,
            // because the renovation rebuilds the pads too. See Rp1LcCostModel's
            // header for why this figure is always multiplied.
            foreach (var padProject in Rp1Types.Enumerate(Rp1Types.Member(complex, "PadConstructions")))
            {
                SetBp(padProject, quote.PadCost, 0.0);
                Rp1Types.WriteDouble(padProject, "cost", quote.PadCost);
            }

            Rp1Types.WriteMember(complex, "IsOperational", false);
            try
            {
                Rp1Types.InstanceMethod(complex, "RecalculateBuildRates", 0)
                    ?.Invoke(complex, Array.Empty<object>());
            }
            catch (Exception)
            {
                // Fail-soft: without it the complex quotes the rate it had before it
                // went out of service, which RP-1 will correct itself on its next
                // recalculation.
            }

            if (!TryQueueComplex(
                    centre,
                    complex,
                    spec!,
                    name,
                    quote,
                    isModify: true,
                    engineersToReadd: args?.AssignEngineersOnComplete == true ? engineers : 0,
                    out var queueRefusal))
            {
                return Refuse(queueRefusal!);
            }

            return Ok(name, quote, queued: true, engineersUnassigned: engineers);
        }

        // ── Adding a pad ─────────────────────────────────────────────────────

        /// <summary>
        /// Queues a new launch pad at an existing complex.
        ///
        /// <para>The pad inherits the complex's envelope and cannot have one of its
        /// own, so this carries a name and nothing else. Priced at the complex's own
        /// pad cost times RP-1's additional-pad multiplier.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> NewPad(Rp1PadNewArgs? args)
        {
            if (!IsPadAvailable)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's launch-pad model could not be resolved, so nothing was queued"));
            }

            if (!TryScm(out var scm, out var refusal))
            {
                return Refuse(refusal!);
            }

            var lcId = args?.LcId;
            if (string.IsNullOrWhiteSpace(lcId))
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no launch complex"));
            }

            if (!Rp1ComplexWrites.TryFind(scm!, lcId!, out var complex))
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no launch complex with that id exists at any space centre"));
            }

            var complexName = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";

            if (string.Equals(Rp1Types.ReadEnumName(complex, "LCType"), "Hangar", StringComparison.Ordinal))
            {
                // A hangar has no pads at all: RP-1 prices its pad half at zero and
                // never draws the control. A pad queued here would cost nothing and
                // do nothing.
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "the hangar has no launch pads, so one cannot be added to it"));
            }

            var name = Trimmed(args?.Name);
            if (name == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.Range,
                    "enter a name for the new launchpad"));
            }

            foreach (var sibling in Rp1Types.Enumerate(Rp1Types.Member(complex, "LaunchPads")))
            {
                if (string.Equals(Rp1Types.ReadString(sibling, "name"), name, StringComparison.OrdinalIgnoreCase))
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.Range,
                        "another launchpad with the same name already exists"));
                }
            }

            var spec = Rp1Types.Member(complex, "Stats");
            if (spec == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say what " + complexName + " is specified as, so nothing was queued"));
            }

            var level = Rp1LcCostModel.PadFracLevel(spec);
            if (level == null || level.Value < 0.0)
            {
                // -1 is RP-1's "no band", which happens when its tonnage table is
                // absent. A pad built at that level would be unusable.
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say what tonnage band a pad at " + complexName
                    + " builds at, so nothing was queued"));
            }

            var padCost = Rp1LcCostModel.PadCostFor(spec, Rp1LcCostModel.AdditionalPadCostMult(_database));
            if (padCost == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not price a pad at " + complexName + ", so nothing was queued"));
            }

            if (!TryCareer(out var career, out var careerRefusal))
            {
                return Refuse(careerRefusal!);
            }

            var padId = Guid.NewGuid();
            object pad;
            try
            {
                pad = Construct(_launchPad!, "System.Guid", 3, padId, name, (float)level.Value);
            }
            catch (Exception ex)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not build a launch pad at " + complexName + ": " + Rp1Types.ExceptionReason(ex)));
            }

            // The pad joins the complex either way. RP-1 adds it BEFORE queueing its
            // construction, and the pad's own isOperational is what says whether it
            // is in service: a pad in the list and not operational is exactly a pad
            // being built.
            if (!TryAddToList(complex, "LaunchPads", pad, observable: false, out var addRefusal))
            {
                return Refuse(addRefusal!);
            }

            if (!career)
            {
                Rp1Types.WriteMember(pad, "isOperational", true);
                return PadOk(complexName, name, padCost.Value, queued: false);
            }

            object project;
            try
            {
                project = Activator.CreateInstance(_padConstruction!)!;
            }
            catch (Exception ex)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not create a pad construction project: " + Rp1Types.ExceptionReason(ex)));
            }

            Rp1Types.WriteMember(project, "id", padId);
            Rp1Types.WriteMember(project, "name", name);
            Rp1Types.WriteDouble(project, "cost", padCost.Value);
            SetBp(project, padCost.Value, 0.0);

            if (!TryAddToList(complex, "PadConstructions", project, observable: true, out var queueRefusal))
            {
                return Refuse(queueRefusal!);
            }

            Fire("OnPadConstructionQueued", project, pad);

            return PadOk(complexName, name, padCost.Value, queued: true);
        }

        // ── Shared resolution ────────────────────────────────────────────────

        private bool TryScm(out object? scm, out CommandResult? refusal)
        {
            scm = null;

            if (!IsAvailable && !IsPadAvailable)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's launch-complex model could not be resolved, so nothing was queued");
                return false;
            }

            scm = Rp1Types.StaticValue(_scm!, "Instance");
            if (scm == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's space centre is not loaded");
                return false;
            }

            if (Rp1Types.ReadBool(scm, "enabledForSave") != true)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 is not managing this save");
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// Whether this save is a career, which decides whether a construction is
        /// QUEUED or applied at once.
        ///
        /// <para>REFUSED rather than assumed when RP-1's own test will not resolve.
        /// <c>enabledForSave</c> is true for sandbox and science-sandbox as well as
        /// career, so guessing "career" would queue a funded project on a save with
        /// no funding to draw against and leave it stalled forever with nothing
        /// saying why.</para>
        /// </summary>
        private bool TryCareer(out bool career, out CommandResult? refusal)
        {
            career = false;

            var test = _kspUtils == null
                ? null
                : Rp1Types.StaticMethod(_kspUtils, "CurrentGameIsCareer", 0);
            if (test == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no career test this Uplink recognises, and construction behaves "
                    + "differently in a career, so nothing was queued");
                return false;
            }

            try
            {
                if (test.Invoke(null, Array.Empty<object>()) is not bool answer)
                {
                    refusal = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1 would not say whether this save is a career, so nothing was queued");
                    return false;
                }
                career = answer;
            }
            catch (Exception ex)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's career test threw, so nothing was queued: " + Rp1Types.ExceptionReason(ex));
                return false;
            }

            refusal = null;
            return true;
        }

        private static bool TryCentre(object scm, string kscName, out object centre)
        {
            foreach (var candidate in Rp1Types.Enumerate(Rp1Types.Member(scm, "KSCs")))
            {
                if (string.Equals(Rp1Types.ReadString(candidate, "KSCName"), kscName, StringComparison.OrdinalIgnoreCase))
                {
                    centre = candidate;
                    return true;
                }
            }
            centre = null!;
            return false;
        }

        /// <summary>
        /// The three axes as a Unity vector, refused rather than defaulted per axis.
        ///
        /// <para>RP-1 refuses a zero vector outright ("please enter a valid size"),
        /// and the axes price independently, so a substituted default on any one of
        /// them would build to an envelope nobody chose.</para>
        /// </summary>
        private bool TrySize(Rp1ComplexSizeArgs? args, out object size, out CommandResult? refusal)
        {
            size = null!;

            var width = args?.SizeMaxWidth;
            var height = args?.SizeMaxHeight;
            var depth = args?.SizeMaxDepth;
            if (width == null || height == null || depth == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the command did not give all three size limits, and each is priced separately");
                return false;
            }

            if (width.Value <= 0.0 || height.Value <= 0.0 || depth.Value <= 0.0)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.Range,
                    "please enter a valid size");
                return false;
            }

            try
            {
                size = Activator.CreateInstance(
                    _vector3!,
                    new object[] { (float)width.Value, (float)height.Value, (float)depth.Value })!;
            }
            catch (Exception ex)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this install's size vector could not be built: " + Rp1Types.ExceptionReason(ex));
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// An <c>LCData</c> carrying the asked-for specification, with its resources
        /// validated against RP-1's own catalogue.
        /// </summary>
        private bool TryBuildSpec(
            string name,
            float massMax,
            float massOrig,
            object size,
            bool humanRated,
            bool isHangar,
            Dictionary<string, double>? resources,
            out object? spec,
            out CommandResult? refusal)
        {
            spec = null;

            try
            {
                spec = Activator.CreateInstance(_lcData!)!;
            }
            catch (Exception ex)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not create a launch-complex specification: " + Rp1Types.ExceptionReason(ex));
                return false;
            }

            var written =
                Rp1Types.WriteMember(spec, "Name", name)
                && Rp1Types.WriteMember(spec, "massMax", massMax)
                && Rp1Types.WriteMember(spec, "massOrig", massOrig)
                && Rp1Types.WriteMember(spec, "sizeMax", size)
                && Rp1Types.WriteMember(spec, "isHumanRated", humanRated);
            if (!written)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept a launch-complex specification from this Uplink, so nothing was queued");
                return false;
            }

            // A hangar keeps its own kind. Every complex this Uplink CREATES is a
            // Pad, which is LCData's own default, so nothing is written for it.
            if (isHangar && !WriteLcType(spec, "Hangar"))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept the hangar's own complex type, so nothing was queued");
                return false;
            }

            if (!TryWriteResources(spec, resources, isHangar, out refusal))
            {
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// The complex's fluids, validated by name against RP-1's own list and
        /// rounded up as RP-1's own field rounds them.
        /// </summary>
        private bool TryWriteResources(
            object spec,
            Dictionary<string, double>? resources,
            bool isHangar,
            out CommandResult? refusal)
        {
            refusal = null;
            if (resources == null || resources.Count == 0)
            {
                return true;
            }

            var handled = Rp1LcCostModel.HandledResourceNames(_database, isHangar);
            if (handled == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's resource catalogue could not be read, so the complex's fluids could not be checked");
                return false;
            }

            if (Rp1Types.Member(spec, "resourcesHandled") is not IDictionary bag)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept a resource list from this Uplink, so nothing was queued");
                return false;
            }

            foreach (var entry in resources)
            {
                var known = false;
                foreach (var candidate in handled)
                {
                    if (string.Equals(candidate, entry.Key, StringComparison.Ordinal))
                    {
                        known = true;
                        break;
                    }
                }

                if (!known)
                {
                    // Refused by NAME rather than dropped. RP-1 stores an unhandled
                    // resource silently and prices it at nothing, so a dropped one
                    // is a complex that cannot fuel the vehicle it was built for and
                    // says nothing about why.
                    refusal = CommandResult.Fail(
                        CommandErrorCode.Range,
                        (isHangar ? "the hangar" : "a launch complex")
                        + " cannot handle " + entry.Key + ", so it was not queued");
                    return false;
                }

                if (entry.Value <= 0.0)
                {
                    // Zero is how a client REMOVES a resource, and RP-1 stores it by
                    // absence rather than as a zero. Dropping it here is what makes
                    // "send the whole set" mean what it says.
                    continue;
                }

                try
                {
                    bag[entry.Key] = Math.Ceiling(entry.Value);
                }
                catch (Exception ex)
                {
                    refusal = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1 would not accept " + entry.Key + " on a launch complex: "
                        + Rp1Types.ExceptionReason(ex));
                    return false;
                }
            }

            return true;
        }

        /// <summary>
        /// Whether the asked-for tonnage is inside the complex's renovation
        /// envelope, in RP-1's own words when it is not.
        /// </summary>
        private static bool TryWithinEnvelope(object spec, out CommandResult? refusal)
        {
            var within = Rp1LcCostModel.IsMassWithinMargins(spec);
            if (within == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say whether that tonnage is inside the complex's renovation limits");
                return false;
            }
            if (within == true)
            {
                refusal = null;
                return true;
            }

            var max = Rp1LcCostModel.MaxPossibleMass(spec);
            var min = Rp1LcCostModel.MinPossibleMass(spec);
            var asked = Rp1Types.ReadDouble(spec, "massMax");

            // Which of the two limits was crossed, in RP-1's own wording for each.
            refusal = CommandResult.Fail(
                CommandErrorCode.Range,
                asked != null && max != null && asked.Value > max.Value
                    ? "cannot upgrade tonnage above the limit of " + Tonnes(max.Value)
                    : "cannot downgrade tonnage below the limit of " + Tonnes(min ?? 0.0));
            return false;
        }

        /// <summary>
        /// Every vehicle at the complex the new specification would strand, named.
        ///
        /// <para>RP-1's own <c>ModifyFailure</c>, over both the build list and the
        /// warehouse: a vehicle that no longer meets the complex's limits could
        /// never be finished or launched from the only complex that holds it.</para>
        /// </summary>
        private static bool Stranded(object complex, object spec, out string named)
        {
            var names = new List<string>();

            foreach (var list in new[] { "BuildList", "Warehouse" })
            {
                foreach (var vessel in Rp1Types.Enumerate(Rp1Types.Member(complex, list)))
                {
                    // ARITY THREE, and matched on its first parameter's TYPE. RP-1
                    // declares MeetsFacilityRequirements twice: (List<string>) and
                    // (LCData, List<string>, bool shortReasons = false). The one this
                    // needs is the second, its third argument is DEFAULTED, and
                    // reflection applies no defaults, so a lookup at arity 1 or 2
                    // finds nothing at all. This was written at arity 1 first and the
                    // strand check silently never fired: the fail-soft below treats an
                    // unresolvable member as "cannot ask", which is right for
                    // robustness and is exactly what hid it.
                    var meets = Rp1Types.InstanceMethodOn(vessel, "MeetsFacilityRequirements", LcDataTypeName, 3);
                    if (meets == null)
                    {
                        // Cannot ask, so cannot refuse: RP-1 re-checks the vehicles
                        // itself when the renovation completes.
                        continue;
                    }
                    try
                    {
                        if (meets.Invoke(vessel, new[] { spec, null, (object)false }) as bool? == false)
                        {
                            names.Add(Rp1Types.ReadString(vessel, "shipName") ?? "an unnamed vehicle");
                        }
                    }
                    catch (Exception)
                    {
                        // Same reasoning: an unanswerable question is not a refusal.
                    }
                }
            }

            named = string.Join(", ", names.ToArray());
            return names.Count > 0;
        }

        /// <summary>
        /// Puts an <c>LCConstructionProject</c> on the centre's queue, priced and
        /// timed, and tells RP-1's own UI about it.
        /// </summary>
        private bool TryQueueComplex(
            object? centre,
            object complex,
            object spec,
            string name,
            Rp1LcCostModel.Quote quote,
            bool isModify,
            int engineersToReadd,
            out CommandResult? refusal)
        {
            object project;
            try
            {
                project = Activator.CreateInstance(_lcConstruction!)!;
            }
            catch (Exception ex)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not create a construction project for " + name + ": "
                    + Rp1Types.ExceptionReason(ex));
                return false;
            }

            // A COPY of the specification rather than ours, which is what RP-1 does:
            // a project holding the caller's object would change under it.
            object? held;
            try
            {
                held = Activator.CreateInstance(_lcData!)!;
                Rp1Types.InstanceMethodOn(held, "SetFrom", LcDataTypeName, 1)
                    ?.Invoke(held, new[] { spec });
            }
            catch (Exception ex)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not copy the specification for " + name + ": " + Rp1Types.ExceptionReason(ex));
                return false;
            }

            var complexId = Rp1Types.Member(complex, "ID");
            // A fresh generation for a renovation and the complex's own for a build,
            // which is how RP-1 stamps a specification's generation so a vehicle
            // integrated under the old limits can be told apart.
            var modId = isModify ? Guid.NewGuid() : Rp1Types.Member(complex, "ModID");

            var written =
                Rp1Types.WriteMember(project, "lcID", complexId)
                && Rp1Types.WriteMember(project, "name", name)
                && Rp1Types.WriteMember(project, "isModify", isModify)
                && Rp1Types.WriteMember(project, "modId", modId)
                && Rp1Types.WriteMember(project, "lcData", held)
                && Rp1Types.WriteDouble(project, "cost", quote.TotalCost);
            if (!written)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept a construction project from this Uplink, so " + name
                    + " was left as it was");
                return false;
            }

            if (engineersToReadd != 0)
            {
                Rp1Types.WriteMember(project, "engineersToReadd", engineersToReadd);
            }

            if (!SetBp(project, quote.TotalCost, quote.OldTotalCost))
            {
                // The duration, by RP-1's own curve. Refused rather than left at
                // zero: a project with no build points is one RP-1 treats as already
                // finished.
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no construction timing this Uplink recognises, so " + name
                    + " was left as it was");
                return false;
            }

            if (!TryAddToList(centre, "LCConstructions", project, observable: true, out refusal))
            {
                return false;
            }

            Fire("OnLCConstructionQueued", project, complex);

            refusal = null;
            return true;
        }

        /// <summary>
        /// Adds to one of RP-1's lists, binding to the Add overload RP-1's own IL
        /// binds to for that list.
        /// </summary>
        /// <param name="observable">
        /// The list is a <c>PersistentObservableList</c> whose <c>Add</c> SHADOWS
        /// <c>List&lt;T&gt;.Add</c> and fires the events RP-1's UI listens on. True
        /// for <c>LCConstructions</c> and <c>PadConstructions</c>, false for
        /// <c>LaunchComplexes</c> and <c>LaunchPads</c>, which are plain
        /// <c>PersistentList</c> and which RP-1 adds to through the base overload.
        /// Binding to the wrong one queues the item and tells nobody.
        /// </param>
        private static bool TryAddToList(
            object? owner,
            string listName,
            object item,
            bool observable,
            out CommandResult? refusal)
        {
            var list = Rp1Types.Member(owner, listName);
            if (list == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's " + listName + " could not be read, so nothing was queued");
                return false;
            }

            var add = observable
                ? Rp1Types.MostDerivedInstanceMethod(list.GetType(), "Add", 1)
                : Rp1Types.InstanceMethod(list, "Add", 1);
            if (add == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's " + listName + " would not accept an entry from this Uplink, so nothing was queued");
                return false;
            }

            try
            {
                add.Invoke(list, new[] { item });
            }
            catch (Exception ex)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 rejected the entry for its " + listName + ": " + Rp1Types.ExceptionReason(ex));
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// Turns a price into a build duration by RP-1's own curve, which is
        /// INVOKED rather than reimplemented: it is the one piece of the
        /// construction arithmetic that has a reusable entry point.
        /// </summary>
        private static bool SetBp(object project, double cost, double oldCost)
        {
            var setBp = Rp1Types.MostDerivedInstanceMethod(project.GetType(), "SetBP", 2);
            if (setBp == null)
            {
                return false;
            }
            try
            {
                setBp.Invoke(project, new object[] { cost, oldCost });
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>Writes an RP-1 enum member by NAME, since this assembly has no such type.</summary>
        private bool WriteLcType(object spec, string member)
        {
            var field = _lcData?.GetField("lcType", BindingFlags.Public | BindingFlags.Instance);
            if (field == null)
            {
                return false;
            }
            try
            {
                Rp1Types.WriteMember(spec, "lcType", Enum.Parse(field.FieldType, member));
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Fires one of RP-1's two-argument queue events, inside its own try,
        /// exactly as RP-1 does: a subscriber that throws must not make a queued
        /// project report failure.
        /// </summary>
        private void Fire(string eventName, object first, object second)
        {
            if (_events == null)
            {
                return;
            }
            try
            {
                var bus = Rp1Types.StaticValue(_events, eventName);
                if (bus == null)
                {
                    return;
                }
                Rp1Types.InstanceMethod(bus, "Fire", 2)?.Invoke(bus, new[] { first, second });
            }
            catch (Exception)
            {
                // Deliberately swallowed, as RP-1 swallows it.
            }
        }

        private static object Construct(Type type, string firstParameterTypeName, int arity, params object[] arguments)
        {
            var constructor = Rp1Types.ConstructorOn(type, firstParameterTypeName, arity)
                ?? throw new MissingMethodException(type.FullName, ".ctor");
            return constructor.Invoke(arguments);
        }

        /// <summary>What the command did, so a client can say it rather than guess.</summary>
        private static CommandResult<Dictionary<string, object?>> Ok(
            string name,
            Rp1LcCostModel.Quote quote,
            bool queued,
            int engineersUnassigned = 0) =>
            CommandResult<Dictionary<string, object?>>.Ok(new Dictionary<string, object?>
            {
                ["name"] = name,
                ["cost"] = quote.TotalCost,
                // The two facts an operator most needs back, and neither is
                // derivable from the cost alone: whether they have just been billed
                // for making something smaller, and how many engineers went home.
                ["isDowngrade"] = quote.IsDowngrade,
                ["engineersUnassigned"] = engineersUnassigned,
                ["maxEngineers"] = quote.MaxEngineers,
                // False outside a career, where RP-1 applies the change at once and
                // there is no project to watch.
                ["queued"] = queued,
            });

        private static CommandResult<Dictionary<string, object?>> PadOk(
            string complexName,
            string padName,
            double cost,
            bool queued) =>
            CommandResult<Dictionary<string, object?>>.Ok(new Dictionary<string, object?>
            {
                ["name"] = padName,
                ["complex"] = complexName,
                ["cost"] = cost,
                ["queued"] = queued,
            });

        private static CommandResult<Dictionary<string, object?>> Refuse(CommandResult refusal) =>
            CommandResult<Dictionary<string, object?>>.Fail(refusal.ErrorCode, refusal.Detail);

        /// <summary>A tonnage as a person reads it, for RP-1's own refusal wording.</summary>
        private static string Tonnes(double value) =>
            value.ToString("N0", CultureInfo.InvariantCulture) + "t";

        /// <summary>A trimmed non-empty string, or absent. Whitespace is not a name.</summary>
        private static string? Trimmed(string? value) =>
            string.IsNullOrWhiteSpace(value) ? null : value!.Trim();
    }
}
