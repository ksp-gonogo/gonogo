// The rest of RP-1's build-queue write surface: move a finished vehicle to a
// pad, bring it back, scrap it, and put a launch complex into rush mode. Same
// arm's-length reflection as Rp1BuildCommands, whose header carries the
// provenance rules and the money argument this file inherits.
//
// WHAT WAS STILL WRONG after the repeat-build command shipped. An operator could
// ask a complex to integrate another vehicle and then could not do a single
// thing with the vehicle that came out: not move it to a pad, not change their
// mind, not correct a queue they had filled by mistake. Every one of those is
// reachable in RP-1's own window and none of them was reachable from here.
//
// THE MONEY, and why this file has no currency query while Rp1BuildCommands does.
// Each of the four was checked against the shipped disassembly separately rather
// than assumed to behave like a purchase, and none of them is one:
//
//   ROLL OUT is billed AS IT PROGRESSES and RP-1 polices it itself.
//   ReconRolloutProject's constructor sets cost from Formula.GetRolloutCost and
//   touches Funding not at all. The charge happens in
//   LCOpsProject.IncrementProgress, which per tick runs its OWN
//   CurrencyModifierQueryRP0 for that tick's slice and, when the career cannot
//   cover it, THROTTLES progress to CurrencyUtils.GetAffordableFundsFraction and
//   spends only that. So a rollout cannot overdraw a career, which is the exact
//   opposite of KCTUtilities.SpendFunds, and an up-front affordability check here
//   would refuse rollouts RP-1 itself would happily start and simply run slowly.
//
//   ROLL BACK costs nothing at all: SwitchDirection flips RRType and reschedules
//   maintenance. A Rollback's HasCost is false, so the reverse trip is free.
//
//   SCRAP PAYS THE CAREER. KCTUtilities.ScrapVessel removes the vehicle from
//   whichever list holds it and then AddFunds(GetTotalCost(), VesselPurchase): a
//   full refund, integrating or finished alike. Nothing can be short of funds.
//
//   RUSH spends nothing when it is set. It raises Database.SettingsSC's rate and
//   SALARY multipliers, so the cost arrives later as payroll, and on a pad
//   complex it also stops the complex gaining efficiency. Worth telling an
//   operator, and not an affordability question.
//
// WHAT IS READ, beyond the reads Rp1BuildCommands already vouches for:
//
//   LaunchComplex.LCType             a property over the [Persistent] LCData
//   LaunchComplex.LaunchPads         [Persistent] list of LCLaunchPad
//   LaunchComplex.Recon_Rollout      [Persistent] list of ReconRolloutProject
//   LaunchComplex.ID                 the complex's own Guid, and what
//                                    rp1.complexes[].lcId publishes
//   LCLaunchPad.name/.State          State is a PROPERTY and not a cheap one:
//                                    it walks the complex's Recon_Rollout and
//                                    reads its own destruction ConfigNode. Pure,
//                                    and read once per candidate pad rather than
//                                    per refusal
//   ReconRolloutProject.associatedID/.RRType/.launchPadID
//                                    the three fields that say which vehicle an
//                                    operation is moving and which way
//   VesselProject.shipID             the id an operation's associatedID is
//                                    stamped from, which is NOT the
//                                    KCTPersistentID a command addresses
//   VesselProject.AllPartsValid      a memoising property over AreAllPartsValid
//
// WHAT IS INVOKED, each of them a write RP-1 itself performs on the same click:
//
//   new ReconRolloutProject(vp, Rollout, vp.shipID.ToString(), padName)
//                                    FOUR parameters, the last defaulted. A
//                                    reflected invoke applies no defaults, so
//                                    all four are passed
//   LCLaunchPad.HasVesselWaitingToBeLaunched(out Vessel)
//                                    the only check that catches a pad which
//                                    reads Free and has a craft sitting on it
//                                    in PRELAUNCH
//   VesselProject.MeetsFacilityRequirements(List<string>)
//   ReconRolloutProject.SwitchDirection()
//   LaunchComplex.Recon_Rollout.Add(project)
//   KCTUtilities.ScrapVessel(vp)
//   KCTUtilities.ChangeEngineers(LaunchComplex, 0)
//                                    what RP-1's own rush toggle calls to make
//                                    the change take: it fires
//                                    SCMEvents.OnPersonnelChange, reschedules
//                                    maintenance and recalculates the complex's
//                                    build rates. Resolved by first-parameter
//                                    TYPE, because the LCSpaceCenter overload has
//                                    the same arity and moving a centre's pool
//                                    instead would be silent
//
// TWO FIELDS ARE WRITTEN DIRECTLY, because no RP-1 method sets them:
//   VesselProject.launchSiteIndex    the pad the vehicle is bound for, by index
//                                    into the complex's LaunchPads. RP-1's own
//                                    rollout sets this and the pad name together,
//                                    and a rollout with only the name set leaves
//                                    the warehouse row resolving the WRONG pad
//   LaunchComplex.IsRushing          a plain [Persistent] bool, exactly what
//                                    RP-1's own toggle assigns
//
// WHAT IS NOT HERE. Recovery, air-launch mount and unmount, and reconditioning.
// The first is a flight-scene action (see Rp1BuildCommands' header), and the
// other two belong to a hangar rather than a pad complex, which is a separate
// operation with its own preconditions rather than a flag on this one.
//
// PROVENANCE. Every member named above was read out of an ilspycmd disassembly
// of the INSTALLED RP-1 v4.6.0.0 RP0.dll. The disassembly verifies SHAPE and
// never VALUE: nothing here has been exercised against a running game, so every
// hop is null-safe and every failure to read refuses the command rather than
// guessing at it.
using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The handlers for <c>rp1.vehicle.rollout</c>, <c>rp1.vehicle.rollback</c>,
    /// <c>rp1.vehicle.scrap</c> and <c>rp1.complex.rush</c>.
    ///
    /// <para>Together in one class because all four resolve the same RP-1 object
    /// graph and three of them turn on the same question: which operation, if
    /// any, is already moving this vehicle. Splitting them would put that walk in
    /// three places and let the three answers drift.</para>
    ///
    /// <para>No gate evaluator of its own. All four declare the single static
    /// requirement <see cref="Rp1BuildCommands.Requirements"/> already answers,
    /// because it is the same quantity for all of them (RP-1 is managing this
    /// save) and none of the per-vehicle conditions can be evaluated before the
    /// press.</para>
    /// </summary>
    public sealed class Rp1VehicleCommands
    {
        /// <summary>Move a finished vehicle out of the warehouse and onto a pad.</summary>
        public const string RolloutCommand = "rp1.vehicle.rollout";

        /// <summary>Reverse a rollout: bring the vehicle back off the pad.</summary>
        public const string RollbackCommand = "rp1.vehicle.rollback";

        /// <summary>Take a vehicle off the queue or out of the warehouse, for a full refund.</summary>
        public const string ScrapCommand = "rp1.vehicle.scrap";

        /// <summary>Put a launch complex into rush mode, or take it out.</summary>
        public const string RushCommand = "rp1.complex.rush";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string UtilitiesTypeName = "RP0.KCTUtilities";
        private const string ReconRolloutTypeName = "RP0.ReconRolloutProject";
        private const string LaunchComplexTypeName = "RP0.LaunchComplex";

        /// <summary>The nested enum naming what an operation is doing to a vehicle.</summary>
        private const string RolloutReconTypeName = "RolloutReconType";

        private const string RolloutState = "Rollout";
        private const string RollbackState = "Rollback";
        private const string RecoveryState = "Recovery";

        /// <summary>The one <c>LaunchPadState</c> a rollout may target.</summary>
        private const string PadFree = "Free";

        /// <summary>RP-1's name for a complex that integrates rockets rather than aircraft.</summary>
        private const string PadComplex = "Pad";

        private readonly Type? _scm;
        private readonly Type? _utilities;
        private readonly Type? _reconRollout;
        private readonly Type? _rolloutReconType;

        public Rp1VehicleCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _utilities = Rp1Types.Find(UtilitiesTypeName);
            _reconRollout = Rp1Types.Find(ReconRolloutTypeName);
            _rolloutReconType = NestedRolloutType(_reconRollout);
        }

        /// <summary>
        /// Scrap and rush can run: RP-1's space centre and its static helpers
        /// resolved.
        ///
        /// <para><b>TYPES ONLY, and that is a correction rather than a
        /// simplification.</b> An earlier version also required that
        /// <c>ScrapVessel</c> and <c>ChangeEngineers</c> resolve as METHODS, and
        /// on the first rig run with RP-1 installed all four commands were absent
        /// from the manifest with <c>health: 0</c> and no reason anywhere. A
        /// method-level gate on the MANIFEST cannot say why it fired, because a
        /// command that was never declared is indistinguishable from one that was
        /// never written.</para>
        ///
        /// <para>The gate belongs where <see cref="Rp1BuildCommands.IsAvailable"/>
        /// puts it: on the types, with the method lookups done at the press and
        /// refused with a typed <see cref="CommandErrorCode.ModeUnavailable"/> and
        /// a sentence naming what was not recognised. Every handler here already
        /// did that, so nothing was gained by refusing to declare the command as
        /// well, and an operator lost the reason. A control that says "this RP-1
        /// build has no scrap this Uplink recognises" beats a control that is not
        /// there.</para>
        ///
        /// <para><see cref="MethodDiagnosis"/> keeps the method-level answer and
        /// puts it on Health, so the fact the old gate was trying to express is
        /// still reported, just not by silently shortening a manifest.</para>
        /// </summary>
        public bool IsAvailable => _scm != null && _utilities != null;

        /// <summary>
        /// Roll out and roll back can run: the above, plus the operation type
        /// itself and the enum that says which direction it runs in.
        ///
        /// <para>Separate from <see cref="IsAvailable"/> because the dependency
        /// genuinely is: correcting a queue needs nothing of
        /// <c>ReconRolloutProject</c>, so a release that moved that type should
        /// cost the two commands that need it and not the two that do not. Types
        /// only, for the reason above.</para>
        /// </summary>
        public bool IsMoveAvailable =>
            IsAvailable && _reconRollout != null && _rolloutReconType != null;

        /// <summary>
        /// Which of the RP-1 members these commands invoke actually resolved, as
        /// one sentence for a health fact.
        ///
        /// <para>This is the fact the manifest gate used to express by omission.
        /// A withheld command and an absent one look identical from outside; a
        /// health fact that names the member is the difference between "nobody
        /// wrote this" and "RP-1 v4.7 renamed ScrapVessel".</para>
        ///
        /// <para>Reports a THROW separately from a miss, because they have
        /// different causes: a miss is a rename, a throw is a signature this
        /// runtime could not resolve, and the second is invisible to a metadata
        /// check run on a developer's machine.</para>
        /// </summary>
        public string MethodDiagnosis()
        {
            if (_scm == null || _utilities == null)
            {
                return "RP-1 space-centre types not found";
            }

            var missing = new List<string>();
            Probe(missing, "KCTUtilities.ScrapVessel", () => Rp1Types.StaticMethod(_utilities, "ScrapVessel", 1));
            Probe(missing, "KCTUtilities.ChangeEngineers(LaunchComplex, int)", RushChangeEngineers);
            if (_reconRollout == null)
            {
                missing.Add("ReconRolloutProject type not found");
            }
            else
            {
                Probe(missing, "ReconRolloutProject..ctor(4)", () => Rp1Types.Constructor(_reconRollout, 4));
                if (_rolloutReconType == null)
                {
                    missing.Add("ReconRolloutProject.RolloutReconType not found");
                }
            }

            return missing.Count == 0
                ? "every invoked member resolved"
                : "commands will refuse at the press: " + string.Join("; ", missing.ToArray());
        }

        /// <summary>
        /// Records a lookup that came back empty, and one that THREW, as
        /// different things. A throw here must never escape: this runs from
        /// Health, on the Courier thread, and a diagnostic that takes the health
        /// surface down with it is worse than no diagnostic.
        /// </summary>
        private static void Probe(List<string> missing, string what, Func<object?> lookup)
        {
            try
            {
                if (lookup() == null)
                {
                    missing.Add(what + " not found");
                }
            }
            catch (Exception ex)
            {
                missing.Add(what + " could not be resolved: " + Rp1Types.ExceptionReason(ex));
            }
        }

        /// <summary>
        /// Rolls a finished vehicle out to a launch pad.
        ///
        /// <para>Runs on the game's main thread, like every handler in this
        /// Uplink: the host is constructed with
        /// <c>executeCommandsOnMainThread</c> and the writes below are live RP-1
        /// state.</para>
        ///
        /// <para>Ordered so the operation object is CONSTRUCTED last. It is the
        /// only step with a side effect the game would keep if a later one
        /// failed, and RP-1's own row constructs one per frame purely to show a
        /// price, so building it early is safe but pointless.</para>
        ///
        /// <para>A vehicle already ROLLING BACK is rolled out again by reversing
        /// that operation rather than by starting a second one, which is what
        /// RP-1's own row does. That is what keeps this command a direction and
        /// not a toggle: it always ends with the vehicle heading for the pad,
        /// whatever it was doing when the command arrived.</para>
        /// </summary>
        public CommandResult Rollout(Rp1RolloutArgs? args)
        {
            if (!TryVehicle(args?.Id, moving: true, out var vessel, out var complex, out var finished, out var refusal))
            {
                return refusal!;
            }

            var complexName = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";
            if (!finished)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "this vehicle is still being integrated, so there is nothing to roll out yet");
            }

            if (Rp1Types.ReadBool(complex, "IsOperational") != true)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotReady,
                    complexName + " is being built or renovated, so nothing can leave it yet");
            }

            if (Rp1Types.ReadEnumName(complex, "LCType") != PadComplex)
            {
                // A hangar's vehicles are mounted for air launch rather than
                // rolled out, which is a different operation with different
                // preconditions. Said rather than attempted: RP-1 draws no
                // rollout control for a hangar at all.
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    complexName + " is a hangar, and a hangar's vehicles are air-launched rather than rolled out to a pad");
            }

            if (Rp1Types.ReadBool(vessel, "AllPartsValid") == false)
            {
                // RP-1 omits the whole row for such a vehicle, so this is not a
                // refusal an operator could have predicted from the game's own
                // window; it is worth stating plainly.
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "some of this vehicle's parts are not present in this install, so RP-1 will not move it");
            }

            var shipId = Rp1Types.ReadGuidString(vessel, "shipID");
            if (string.IsNullOrEmpty(shipId))
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 has no ship id for this vehicle, so a rollout could not be attached to it");
            }

            var existing = FindOperation(complex, shipId!, out var existingType);
            if (existing != null)
            {
                return Resume(complex, existing, existingType);
            }

            // REQUIRED, and an empty string counts as absent: a client rendering
            // a text field sends one the first time an operator clears it, and
            // "no pad called """ is not an answer. Refused rather than defaulted
            // even when the complex has exactly one pad, per the operator's
            // ruling recorded on Rp1RolloutArgs.Pad: a mod that picks when the
            // choice looks obvious has still taken the decision.
            if (string.IsNullOrWhiteSpace(args?.Pad))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no pad, and a rollout has to say which pad it is rolling out to");
            }

            if (!TryPad(complex, complexName, args!.Pad!.Trim(), out var pad, out var padName, out var padRefusal))
            {
                return padRefusal!;
            }

            var occupied = PadOccupied(pad!);
            if (occupied != null)
            {
                return CommandResult.Fail(CommandErrorCode.SiteOccupied, occupied);
            }

            var failedChecks = FacilityRefusals(vessel);
            if (failedChecks != null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotReady,
                    "RP-1 will not put this vehicle on " + padName + ": " + failedChecks);
            }

            // THERE IS NO AFFORDABILITY CHECK HERE AND ADDING ONE WOULD BE A BUG.
            //
            // This is the line somebody comparing against Rp1BuildCommands.Repeat
            // will reach for, because that handler runs
            // CurrencyModifierQueryRP0 at exactly this point and refuses on an
            // unreadable price. The two are not the same kind of act.
            //
            // A repeat build is a PURCHASE: KCTUtilities.SpendFunds has no
            // affordability test of its own (its body is an AddFunds of the
            // negative amount), so nothing but that query stands between a press
            // and a career in negative funds.
            //
            // A rollout is a SUBSCRIPTION. ReconRolloutProject's constructor
            // computes cost and touches Funding not at all; the charge is taken
            // per tick in LCOpsProject.IncrementProgress, which runs its OWN
            // CurrencyModifierQueryRP0 for that tick's slice and, when the career
            // cannot cover it, throttles progress to
            // CurrencyUtils.GetAffordableFundsFraction and spends only that.
            //
            // So RP-1 already cannot overdraw a career on a rollout, and a check
            // here would refuse rollouts RP-1 itself starts and runs slowly. The
            // operator confirmed this reading on 2026-08-27. Verified against the
            // INSTALLED v4.6.0.0 RP0.dll, not upstream source.
            object project;
            try
            {
                var constructor = Rp1Types.Constructor(_reconRollout!, 4);
                var rollout = Enum.Parse(_rolloutReconType!, RolloutState);
                if (constructor == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no rollout this Uplink recognises");
                }
                project = constructor.Invoke(new object[] { vessel, rollout, shipId!, padName })!;
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 could not cost a rollout for this vehicle: " + Rp1Types.ExceptionReason(ex));
            }

            // The index BEFORE the append, because the append is what makes the
            // rollout real: a vehicle bound for a pad it does not name is worse
            // than one that never left, and the warehouse row resolves the pad
            // through this index rather than through the operation.
            if (!Rp1Types.WriteMember(vessel, "launchSiteIndex", PadIndex(complex, pad!)))
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept a pad assignment for this vehicle, so the rollout was not started");
            }

            try
            {
                var list = Rp1Types.Member(complex, "Recon_Rollout");
                var add = list == null ? null : Rp1Types.InstanceMethod(list, "Add", 1);
                if (add == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no operations list this Uplink recognises");
                }
                add.Invoke(list, new[] { project });
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 refused the rollout: " + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// Brings a vehicle back off the pad, by reversing the rollout that put
        /// it there.
        ///
        /// <para>Refuses a vehicle that is already rolling back rather than
        /// flipping it forward again. <c>SwitchDirection</c> is symmetric and a
        /// command built straight onto it would do the opposite of its own name
        /// half the time, which is exactly the wrong property for a control an
        /// operator presses from a remote vantage on a state they read some time
        /// ago.</para>
        /// </summary>
        public CommandResult Rollback(Rp1VehicleArgs? args)
        {
            if (!TryVehicle(args?.Id, moving: true, out var vessel, out var complex, out _, out var refusal))
            {
                return refusal!;
            }

            var shipId = Rp1Types.ReadGuidString(vessel, "shipID");
            if (string.IsNullOrEmpty(shipId))
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 has no ship id for this vehicle, so its rollout could not be found");
            }

            var operation = FindOperation(complex, shipId!, out var operationType);
            if (operation == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "this vehicle is not on a pad and not heading for one, so there is nothing to roll back");
            }

            switch (operationType)
            {
                case RolloutState:
                    return Reverse(operation, "roll this vehicle back");
                case RollbackState:
                    return CommandResult.Fail(
                        CommandErrorCode.WrongState,
                        "this vehicle is already rolling back");
                default:
                    return CommandResult.Fail(
                        CommandErrorCode.WrongState,
                        "RP-1 is already running a " + Words(operationType) + " on this vehicle");
            }
        }

        /// <summary>
        /// Takes a vehicle off the queue or out of the warehouse and refunds it.
        ///
        /// <para>The refund is RP-1's, in full, and is the reason this needs no
        /// affordability check and every reason it needs the arm-then-confirm the
        /// client gives it: the vehicle is gone and getting it back means paying
        /// for the integration time again.</para>
        ///
        /// <para>Refused mid-move, which is RP-1's own rule rather than a
        /// caution added here: its Scrap button is drawn only when no rollout and
        /// no rollback is running on the vehicle. Scrapping one that is on its way
        /// to a pad would leave the operation attached to nothing.</para>
        /// </summary>
        public CommandResult Scrap(Rp1VehicleArgs? args)
        {
            if (!TryVehicle(args?.Id, moving: false, out var vessel, out var complex, out _, out var refusal))
            {
                return refusal!;
            }

            var shipId = Rp1Types.ReadGuidString(vessel, "shipID");
            if (!string.IsNullOrEmpty(shipId))
            {
                var operation = FindOperation(complex, shipId!, out var operationType);
                if (operation != null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.WrongState,
                        "RP-1 is running a " + Words(operationType)
                        + " on this vehicle, so it cannot be scrapped until that is reversed or finished");
                }
            }

            // No affordability check here either, and for the opposite reason to
            // the rollout's: a scrap PAYS the career. KCTUtilities.ScrapVessel
            // ends in AddFunds(GetTotalCost(), VesselPurchase), a full refund
            // whether the vehicle was finished or still integrating, so there is
            // no amount an operator can be short of. What it needs instead is the
            // arm-then-confirm the client gives it, because the vehicle is gone
            // and getting it back means paying for the integration time again.
            try
            {
                var scrap = Rp1Types.StaticMethod(_utilities!, "ScrapVessel", 1);
                if (scrap == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no scrap this Uplink recognises");
                }
                scrap.Invoke(null, new[] { vessel });
            }
            catch (Exception ex)
            {
                // The refund is the LAST thing ScrapVessel does, after the
                // removal, so a throw part-way can leave the vehicle gone and
                // the career unpaid. Said rather than reported as a plain
                // refusal, because an operator who reads "refused" would look
                // for a vehicle that is not there any more.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through scrapping this vehicle, so check the queue and the balance: "
                    + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// Puts a launch complex into rush mode, or takes it out.
        ///
        /// <para>A SET and not a toggle, for the reason
        /// <see cref="Rp1ComplexRushArgs"/> gives, so re-sending it is harmless
        /// and it lands on the asked-for state however stale the operator's view
        /// was.</para>
        ///
        /// <para>The flag alone is not the whole write. RP-1's own toggle follows
        /// it with <c>ChangeEngineers(lc, 0)</c>, whose zero delta exists purely
        /// to fire the recalculation: the complex caches its build rates, and
        /// without that call the new multiplier would not reach them until
        /// something else happened to invalidate the cache.</para>
        /// </summary>
        public CommandResult Rush(Rp1ComplexRushArgs? args)
        {
            var lcId = args?.LcId;
            if (string.IsNullOrWhiteSpace(lcId))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no launch complex");
            }

            var rushing = args?.Rushing;
            if (rushing == null)
            {
                // Refused rather than defaulted. Either default would be a
                // guess at which way the operator meant to move a mode that
                // costs payroll.
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the command did not say whether to start rushing or stop");
            }

            if (!TryScm(out var scm, out var refusal))
            {
                return refusal!;
            }

            if (!TryFindComplex(scm!, lcId!, out var complex))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no launch complex with that id exists at any space centre");
            }

            var complexName = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";
            if (!Rp1Types.WriteMember(complex, "IsRushing", rushing.Value))
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not accept a rush setting for " + complexName);
            }

            try
            {
                var changeEngineers = RushChangeEngineers();
                if (changeEngineers == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no rate recalculation this Uplink recognises, so "
                        + complexName + " has been set and may not act on it until RP-1 next recalculates");
                }
                changeEngineers.Invoke(null, new object[] { complex, 0 });
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 accepted the rush setting for " + complexName
                    + " and then failed to recalculate its rates: " + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// The five refusals every vehicle command shares, in the order they
        /// stop being about the command and start being about the world: an
        /// argument, this Uplink's own resolution, RP-1's scenario module, the
        /// save, and finally the vehicle.
        ///
        /// <para><paramref name="moving"/> selects which availability applies,
        /// because rolling a vehicle needs types that correcting a queue does
        /// not; see <see cref="IsMoveAvailable"/>.</para>
        /// </summary>
        private bool TryVehicle(
            string? id,
            bool moving,
            out object vessel,
            out object complex,
            out bool finished,
            out CommandResult? refusal)
        {
            vessel = null!;
            complex = null!;
            finished = false;

            if (string.IsNullOrWhiteSpace(id))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no vehicle, and RP-1 keeps several of the same name");
                return false;
            }

            if (moving ? !IsMoveAvailable : !IsAvailable)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's build model could not be resolved, so nothing was changed");
                return false;
            }

            if (!TryScm(out var scm, out refusal))
            {
                return false;
            }

            if (!TryFindVehicle(scm!, id!, out vessel, out complex, out finished))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no vehicle with that id is being integrated or held at any launch complex");
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// RP-1's space centre, or the refusal for its absence. A null Instance
        /// and a save RP-1 is not managing are different answers and get
        /// different codes: the first is a scene still coming in, the second is
        /// a fact about the save.
        /// </summary>
        private bool TryScm(out object? scm, out CommandResult? refusal)
        {
            scm = _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
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
        /// The vehicle, the complex holding it, and which of the two lists it was
        /// in. The list matters: a rollout moves a FINISHED vehicle and a vehicle
        /// still integrating cannot be moved at all, so the caller needs to be
        /// able to say which of those it found rather than just failing to find.
        /// </summary>
        private static bool TryFindVehicle(object scm, string id, out object vessel, out object complex, out bool finished)
        {
            foreach (var centre in Rp1Types.Enumerate(Rp1Types.Member(scm, "KSCs")))
            {
                foreach (var lc in Rp1Types.Enumerate(Rp1Types.Member(centre, "LaunchComplexes")))
                {
                    if (TryFindIn(lc, "Warehouse", id, out vessel))
                    {
                        complex = lc;
                        finished = true;
                        return true;
                    }
                    if (TryFindIn(lc, "BuildList", id, out vessel))
                    {
                        complex = lc;
                        finished = false;
                        return true;
                    }
                }
            }
            vessel = null!;
            complex = null!;
            finished = false;
            return false;
        }

        private static bool TryFindIn(object lc, string listName, string id, out object vessel)
        {
            foreach (var vp in Rp1Types.Enumerate(Rp1Types.Member(lc, listName)))
            {
                if (string.Equals(Rp1Types.ReadString(vp, "KCTPersistentID"), id, StringComparison.Ordinal))
                {
                    vessel = vp;
                    return true;
                }
            }
            vessel = null!;
            return false;
        }

        /// <summary>The complex with this id, searched across every centre.</summary>
        private static bool TryFindComplex(object scm, string lcId, out object complex)
        {
            foreach (var centre in Rp1Types.Enumerate(Rp1Types.Member(scm, "KSCs")))
            {
                foreach (var lc in Rp1Types.Enumerate(Rp1Types.Member(centre, "LaunchComplexes")))
                {
                    if (string.Equals(Rp1Types.ReadGuidString(lc, "ID"), lcId, StringComparison.OrdinalIgnoreCase))
                    {
                        complex = lc;
                        return true;
                    }
                }
            }
            complex = null!;
            return false;
        }

        /// <summary>
        /// The operation already moving this vehicle, and what it is, or null.
        ///
        /// <para>Matched on <c>associatedID</c>, which RP-1 stamps from
        /// <c>shipID</c> and NOT from the <c>KCTPersistentID</c> a command
        /// addresses. Two different ids on the same vehicle, and using the wrong
        /// one here would find nothing and report every vehicle as free to
        /// move.</para>
        ///
        /// <para>Reconditioning is skipped: it has no vehicle, occupies a pad
        /// rather than a vehicle, and matching it would attribute a pad's
        /// maintenance to whichever vehicle came out of the same complex.</para>
        /// </summary>
        private static object? FindOperation(object complex, string shipId, out string? type)
        {
            foreach (var op in Rp1Types.Enumerate(Rp1Types.Member(complex, "Recon_Rollout")))
            {
                if (!string.Equals(Rp1Types.ReadString(op, "associatedID"), shipId, StringComparison.Ordinal))
                {
                    continue;
                }
                var name = Rp1Types.ReadEnumName(op, "RRType");
                if (name == RolloutState || name == RollbackState || name == RecoveryState)
                {
                    type = name;
                    return op;
                }
            }
            type = null;
            return null;
        }

        /// <summary>
        /// What a rollout command does when the vehicle is already under an
        /// operation: reverse a rollback, and refuse the other two.
        /// </summary>
        private static CommandResult Resume(object complex, object operation, string? operationType)
        {
            switch (operationType)
            {
                case RolloutState:
                    return CommandResult.Fail(
                        CommandErrorCode.WrongState,
                        "this vehicle is already on its way to a pad");
                case RollbackState:
                {
                    // RP-1's own row reverses a rollback only when no OTHER
                    // vehicle has claimed the pad in the meantime, which is the
                    // whole reason a rollback frees one.
                    var padId = Rp1Types.ReadString(operation, "launchPadID");
                    var claimant = padId == null ? null : RolloutClaiming(complex, operation, padId);
                    if (claimant != null)
                    {
                        return CommandResult.Fail(
                            CommandErrorCode.SiteOccupied,
                            claimant + " is already rolling out to " + padId);
                    }
                    return Reverse(operation, "send this vehicle back to the pad");
                }
                default:
                    return CommandResult.Fail(
                        CommandErrorCode.WrongState,
                        "RP-1 is running a " + Words(operationType) + " on this vehicle");
            }
        }

        /// <summary>
        /// The name of another vehicle already rolling out to the same pad, or
        /// null when none is.
        ///
        /// <para>Named rather than counted, and the name costs a second walk: an
        /// operation carries only the ship id, so the complex's warehouse has to
        /// be searched for the vehicle wearing it. Worth it, because "LC-1's pad
        /// is taken" leaves an operator with nothing to do and "Atlas is already
        /// rolling out to it" tells them what to roll back.</para>
        /// </summary>
        private static string? RolloutClaiming(object complex, object exclude, string padId)
        {
            foreach (var op in Rp1Types.Enumerate(Rp1Types.Member(complex, "Recon_Rollout")))
            {
                if (ReferenceEquals(op, exclude)
                    || Rp1Types.ReadEnumName(op, "RRType") != RolloutState
                    || Rp1Types.ReadString(op, "launchPadID") != padId)
                {
                    continue;
                }
                var claimantId = Rp1Types.ReadString(op, "associatedID");
                return VehicleNamed(complex, claimantId) ?? "another vehicle";
            }
            return null;
        }

        /// <summary>The ship name of the vehicle wearing this ship id at this complex, or null.</summary>
        private static string? VehicleNamed(object complex, string? shipId)
        {
            if (string.IsNullOrEmpty(shipId))
            {
                return null;
            }
            foreach (var listName in new[] { "Warehouse", "BuildList" })
            {
                foreach (var vp in Rp1Types.Enumerate(Rp1Types.Member(complex, listName)))
                {
                    if (string.Equals(Rp1Types.ReadGuidString(vp, "shipID"), shipId, StringComparison.Ordinal))
                    {
                        var name = Rp1Types.ReadString(vp, "shipName");
                        return string.IsNullOrEmpty(name) ? null : name;
                    }
                }
            }
            return null;
        }

        /// <summary>
        /// Flips an operation's direction. Two lines of RP-1's own state plus a
        /// maintenance reschedule, and nothing spent either way.
        /// </summary>
        private static CommandResult Reverse(object operation, string what)
        {
            try
            {
                var switchDirection = Rp1Types.InstanceMethod(operation, "SwitchDirection", 0);
                if (switchDirection == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no way to reverse an operation that this Uplink recognises");
                }
                switchDirection.Invoke(operation, null);
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not " + what + ": " + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// The pad the command named, resolved against the complex's own list.
        ///
        /// <para>By name and ONLY by name. There is no fall back to "the only
        /// free one": see <see cref="Rp1RolloutArgs.Pad"/> for the operator
        /// ruling, and note what the alternative costs even when it looks safe.
        /// A complex can gain a pad between the frame the operator read and the
        /// press, so "the only free one" is not a stable referent, and a rollout
        /// that resolved it at dispatch time could send a vehicle to a pad that
        /// was not on screen when the decision was made.</para>
        ///
        /// <para>A pad that exists and is not free refuses with the reason,
        /// through <see cref="PadUnusable"/>, rather than with a bare "not
        /// available": the four states behind it want four different next moves
        /// from an operator.</para>
        /// </summary>
        private static bool TryPad(
            object complex,
            string complexName,
            string wanted,
            out object? pad,
            out string padName,
            out CommandResult? refusal)
        {
            pad = null;
            padName = "";

            foreach (var candidate in Rp1Types.Enumerate(Rp1Types.Member(complex, "LaunchPads")))
            {
                var name = Rp1Types.ReadString(candidate, "name") ?? "";
                if (!string.Equals(name, wanted, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                // Read once, after the name has matched: State walks the
                // complex's operations and the pad's own destruction node, so
                // reading it for every candidate would pay that walk per pad to
                // answer a question about one.
                var state = Rp1Types.ReadEnumName(candidate, "State") ?? "";
                if (state != PadFree)
                {
                    refusal = PadUnusable(name, state);
                    return false;
                }
                pad = candidate;
                padName = name;
                refusal = null;
                return true;
            }

            refusal = CommandResult.Fail(
                CommandErrorCode.NotFound,
                complexName + " has no pad called \"" + wanted + "\"");
            return false;
        }

        /// <summary>
        /// Why a pad cannot take a vehicle, in the terms an operator acts on.
        /// Four different next moves hide behind RP-1's one enum: repair it,
        /// build it, wait for maintenance, or wait for the vehicle already
        /// there.
        /// </summary>
        private static CommandResult PadUnusable(string what, string? state)
        {
            switch (state)
            {
                case "Destroyed":
                    return CommandResult.Fail(
                        CommandErrorCode.FacilityDamaged,
                        what + " is destroyed and has to be repaired before anything can roll out to it");
                case "Nonoperational":
                    return CommandResult.Fail(
                        CommandErrorCode.NotReady,
                        what + " has not been built yet");
                case "Reconditioning":
                    return CommandResult.Fail(
                        CommandErrorCode.NotReady,
                        what + " is being reconditioned after a launch");
                case RolloutState:
                case RollbackState:
                    return CommandResult.Fail(
                        CommandErrorCode.SiteOccupied,
                        what + " is in use by another vehicle");
                default:
                    return CommandResult.Fail(
                        CommandErrorCode.NotReady,
                        what + " cannot take a vehicle right now");
            }
        }

        /// <summary>
        /// Whether a pad that reads as free has a craft sitting on it, and the
        /// sentence for it, or null.
        ///
        /// <para>The one condition <c>State</c> cannot see. It reports Free for a
        /// pad with no OPERATION on it, and a vehicle that has already been sent
        /// to the launch site sits there in <c>PRELAUNCH</c> with no operation at
        /// all; RP-1 asks this question separately for the same reason.</para>
        ///
        /// <para>An unanswerable question PROCEEDS. The check is RP-1's own last
        /// guard and it runs again on the launch, so the worst case of a
        /// misresolved member here is a refusal the operator gets one step later,
        /// against the certainty of losing the whole command.</para>
        /// </summary>
        private static string? PadOccupied(object pad)
        {
            try
            {
                var check = Rp1Types.InstanceMethod(pad, "HasVesselWaitingToBeLaunched", 1);
                if (check == null)
                {
                    return null;
                }
                var arguments = new object?[1];
                if (!(check.Invoke(pad, arguments) is bool occupied) || !occupied)
                {
                    return null;
                }
                var name = Rp1Types.ReadString(arguments[0], "vesselName");
                return (string.IsNullOrEmpty(name) ? "a vessel" : name)
                    + " is already on that pad waiting to be launched";
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// RP-1's own reasons for refusing to put this vehicle on a pad, joined
        /// into a sentence, or null when it has none. Invoked, and unanswerable
        /// means PROCEED, for the reasons
        /// <see cref="Rp1BuildCommands"/>'s own facility check sets out at
        /// length.
        /// </summary>
        private static string? FacilityRefusals(object vessel)
        {
            try
            {
                var meets = Rp1Types.InstanceMethod(vessel, "MeetsFacilityRequirements", 1);
                if (meets == null)
                {
                    return null;
                }
                var reasons = new List<string>();
                if (meets.Invoke(vessel, new object[] { reasons }) is bool ok && ok)
                {
                    return null;
                }
                return reasons.Count == 0
                    ? "it is outside the complex's limits"
                    : string.Join("; ", reasons.ToArray());
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Where a pad sits in its complex's list, which is what RP-1 stores on
        /// the vehicle. Walked rather than asked of the list, because the list is
        /// one of RP-1's own persistent collections from another assembly and a
        /// reference walk needs nothing of its type.
        /// </summary>
        private static int PadIndex(object complex, object pad)
        {
            var index = 0;
            foreach (var candidate in Rp1Types.Enumerate(Rp1Types.Member(complex, "LaunchPads")))
            {
                if (ReferenceEquals(candidate, pad))
                {
                    return index;
                }
                index++;
            }
            return -1;
        }

        /// <summary>
        /// The rush recalculation, resolved by first-parameter TYPE. RP-1 has a
        /// same-arity <c>ChangeEngineers(LCSpaceCenter, int)</c>, and picking it
        /// by accident would move a whole centre's engineer pool.
        /// </summary>
        private MethodInfo? RushChangeEngineers() =>
            _utilities == null
                ? null
                : Rp1Types.StaticMethodOn(_utilities, "ChangeEngineers", LaunchComplexTypeName, 2);

        /// <summary>The nested enum on <c>ReconRolloutProject</c>, or null.</summary>
        private static Type? NestedRolloutType(Type? reconRollout)
        {
            if (reconRollout == null)
            {
                return null;
            }
            try
            {
                var nested = reconRollout.GetNestedType(RolloutReconTypeName);
                return nested != null && nested.IsEnum ? nested : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// An RP-1 operation name in an operator's words. Its enum names are
        /// legible enough to quote and not quite English enough to put in a
        /// sentence.
        /// </summary>
        private static string Words(string? operationType)
        {
            switch (operationType)
            {
                case RolloutState: return "rollout";
                case RollbackState: return "rollback";
                case RecoveryState: return "recovery";
                default: return "operation";
            }
        }

    }
}
