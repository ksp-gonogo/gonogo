// The launch-complex acts that are IMMEDIATE and cost nothing: rename a complex,
// demolish one, and rename or demolish one of its pads.
//
// WHY THESE FOUR ARE TOGETHER AND THE OTHER THREE ARE NOT. Building a complex,
// renovating one and adding a pad all go on RP-1's construction queue and all
// three need a PRICE, which RP-1 computes nowhere reusable (see
// Rp1LcCostModel's header for what that costs us). These four write RP-1's own
// state directly, take effect the moment they land, and there is no figure to get
// wrong. Keeping them apart means the half of the surface with no arithmetic in it
// can be trusted on its own terms.
//
// WHAT WAS STILL WRONG. An operator could read a complex's whole state, rush it
// and staff it, and could not correct its name, could not remove a pad they had
// added by mistake, and could not close a complex they had outgrown. Every one of
// those is a press in RP-1's own window.
//
// TWO OF RP-1's OWN CONTROLS DO NOTHING AND SAY NOTHING, and converting both is
// most of why this file is worth having:
//
//   A PAD DISMANTLE WITH ONE PAD LEFT. RP-1's check is
//   `LaunchPadCount >= 2 && !ActiveLPInstance.Delete(out reason)`, so with one
//   operational pad the && short-circuits: the confirmation dialog has already
//   asked "This cannot be undone!", the operator presses Yes, the window closes,
//   and the pad is still there. Nothing is posted anywhere.
//
//   A PAD RENAME TO A NAME ALREADY IN USE. LCLaunchPad.Rename returns without
//   doing anything when another pad at the complex has that name, and the rename
//   window that called it reports nothing. Same shape: Save closes the window and
//   the old name is still there.
//
// A confirmation that does nothing is worse than a refusal, because the operator
// believes it worked. Both are refusals here.
//
// WHAT DISMANTLING AN LC ACTUALLY DESTROYS, which is not what the game's dialog
// implies and not what our own spec said either:
//
//   NOT A VESSEL. RP-1 refuses the dismantle while the complex holds anything:
//   CanDismantle requires an empty build list AND an empty warehouse. Verified in
//   IL rather than only in a decompiler, because it inverts a finding we were
//   working from: LaunchComplex::get_CanModifyButton IL_000e-IL_0018 loads
//   Warehouse, takes its Count and `brtrue.s` to `ldc.i4.0`, and
//   KCT_GUI::TryDismantlePadOrLC gates on it at IL_0031 while its
//   KCTUtilities::ScrapVessel call sits at IL_0176. That loop over the warehouse
//   is DEAD CODE, and ScrapVessel refunds in full anyway.
//
//   THE COMPLEX'S EARNED BUILD EFFICIENCY. This is the real loss and the game
//   names it nowhere. LaunchComplex.Delete calls LCEfficiency.RemoveLC, which
//   calls ClearEmpty() when the complex was the last member of its efficiency
//   group. A complex rebuilt to the same specification starts again from RP-1's
//   floor. Whether it is lost or survives depends entirely on whether another
//   complex shares the group, so this command reports WHICH of the two happened
//   and a client can warn with the right one of two quite different sentences
//   before the press: rp1.complexes[].efficiency is the figure at risk and
//   rp1.complexes[].efficiencySharedWith says whether a sibling keeps it.
//
//   ITS PADS, and nothing else. The engineers come back by themselves: a centre's
//   unassigned pool is DERIVED as its headcount minus what its complexes hold, so
//   removing a complex frees its crew without anything writing them anywhere.
//
// WHAT IS INVOKED, each of them the write RP-1 performs on the same click:
//
//   LaunchComplex.Rename(string)      assigns the name on the complex and on its
//                                     persisted stats. Validates NOTHING, which is
//                                     why the duplicate check here is ours
//   LCLaunchPad.Rename(string)        rewrites the name on the pad AND on every
//                                     rollout and pending construction stored
//                                     against it, which is what makes the rename
//                                     RP-1's to perform rather than a field to write
//   LCLaunchPad.Delete(out string)    removes the pad, walks every centre to find
//                                     which complex holds it, and shifts the
//                                     launchSiteIndex of every vessel that pointed
//                                     past it. Its out-reason is carried into the
//                                     refusal verbatim
//   LCSpaceCenter.SwitchToPrevLaunchComplex(bool)
//                                     ARITY ONE, not zero: the parameter is
//                                     optional in C# and reflection applies no
//                                     defaults, so false is passed explicitly
//   LaunchComplex.Delete()            unregisters the complex and its pads, drops
//                                     its efficiency contribution, clears a staff
//                                     target that named it, and removes it from its
//                                     centre
//   SCMEvents.OnLCDismantled / OnPadDismantled
//                                     fired last, and inside their own try, exactly
//                                     as RP-1 does: a subscriber that throws must
//                                     not make a completed dismantle report failure
//
// ONE DELIBERATE DIVERGENCE, and it is safer rather than different: where RP-1
// would scrap a non-empty warehouse this REFUSES. The scrap path is unreachable
// (see above), so the case cannot arise from RP-1's own reasoning; but
// CanDismantle is one bool over four conditions and if it ever read true with
// vessels present, destroying them silently is the one outcome nobody could want.
//
// PROVENANCE. Every member named above was read out of an ilspycmd disassembly of
// the INSTALLED RP-1 v4.6.0.0 RP0.dll, and the dismantle gate additionally out of
// its IL. The disassembly verifies SHAPE and never VALUE: nothing here has been
// exercised against a running game, so every hop is null-safe and every failure to
// read refuses the command rather than guessing at it.
using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The handlers for <c>rp1.complex.rename</c>, <c>rp1.complex.dismantle</c>,
    /// <c>rp1.pad.rename</c> and <c>rp1.pad.dismantle</c>.
    /// </summary>
    /// <remarks>
    /// No gate evaluator of its own. All four declare the single static
    /// requirement <see cref="Rp1BuildCommands.Requirements"/> already answers,
    /// because it is the same quantity for all of them (RP-1 is managing this
    /// save) and none of the per-complex conditions can be evaluated before the
    /// press.
    /// </remarks>
    public sealed class Rp1ComplexLifecycleCommands
    {
        /// <summary>Change what a launch complex is called.</summary>
        public const string RenameComplexCommand = "rp1.complex.rename";

        /// <summary>Demolish a launch complex, its pads with it.</summary>
        public const string DismantleComplexCommand = "rp1.complex.dismantle";

        /// <summary>Change what one of a complex's pads is called.</summary>
        public const string RenamePadCommand = "rp1.pad.rename";

        /// <summary>Demolish one of a complex's pads.</summary>
        public const string DismantlePadCommand = "rp1.pad.dismantle";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string LaunchComplexTypeName = "RP0.LaunchComplex";
        private const string LaunchPadTypeName = "RP0.LCLaunchPad";
        private const string EventsTypeName = "RP0.SCMEvents";

        private readonly Type? _scm;
        private readonly Type? _launchComplex;
        private readonly Type? _launchPad;
        private readonly Type? _events;

        public Rp1ComplexLifecycleCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _launchComplex = Rp1Types.Find(LaunchComplexTypeName);
            _launchPad = Rp1Types.Find(LaunchPadTypeName);
            _events = Rp1Types.Find(EventsTypeName);
        }

        /// <summary>
        /// The commands can run: RP-1's space centre, its complex and its pad
        /// types resolved.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1VehicleCommands.IsAvailable"/> spells out at length: a
        /// method-level gate on the MANIFEST cannot say why it fired, because a
        /// command that was never declared looks exactly like one nobody wrote.
        /// The method lookups happen at the press and refuse with a sentence
        /// naming what was not recognised.</para>
        ///
        /// <para><see cref="_events"/> is deliberately NOT part of this. RP-1's
        /// event bus is how its own UI hears about a dismantle, and firing it is
        /// the last thing either dismantle does; an install whose event class
        /// moved should still be able to demolish a complex, with RP-1's window
        /// catching up when it next redraws.</para>
        /// </summary>
        public bool IsAvailable => _scm != null && _launchComplex != null && _launchPad != null;

        /// <summary>
        /// Whether the members these commands invoke resolved, as a sentence for a
        /// health fact. The same reasoning as
        /// <see cref="Rp1VehicleCommands.MethodDiagnosis"/>: a withheld command and
        /// an absent one are indistinguishable from outside, and naming the member
        /// is the difference between "nobody wrote this" and "RP-1 renamed Delete".
        /// </summary>
        public string MethodDiagnosis()
        {
            if (!IsAvailable)
            {
                return "RP-1 launch-complex types not found";
            }

            var missing = new List<string>();
            try
            {
                // By TYPE and arity, never by instantiating one: RP-1's own
                // constructors register the object with its scenario module, so a
                // health probe that made a LaunchComplex to look at would leave one
                // behind in the save.
                if (Rp1Types.MostDerivedInstanceMethod(_launchComplex, "Rename", 1) == null)
                {
                    missing.Add("LaunchComplex.Rename(string)");
                }
                if (Rp1Types.MostDerivedInstanceMethod(_launchComplex, "Delete", 0) == null)
                {
                    missing.Add("LaunchComplex.Delete()");
                }
                if (Rp1Types.MostDerivedInstanceMethod(_launchPad, "Rename", 1) == null)
                {
                    missing.Add("LCLaunchPad.Rename(string)");
                }
                if (Rp1Types.MostDerivedInstanceMethod(_launchPad, "Delete", 1) == null)
                {
                    missing.Add("LCLaunchPad.Delete(out string)");
                }
            }
            catch (Exception ex)
            {
                // Runs from Health, on the Courier thread. A diagnostic that takes
                // the health surface down with it is worse than no diagnostic.
                return "launch-complex lifecycle will refuse at the press: member lookup threw: "
                    + Rp1Types.ExceptionReason(ex);
            }

            return missing.Count == 0
                ? "every invoked member resolved"
                : "launch-complex lifecycle will refuse at the press: " + string.Join(", ", missing.ToArray())
                  + " not found";
        }

        /// <summary>
        /// Changes a launch complex's name. Immediate, free, and it does not take
        /// the complex out of service.
        ///
        /// <para>Refuses a name another complex at the same centre already has,
        /// which RP-1's own rename does not. See
        /// <see cref="Rp1ComplexRenameArgs.Name"/> for why that divergence is worth
        /// having; the wording is RP-1's own, from the build path that does check.</para>
        /// </summary>
        public CommandResult RenameComplex(Rp1ComplexRenameArgs? args)
        {
            if (!TryComplex(args?.LcId, out var complex, out var refusal))
            {
                return refusal!;
            }

            var name = Trimmed(args?.Name);
            if (name == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the command carried no new name for the launch complex");
            }

            var centre = Rp1Types.Member(complex, "KSC");
            var currentName = Rp1Types.ReadString(complex, "Name");
            if (string.Equals(currentName, name, StringComparison.Ordinal))
            {
                // The asked-for state is the state. Succeeding rather than
                // refusing keeps the command idempotent, which is what lets a
                // client re-send one whose result was lost.
                return CommandResult.Ok();
            }

            if (NameTakenByAnotherComplex(centre, complex, name))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "another launch complex with the same name already exists");
            }

            var rename = Rp1Types.InstanceMethodOn(complex, "Rename", "System.String", 1);
            if (rename == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no launch-complex rename this Uplink recognises, so nothing was changed");
            }

            try
            {
                rename.Invoke(complex, new object[] { name });
            }
            catch (Exception ex)
            {
                // RP-1's Rename writes the name in two places, on the complex and
                // on its persisted stats. A throw between them leaves the two
                // disagreeing, which is why this says to check rather than
                // reporting a plain refusal.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through renaming " + (currentName ?? "the launch complex")
                    + ", so check its name: " + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// Demolishes a launch complex and every pad it has.
        ///
        /// <para>Returns what was destroyed rather than a bare acknowledgement,
        /// because one of the losses is invisible: the complex's earned build
        /// efficiency, which survives only if another complex shares its group.
        /// See this file's header.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> DismantleComplex(Rp1ComplexDismantleArgs? args)
        {
            if (!TryComplex(args?.LcId, out var complex, out var refusal))
            {
                return Refuse(refusal!);
            }

            var name = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";

            if (string.Equals(Rp1Types.ReadEnumName(complex, "LCType"), "Hangar", StringComparison.Ordinal))
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "can't dismantle the Hangar"));
            }

            var canDismantle = Rp1Types.ReadBool(complex, "CanDismantle");
            if (canDismantle == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say whether " + name + " can be dismantled, so nothing was changed"));
            }
            if (canDismantle != true)
            {
                // RP-1 says only "Launch Complex in use" for all four of its
                // conditions. The four inputs are each readable, so this names the
                // one that actually holds: the DECISION is still RP-1's bool, and
                // only the sentence is ours.
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    name + " is in use: " + InUseReason(complex)));
            }

            foreach (var pad in Rp1Types.Enumerate(Rp1Types.Member(complex, "LaunchPads")))
            {
                if (PadHasVesselWaiting(pad, out var waiting))
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "a vessel is currently waiting on the launch pad"
                        + (waiting == null ? string.Empty : " (" + waiting + ")")));
                }
            }

            var centre = Rp1Types.Member(complex, "KSC");
            var lcId = Rp1Types.ReadGuidString(complex, "ID");
            foreach (var project in Rp1Types.Enumerate(Rp1Types.Member(centre, "LCConstructions")))
            {
                if (string.Equals(Rp1Types.ReadGuidString(project, "lcID"), lcId, StringComparison.OrdinalIgnoreCase))
                {
                    return Refuse(CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        name + " is currently under construction. Cancel construction first"));
                }
            }

            var padConstructions = Count(Rp1Types.Member(complex, "PadConstructions"));
            if (padConstructions == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say whether a pad at " + name + " is under construction, so nothing was changed"));
            }
            if (padConstructions.Value > 0)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "a pad at " + name + " is currently under construction. Cancel construction first"));
            }

            // The deliberate divergence, and the reason is in this file's header:
            // RP-1 would scrap these, its own gate makes that unreachable, and
            // destroying vessels on a bool that disagreed with itself is the one
            // outcome nobody could want.
            var held = Count(Rp1Types.Member(complex, "Warehouse"));
            var integrating = Count(Rp1Types.Member(complex, "BuildList"));
            if (held > 0 || integrating > 0)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    name + " still holds " + Plural(held ?? 0, "finished vehicle", "finished vehicles")
                    + " and " + Plural(integrating ?? 0, "vehicle being integrated", "vehicles being integrated")
                    + ". Scrap them first: dismantling would destroy them"));
            }

            // Read BEFORE the delete, which is what destroys them.
            var efficiency = EfficiencyAtRisk(complex, lcId, out var survivesWith);
            var padCount = Count(Rp1Types.Member(complex, "LaunchPads")) ?? 0;
            var engineers = Rp1Types.Member(complex, "Engineers") as int? ?? 0;

            if (!TryDeletePads(complex, name, out var padRefusal))
            {
                return Refuse(padRefusal!);
            }

            var switchAway = centre == null
                ? null
                : Rp1Types.InstanceMethod(centre, "SwitchToPrevLaunchComplex", 1);
            var delete = Rp1Types.InstanceMethod(complex, "Delete", 0);
            if (delete == null)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no launch-complex delete this Uplink recognises, and " + name
                    + "'s pads have already been removed, so check the complex"));
            }

            try
            {
                // RP-1 moves the game's own selection off the complex first, and
                // the order matters: switching after the delete would land on an
                // index the delete has already shifted.
                switchAway?.Invoke(centre, new object[] { false });
                delete.Invoke(complex, Array.Empty<object>());
            }
            catch (Exception ex)
            {
                return Refuse(CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through dismantling " + name
                    + ", whose pads have already been removed, so check the complex: "
                    + Rp1Types.ExceptionReason(ex)));
            }

            Fire("OnLCDismantled", complex);

            return CommandResult<Dictionary<string, object?>>.Ok(new Dictionary<string, object?>
            {
                ["name"] = name,
                ["padsRemoved"] = padCount,
                ["engineersFreed"] = engineers,
                // The two halves of the efficiency answer, and they are two fields
                // rather than one because they are two different warnings: a figure
                // with no survivor is a permanent loss, and a figure with one is
                // not a loss at all.
                ["efficiencyLost"] = survivesWith != null && survivesWith.Count > 0 ? null : efficiency,
                ["efficiencySurvivesWith"] = survivesWith,
            });
        }

        /// <summary>
        /// Changes one of a complex's pads' names.
        ///
        /// <para>Refuses a duplicate rather than doing nothing, which is what RP-1
        /// does. See <see cref="Rp1PadRenameArgs"/>.</para>
        /// </summary>
        public CommandResult RenamePad(Rp1PadRenameArgs? args)
        {
            if (!TryPad(args?.LcId, args?.PadId, out var complex, out var pad, out var refusal))
            {
                return refusal!;
            }

            var name = Trimmed(args?.Name);
            if (name == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "the command carried no new name for the launch pad");
            }

            var currentName = Rp1Types.ReadString(pad, "name");
            if (string.Equals(currentName, name, StringComparison.Ordinal))
            {
                return CommandResult.Ok();
            }

            // RP-1's own test, and the one it answers by returning silently. Case
            // insensitive, as its own Exists is.
            foreach (var sibling in Rp1Types.Enumerate(Rp1Types.Member(complex, "LaunchPads")))
            {
                if (string.Equals(Rp1Types.ReadString(sibling, "name"), name, StringComparison.OrdinalIgnoreCase))
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "another launchpad with the same name already exists");
                }
            }

            var rename = Rp1Types.InstanceMethodOn(pad, "Rename", "System.String", 1);
            if (rename == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no launch-pad rename this Uplink recognises, so nothing was changed");
            }

            try
            {
                rename.Invoke(pad, new object[] { name });
            }
            catch (Exception ex)
            {
                // A pad's name is the key its rollouts and its pending
                // construction are stored against, and RP-1's rename rewrites all
                // of them. A throw part-way leaves an operation pointing at a name
                // no pad has.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through renaming pad " + (currentName ?? "at that complex")
                    + ", so check the pad and any rollout on it: " + Rp1Types.ExceptionReason(ex));
            }

            // RP-1's Rename can return having done nothing, and the duplicate
            // check above is the only case in which it does. Reading the name back
            // is what makes this command unable to report a silent no-op as
            // success, which is the whole reason it exists.
            var after = Rp1Types.ReadString(pad, "name");
            if (!string.Equals(after, name, StringComparison.Ordinal))
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 declined to rename the pad and gave no reason, so it is still called "
                    + (after ?? "what it was"));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// Demolishes one of a complex's pads.
        ///
        /// <para>Refuses when it would leave the complex without an operational
        /// pad, which RP-1 answers by silently doing nothing. See
        /// <see cref="Rp1PadDismantleArgs"/>.</para>
        /// </summary>
        public CommandResult DismantlePad(Rp1PadDismantleArgs? args)
        {
            if (!TryPad(args?.LcId, args?.PadId, out var complex, out var pad, out var refusal))
            {
                return refusal!;
            }

            var complexName = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";
            var padName = Rp1Types.ReadString(pad, "name") ?? "that pad";

            // Only OPERATIONAL pads count, which is RP-1's own definition of
            // LaunchPadCount and is why a complex with one working pad and one
            // still being built cannot dismantle either.
            var operationalPads = Rp1Types.Member(complex, "LaunchPadCount") as int?;
            if (operationalPads == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say how many working pads " + complexName + " has, so nothing was changed");
            }

            if (operationalPads.Value < 2)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    complexName + " has "
                    + Plural(operationalPads.Value, "working launch pad", "working launch pads")
                    + " and a launch complex must keep one, so " + padName + " was left alone");
            }

            if (Rp1Types.ReadBool(pad, "isOperational") != true)
            {
                // RP-1's own button is drawn only for an operational pad, and its
                // dismantle path would short-circuit on a pad that is still being
                // built. Removing a pad mid-construction is what
                // PadConstructionProject.Cancel is for and is a different act.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    padName + " is not in service yet, so there is nothing to dismantle: cancel its construction instead");
            }

            var delete = Rp1Types.InstanceMethod(pad, "Delete", 1);
            if (delete == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no launch-pad delete this Uplink recognises, so nothing was changed");
            }

            object?[] arguments = { null };
            object? deleted;
            try
            {
                deleted = delete.Invoke(pad, arguments);
            }
            catch (Exception ex)
            {
                // Delete removes the pad and then shifts the launch-site index of
                // every vessel that pointed past it, so a throw part-way can leave
                // a vehicle bound for a pad that is not there.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through dismantling " + padName
                    + ", so check the complex's pads and anything rolled out: " + Rp1Types.ExceptionReason(ex));
            }

            if (deleted as bool? != true)
            {
                // The out parameter is RP-1's own sentence and is carried through
                // verbatim: "vessel X is currently waiting on the launch pad", "a
                // vessel is currently on the pad", "pad has ongoing rollout", "pad
                // is under construction".
                var reason = arguments[0] as string;
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not dismantle " + padName
                    + (string.IsNullOrWhiteSpace(reason) ? " and gave no reason" : ": " + reason));
            }

            Fire("OnPadDismantled", pad);

            return CommandResult.Ok();
        }

        // ── Shared resolution ─────────────────────────────────────────────────

        /// <summary>
        /// The four refusals every command here shares, in the order they stop
        /// being about the command and start being about the world: an argument,
        /// this Uplink's own resolution, RP-1's scenario module, and the save.
        /// </summary>
        private bool TryComplex(string? lcId, out object complex, out CommandResult? refusal)
        {
            complex = null!;

            if (string.IsNullOrWhiteSpace(lcId))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no launch complex");
                return false;
            }

            if (!IsAvailable)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's launch-complex model could not be resolved, so nothing was changed");
                return false;
            }

            var scm = Rp1Types.StaticValue(_scm!, "Instance");
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

            if (!Rp1ComplexWrites.TryFind(scm, lcId!, out complex))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no launch complex with that id exists at any space centre");
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// A pad, addressed by its complex and its own id.
        ///
        /// <para>Both, rather than searching every complex for the pad: a pad id
        /// is unique, but a command that found one at a complex the operator did
        /// not name would act somewhere they were not looking.</para>
        /// </summary>
        private bool TryPad(
            string? lcId,
            string? padId,
            out object complex,
            out object pad,
            out CommandResult? refusal)
        {
            pad = null!;

            if (!TryComplex(lcId, out complex, out refusal))
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(padId))
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no launch pad, and a complex can have several");
                return false;
            }

            foreach (var candidate in Rp1Types.Enumerate(Rp1Types.Member(complex, "LaunchPads")))
            {
                if (string.Equals(Rp1Types.ReadGuidString(candidate, "id"), padId, StringComparison.OrdinalIgnoreCase))
                {
                    pad = candidate;
                    refusal = null;
                    return true;
                }
            }

            refusal = CommandResult.Fail(
                CommandErrorCode.NotFound,
                "no launch pad with that id exists at " + (Rp1Types.ReadString(complex, "Name") ?? "that launch complex"));
            return false;
        }

        /// <summary>
        /// Removes every pad, LAST FIRST, which is the order RP-1 uses and is not
        /// arbitrary: <c>LCLaunchPad.Delete</c> shifts the launch-site index of
        /// every vessel that pointed past the removed pad, and walking forward
        /// would shift the same indices repeatedly.
        /// </summary>
        private static bool TryDeletePads(object complex, string complexName, out CommandResult? refusal)
        {
            var pads = new List<object>();
            foreach (var pad in Rp1Types.Enumerate(Rp1Types.Member(complex, "LaunchPads")))
            {
                pads.Add(pad);
            }

            for (var i = pads.Count - 1; i >= 0; i--)
            {
                var pad = pads[i];
                var padName = Rp1Types.ReadString(pad, "name") ?? "a pad";
                var delete = Rp1Types.InstanceMethod(pad, "Delete", 1);
                if (delete == null)
                {
                    refusal = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no launch-pad delete this Uplink recognises, so " + complexName
                        + " was left as it was");
                    return false;
                }

                object?[] arguments = { null };
                object? deleted;
                try
                {
                    deleted = delete.Invoke(pad, arguments);
                }
                catch (Exception ex)
                {
                    refusal = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1 threw dismantling pad " + padName + " at " + complexName
                        + ", which may be part-dismantled, so check its pads: " + Rp1Types.ExceptionReason(ex));
                    return false;
                }

                if (deleted as bool? != true)
                {
                    // Every reason Delete can give here has already been checked
                    // above, so reaching this means a condition changed between the
                    // check and the write. Said as a part-dismantled complex rather
                    // than a plain refusal, because the pads after this one are
                    // already gone.
                    var reason = arguments[0] as string;
                    refusal = CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1 would not dismantle pad " + padName + " at " + complexName
                        + (string.IsNullOrWhiteSpace(reason) ? string.Empty : ": " + reason)
                        + ", so the complex is part-dismantled and its remaining pads should be checked");
                    return false;
                }
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// Which of <c>CanDismantle</c>'s four conditions actually holds, as a
        /// phrase.
        ///
        /// <para>RP-1 answers all four with one sentence. Naming the real one
        /// costs four reads and is the difference between an operator scrapping a
        /// vehicle and an operator waiting for a rollout.</para>
        /// </summary>
        private static string InUseReason(object complex)
        {
            var reasons = new List<string>();

            var integrating = Count(Rp1Types.Member(complex, "BuildList")) ?? 0;
            if (integrating > 0)
            {
                reasons.Add(Plural(integrating, "vehicle is being integrated", "vehicles are being integrated"));
            }

            var held = Count(Rp1Types.Member(complex, "Warehouse")) ?? 0;
            if (held > 0)
            {
                reasons.Add(Plural(held, "finished vehicle is in the warehouse", "finished vehicles are in the warehouse"));
            }

            foreach (var operation in Rp1Types.Enumerate(Rp1Types.Member(complex, "Recon_Rollout")))
            {
                // Reconditioning does not block: it is the complex recovering from
                // its own launch rather than work on a vehicle, and RP-1 excludes
                // it by name.
                if (!string.Equals(Rp1Types.ReadEnumName(operation, "RRType"), "Reconditioning", StringComparison.Ordinal))
                {
                    reasons.Add("a rollout, rollback or recovery is under way");
                    break;
                }
            }

            var repairs = Count(Rp1Types.Member(complex, "VesselRepairs")) ?? 0;
            if (repairs > 0)
            {
                reasons.Add("a vessel is being repaired");
            }

            return reasons.Count == 0
                // RP-1's bool said no and none of its four inputs would say why,
                // which is a shape worth reporting rather than papering over.
                ? "RP-1 would not say which of its conditions holds"
                : string.Join("; ", reasons.ToArray());
        }

        /// <summary>
        /// The complex's earned efficiency, and the ids of the complexes that would
        /// keep it.
        ///
        /// <para>Read through <c>SpaceCenterManagement.LCToEfficiency</c> rather
        /// than off the complex, for the reason the read side gives: RP-1's own
        /// <c>EfficiencySource</c> property CREATES a record on a cache miss, and a
        /// command must not author state in the course of describing what it is
        /// about to destroy.</para>
        ///
        /// <para>An absent record is absent rather than zero. RP-1 builds one the
        /// first time a complex is worked, so a complex nobody has built at yet has
        /// no efficiency to lose, which is a different answer from having lost
        /// nothing.</para>
        /// </summary>
        private double? EfficiencyAtRisk(object complex, string? lcId, out List<string>? survivesWith)
        {
            survivesWith = null;

            var scm = _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
            var map = Rp1Types.Member(scm, "LCToEfficiency") as System.Collections.IDictionary;
            if (map == null)
            {
                return null;
            }

            object? source;
            try
            {
                source = map.Contains(complex) ? map[complex] : null;
            }
            catch (Exception)
            {
                // A dictionary keyed on RP-1's own type can throw on a lookup this
                // Uplink cannot satisfy; no record is the safe reading.
                return null;
            }

            if (source == null)
            {
                return null;
            }

            var peers = new List<string>();
            foreach (var peer in Rp1Types.Enumerate(Rp1Types.Member(source, "_lcs")))
            {
                var id = Rp1Types.ReadGuidString(peer, "ID");
                if (id != null && !string.Equals(id, lcId, StringComparison.Ordinal))
                {
                    peers.Add(id);
                }
            }
            peers.Sort(StringComparer.Ordinal);
            survivesWith = peers;

            return Rp1Types.ReadDouble(source, "Efficiency");
        }

        /// <summary>
        /// Fires one of RP-1's own dismantle events, inside its own try, exactly as
        /// RP-1 does.
        ///
        /// <para>A subscriber that throws must not make a completed dismantle
        /// report failure: the complex is already gone, and an operator who read
        /// "failed" would go looking for it.</para>
        /// </summary>
        private void Fire(string eventName, object subject)
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
                Rp1Types.InstanceMethod(bus, "Fire", 1)?.Invoke(bus, new[] { subject });
            }
            catch (Exception)
            {
                // Deliberately swallowed, as RP-1 swallows it.
            }
        }

        /// <summary>Whether a craft is standing on the pad in PRELAUNCH, and its name if so.</summary>
        private static bool PadHasVesselWaiting(object pad, out string? vesselName)
        {
            vesselName = null;
            var method = Rp1Types.InstanceMethod(pad, "HasVesselWaitingToBeLaunched", 1);
            if (method == null)
            {
                return false;
            }

            object?[] arguments = { null };
            try
            {
                if (method.Invoke(pad, arguments) as bool? != true)
                {
                    return false;
                }
            }
            catch (Exception)
            {
                // The check is a courtesy over the gate above, which has already
                // refused every case RP-1 itself refuses; an unreadable answer must
                // not stop a dismantle RP-1 would allow.
                return false;
            }

            vesselName = Rp1Types.ReadString(arguments[0], "vesselName");
            return true;
        }

        /// <summary>
        /// Whether any other complex at the centre has this name. Case
        /// insensitive, as RP-1's own build-path check is.
        /// </summary>
        private static bool NameTakenByAnotherComplex(object? centre, object self, string name)
        {
            foreach (var candidate in Rp1Types.Enumerate(Rp1Types.Member(centre, "LaunchComplexes")))
            {
                if (ReferenceEquals(candidate, self))
                {
                    continue;
                }
                if (string.Equals(Rp1Types.ReadString(candidate, "Name"), name, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// A list's length, or absent when the member could not be read at all.
        /// Absent rather than zero: zero is a legitimate empty warehouse and an
        /// unreadable one is not, and the dismantle turns on the difference.
        /// </summary>
        private static int? Count(object? list) => Rp1Types.Member(list, "Count") as int?;

        /// <summary>A trimmed non-empty string, or absent. Whitespace is not a name.</summary>
        private static string? Trimmed(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }
            return value!.Trim();
        }

        /// <summary>
        /// A count and its noun, agreeing in number and grouped, because these are
        /// read by a person: "1 working launch pad", "1,200 finished vehicles".
        /// </summary>
        private static string Plural(int count, string singular, string plural) =>
            count.ToString("N0", CultureInfo.InvariantCulture) + " " + (count == 1 ? singular : plural);

        /// <summary>A plain refusal, retyped for the one command that answers with a payload.</summary>
        private static CommandResult<Dictionary<string, object?>> Refuse(CommandResult refusal) =>
            CommandResult<Dictionary<string, object?>>.Fail(refusal.ErrorCode, refusal.Detail);
    }
}
