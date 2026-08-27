// RP-1's build queue, made writable. No compile-time reference to RP0.dll, the
// same arm's-length reflection pattern as Rp1ScReflection, whose header carries
// the provenance rules this file follows.
//
// WHAT WAS WRONG. Every rp1.* channel is read-only, so an operator could watch a
// launch complex integrate a vehicle and could not ask it to integrate another.
// Under RP-1 that is not a corner: a design is built once and then flown many
// times, so "build another one of these" is the single most repeated act in the
// career loop, and it was reachable only from RP-1's own in-game window.
//
// WHAT THIS IS A COPY OF. RP-1's build-list window draws a "Duplicate" button
// per vehicle whose entire body is
//
//     KCTUtilities.TryAddVesselToBuildList(vesselProject.CreateCopy(), skipPartChecks: true)
//
// and that is the action reproduced here. TryAddVesselToBuildList itself is NOT
// called, deliberately: it hands the vehicle to VesselBuildValidator, which is a
// Unity coroutine that takes an InputLockManager lock and asks its questions
// through PopupDialog. There is nobody to answer a popup on a command dispatched
// from another machine, so the checks that matter are made here and the
// validator's own success action, KCTUtilities.AddVesselToBuildList, is called
// directly. skipPartChecks is what RP-1's own Duplicate button passes, and it
// means the same thing here: the parts were available when the original was
// integrated and the copy is the same craft node.
//
// THE ONE CHECK THAT CANNOT BE SKIPPED IS THE MONEY, and it is not where it
// looks. KCTUtilities.SpendFunds does NOT test affordability: its whole body is
// a Funding.Instance.AddFunds of the negative amount. The affordability test
// lives in VesselBuildValidator.ProcessFundsChecks, which is the half of the
// validator this file does not call, so a handler that skipped it would put a
// career into negative funds and RP-1 would never complain. That is why the
// currency query below is mandatory and why an unreadable one REFUSES rather
// than proceeding: the safe direction of a failed money check is no build.
//
// THE AUTHORITY ON PRICE IS RP-1'S, NOT THE STORED COST.
// CurrencyModifierQueryRP0.RunQuery is what RP-1's own validator asks, and it is
// asked here for the same reason: leaders and strategies modify what a vessel
// purchase actually costs, so the field on the vehicle is a list price rather
// than the charge. The query fires GameEvents.Modifiers.OnCurrencyModifierQuery,
// which is a broadcast, so it is run ONCE per operator press on the main thread,
// exactly where and as often as RP-1's own window runs it. It is never run from
// a gate or a capture.
//
// WHAT IS READ, and why each is safe:
//
//   SpaceCenterManagement.Instance / .enabledForSave / .KSCs
//                                    the same three reads Rp1ScReflection opens
//                                    with, vouched for there
//   LCSpaceCenter.LaunchComplexes    [Persistent] list
//   LaunchComplex.Name/.IsOperational
//                                    plain fields
//   LaunchComplex.BuildList/.Warehouse
//                                    [Persistent] lists of VesselProject
//   VesselProject.KCTPersistentID/.shipName
//                                    plain [Persistent] fields
//   VesselProject.ShipNodeCompressed a PRIVATE field; .IsEmpty on it is
//                                    `_node == null && _bytes == null`, pure
//   Funding.Instance.Funds           read ONLY to put a number beside a refusal
//
// WHAT IS INVOKED, which is the part that makes this file different from every
// other reader in this Uplink, and each is a write RP-1 itself performs on the
// same click:
//
//   VesselProject.CreateCopy()       builds a fresh VesselProject with new
//                                    shipID and KCTPersistentID. It touches
//                                    EditorLogic ONLY on the empty-node arm,
//                                    which is why the node is tested first
//   VesselProject.GetTotalCost()     computes and memoises cost/emptyCost from
//                                    the craft node when they are zero
//   VesselProject.MeetsFacilityRequirements(List<string>)
//                                    measures the vehicle against its complex's
//                                    envelope. Reproduced from fields in
//                                    Rp1LaunchGate and INVOKED here, because that
//                                    file is a gate and this is a command; see
//                                    FacilityRefusals for the whole of that
//                                    argument
//   CurrencyModifierQueryRP0.RunQuery / .CanAfford / .GetTotal
//   KCTUtilities.AddVesselToBuildList(vp, spendFunds)
//                                    spends, sets the launch site, appends to
//                                    the complex's build list, fires
//                                    SCMEvents.OnVesselAddedToBuildQueue
//
// WHAT IS NOT REPRODUCED. The validator's part-availability, part-config,
// untooled-parts and excess-EC arms. RP-1's own Duplicate button turns the first
// three off (skipPartChecks) because a copy of an integrated vehicle has already
// passed them, and the fourth is a popup that offers to drain batteries. None of
// them can refuse a duplicate that RP-1's own button would accept.
//
// Its facility arm IS reproduced, and is the one arm of the four that had to be:
// the button leaves CheckFacilityRequirements on, and it is the only check whose
// answer can CHANGE after a vehicle is integrated, because modifying a complex
// moves the envelope it will accept.
//
// THE REST OF THE SURFACE, and what RP-1 does and does not allow for each. Read
// out of the same disassembly; none of it is implemented here, and this is what
// the next command would be built against rather than a wish list.
//
//   ROLL OUT. `new ReconRolloutProject(vp, Rollout, vp.shipID.ToString(), pad)`,
//   then set `vp.launchSiteIndex` to the pad's index in `lc.LaunchPads` and add
//   the project to `lc.Recon_Rollout`. Needs an `LCLaunchPad` whose `State` is
//   Free and whose `HasVesselWaitingToBeLaunched` is false. NO up-front
//   affordability check is needed and this is the one place that differs from a
//   build: the constructor computes `cost` but spends nothing, because a rollout
//   is billed AS it progresses, the way a construction is. RP-1's own pad picker
//   is a popup, so a command must take the pad by name and refuse rather than
//   ask.
//
//   ROLL BACK. `rollout.SwitchDirection()` on the vehicle's existing Rollout
//   project, which is a two-line state flip plus a maintenance reschedule. The
//   same call reverses a Rollback, so the command is one verb, not two.
//
//   RUSH. Not per-vehicle at all, and that is a finding rather than a gap:
//   `IsRushing` is a bool on the LAUNCH COMPLEX, so rushing is a mode the whole
//   complex is in and every vehicle in it is rushed together. Its effect is a
//   rate multiplier and a salary multiplier from `Database.SettingsSC`, and on a
//   pad complex it also stops the complex gaining efficiency. A command shaped
//   like "rush this build" would be a lie about what the game does; the honest
//   one is `rp1.complex.rush` taking a complex id and a flag.
//
//   CANCEL / SCRAP. `KCTUtilities.ScrapVessel(vp)` removes the vehicle from
//   whichever list holds it and REFUNDS `GetTotalCost()` in full, integrating or
//   finished alike. One verb covers both, and the refund is why it wants the
//   same arm-then-confirm a build gets: it is reversible only by paying again.
//
//   RECOVER. `KCTUtilities.RecoverActiveVesselToStorage(ProjectType)` acts on
//   `FlightGlobals.ActiveVessel`, so it is a FLIGHT-scene action about the craft
//   on screen rather than a space-centre one, and it takes no id. It belongs
//   with the flight surface, not with this list, and it is the one item of the
//   five that is not addressable from the KSC at all.
//
// PROVENANCE. Every member named above was read out of an ilspycmd disassembly
// of the INSTALLED RP-1 v4.6.0.0 RP0.dll and, for IsEmpty, ROUtils.dll. The
// disassembly verifies SHAPE and never VALUE: nothing here has been exercised
// against a running game, so every hop is null-safe and every failure to read
// refuses the command rather than guessing at it.
using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The handler for <c>rp1.build.repeat</c> and the gate evaluator that
    /// darkens it in advance, together because they resolve the same RP-1 types
    /// and answer the same question from opposite ends: the gate says whether the
    /// command can mean anything at all, the handler says whether this vehicle
    /// can be copied right now.
    /// </summary>
    public sealed class Rp1BuildCommands : ICommandGateEvaluator
    {
        /// <summary>Build another copy of a design RP-1 already holds.</summary>
        public const string RepeatCommand = "rp1.build.repeat";

        /// <summary>The gate kind this Uplink declares and answers for its own commands.</summary>
        public const string GateKind = "rp1.build";

        /// <summary>
        /// The one quantity that kind answers: RP-1 is managing this save.
        ///
        /// <para>Static, with no <see cref="CommandRequirement.Needs"/>, which is
        /// what makes it worth declaring at all: the engine can evaluate it with
        /// an empty argument bag, so the control is dark with a reason on an
        /// install where RP-1 is loaded but the open save is a stock career. The
        /// per-vehicle conditions cannot be declared this way, because the
        /// vehicle is not known until the press, and a requirement that named the
        /// id would abstain for the addressability sample and decide nothing in
        /// advance. Those live in the handler and come back as typed
        /// <see cref="CommandErrorCode"/>s instead.</para>
        /// </summary>
        public const string ManagedSave = "managedSave";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string UtilitiesTypeName = "RP0.KCTUtilities";
        private const string CurrencyQueryTypeName = "RP0.CurrencyModifierQueryRP0";
        private const string TransactionReasonsTypeName = "RP0.TransactionReasonsRP0";
        private const string CurrencyTypeName = "RP0.CurrencyRP0";

        /// <summary>RP-1's transaction reason for buying a vehicle, the one its own validator prices against.</summary>
        private const string VesselPurchaseReason = "VesselPurchase";

        /// <summary>The currency a vessel purchase is denominated in.</summary>
        private const string FundsCurrency = "Funds";

        private readonly Type? _scm;
        private readonly Type? _utilities;
        private readonly Type? _currencyQuery;
        private readonly Type? _transactionReasons;
        private readonly Type? _currency;

        public Rp1BuildCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _utilities = Rp1Types.Find(UtilitiesTypeName);
            _currencyQuery = Rp1Types.Find(CurrencyQueryTypeName);
            _transactionReasons = Rp1Types.Find(TransactionReasonsTypeName);
            _currency = Rp1Types.Find(CurrencyTypeName);
        }

        /// <summary>
        /// Every type this command needs resolved. Gated on the TYPES, never on
        /// an assembly name, for the reason <see cref="Rp1Types.Find"/> gives; and
        /// the currency types count, because a handler that could add to a build
        /// list but not price it is one that overdraws a career.
        /// </summary>
        public bool IsAvailable =>
            _scm != null
            && _utilities != null
            && _currencyQuery != null
            && _transactionReasons != null
            && _currency != null;

        /// <summary>
        /// The requirements <c>rp1.build.repeat</c> declares. One, and static; see
        /// <see cref="ManagedSave"/> for why the per-vehicle conditions are not
        /// here.
        /// </summary>
        public static CommandRequirement[] Requirements() => new[]
        {
            new CommandRequirement { Kind = GateKind, Quantity = ManagedSave },
        };

        public string Kind => GateKind;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var quantity = requirement?.Quantity ?? "";
            if (quantity != ManagedSave)
            {
                return GateVerdict.Unknown($"RP-1 imposes no build condition called \"{quantity}\"");
            }

            var scm = ScmInstance();
            if (scm == null)
            {
                // The scenario module is not up. In a loaded game that is a scene
                // still coming in, which is a read that failed rather than a fact
                // about the save, and the two want opposite answers.
                return GateVerdict.Unknown("RP-1's space centre is not loaded");
            }

            if (Rp1Types.ReadBool(scm, "enabledForSave") != true)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 is installed but is not managing this save, so it has no build queue to add to");
            }

            return GateVerdict.Pass();
        }

        /// <summary>
        /// Builds another copy of the vehicle named by
        /// <see cref="Rp1BuildRepeatArgs.Id"/>, at the launch complex that holds
        /// the original, charging the career for it.
        ///
        /// <para>Runs on the game's main thread: the host is constructed with
        /// <c>executeCommandsOnMainThread</c>, and every invoke below is a live
        /// RP-1 write that would be illegal anywhere else.</para>
        ///
        /// <para>Ordered so that nothing is charged and nothing is appended until
        /// every refusal has had its chance. The copy is made LAST before the
        /// add, because it is the only step with a cost the game keeps if the
        /// next one fails.</para>
        /// </summary>
        public CommandResult Repeat(Rp1BuildRepeatArgs? args)
        {
            var id = args?.Id;
            if (string.IsNullOrWhiteSpace(id))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "the command named no vehicle, and RP-1 keeps several of the same name");
            }

            if (!IsAvailable)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's build model could not be resolved, so nothing was started");
            }

            var scm = ScmInstance();
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

            if (!TryFind(scm, id!, out var vessel, out var complex))
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no vehicle with that id is being integrated or held at any launch complex");
            }

            var complexName = Rp1Types.ReadString(complex, "Name") ?? "the launch complex";
            if (Rp1Types.ReadBool(complex, "IsOperational") != true)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotReady,
                    complexName + " is being built or renovated, so it cannot start another vehicle yet");
            }

            if (HasNoStoredDesign(vessel))
            {
                // CreateCopy's empty-node arm reaches EditorLogic for a ship to
                // store, and outside the editor there is not one. Caught here so
                // the operator is told what is missing rather than handed the
                // exception that would follow.
                return CommandResult.Fail(
                    CommandErrorCode.NotReady,
                    "RP-1 holds no stored craft for this vehicle, so there is nothing to copy");
            }

            var failedChecks = FacilityRefusals(vessel);
            if (failedChecks != null)
            {
                // Asked BEFORE the price, the order RP-1's own validator uses:
                // there is no sense pricing a vehicle the complex will not take.
                return CommandResult.Fail(
                    CommandErrorCode.NotReady,
                    "RP-1 will not integrate this vehicle at " + complexName + ": " + failedChecks);
            }

            var price = TryPrice(vessel, out var affordable, out var priceFailure);
            if (priceFailure != null)
            {
                return priceFailure;
            }

            if (!affordable)
            {
                return CommandResult.Fail(CommandErrorCode.InsufficientFunds, new LimitBreach
                {
                    Facility = complexName,
                    FacilityName = complexName,
                    Quantity = "funds",
                    Actual = price,
                    Limit = ReadFundsBalance(),
                    Unit = Units.Funds,
                });
            }

            object copy;
            try
            {
                var createCopy = InstanceMethod(vessel, "CreateCopy", 0);
                if (createCopy == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no vehicle-copy step this Uplink recognises");
                }
                copy = createCopy.Invoke(vessel, null)!;
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 could not copy this vehicle: " + Reason(ex));
            }

            try
            {
                var add = StaticMethod(_utilities!, "AddVesselToBuildList", 2);
                if (add == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "this RP-1 build has no build-list add this Uplink recognises");
                }
                add.Invoke(null, new object[] { copy, true });
            }
            catch (Exception ex)
            {
                // The add spends before it appends, so a throw from inside it can
                // leave the career charged for a vehicle that is not on any list.
                // Said plainly rather than reported as a plain refusal, because an
                // operator who reads "refused" and retries would pay twice.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through starting this build, so check the queue and the balance before retrying: "
                    + Reason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// The vehicle and the complex holding it, searched across every centre's
        /// build lists and warehouses.
        ///
        /// <para>Both lists, because RP-1's own Duplicate button is drawn on both:
        /// a design worth building again is usually one that finished, and a
        /// finished vehicle sits in the warehouse rather than the queue.</para>
        /// </summary>
        private bool TryFind(object scm, string id, out object vessel, out object complex)
        {
            foreach (var centre in Rp1Types.Enumerate(Rp1Types.Member(scm, "KSCs")))
            {
                foreach (var lc in Rp1Types.Enumerate(Rp1Types.Member(centre, "LaunchComplexes")))
                {
                    if (TryFindIn(lc, "BuildList", id, out vessel))
                    {
                        complex = lc;
                        return true;
                    }
                    if (TryFindIn(lc, "Warehouse", id, out vessel))
                    {
                        complex = lc;
                        return true;
                    }
                }
            }
            vessel = null!;
            complex = null!;
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

        /// <summary>
        /// RP-1's own reasons for refusing to integrate this vehicle at its
        /// complex, joined into a sentence, or null when it has none.
        ///
        /// <para>Asked because a copy is built at the ORIGINAL's complex and a
        /// complex's limits move: a modification changes its mass and size
        /// envelope, so a vehicle it accepted last year is not one it accepts
        /// today. Without this the build starts, the funds go, and the vehicle is
        /// refused at the pad by the launch gate that already applies the same
        /// rules.</para>
        ///
        /// <para>Invoked rather than reproduced, unlike <see cref="Rp1LaunchGate"/>
        /// which reproduces these rules from fields. That file is a GATE, and a
        /// gate must not write to the player's save; this is a command, running on
        /// the main thread at the moment of an operator's press, which is exactly
        /// where RP-1's own button calls it.</para>
        ///
        /// <para>An unanswerable check PROCEEDS rather than refuses, the opposite
        /// of the price check above, and the asymmetry is deliberate. Refusing on
        /// an unreadable price protects a career from being overdrawn with nothing
        /// to show; refusing on an unreadable envelope would kill the whole
        /// feature the first time RP-1 renames a member, for a check whose worst
        /// case is a vehicle built at a complex that will not fly it, which the
        /// launch gate still catches before it can matter.</para>
        /// </summary>
        private static string? FacilityRefusals(object vessel)
        {
            try
            {
                var meets = InstanceMethod(vessel, "MeetsFacilityRequirements", 1);
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
                // See the doc comment: unanswerable means proceed here.
                return null;
            }
        }

        /// <summary>
        /// Whether RP-1 has no craft node stored for this vehicle. False when the
        /// question cannot be answered: an unreadable node is not evidence of an
        /// empty one, and the copy attempt below is wrapped anyway.
        /// </summary>
        private static bool HasNoStoredDesign(object vessel)
        {
            var node = Rp1Types.Member(vessel, "ShipNodeCompressed");
            return node != null && Rp1Types.ReadBool(node, "IsEmpty") == true;
        }

        /// <summary>
        /// What RP-1 would actually charge for this vehicle, and whether the
        /// career can cover it.
        ///
        /// <para>A refusal comes back through <paramref name="failure"/> rather
        /// than as an unaffordable verdict, because "the price could not be
        /// computed" and "the price is too high" are different things to tell an
        /// operator, and only the second is about their money.</para>
        /// </summary>
        private double TryPrice(object vessel, out bool affordable, out CommandResult? failure)
        {
            affordable = false;
            failure = null;
            try
            {
                var totalCost = InstanceMethod(vessel, "GetTotalCost", 0);
                var runQuery = StaticMethod(_currencyQuery!, "RunQuery", 4);
                var reason = Enum.Parse(_transactionReasons!, VesselPurchaseReason);
                var funds = Enum.Parse(_currency!, FundsCurrency);
                if (totalCost == null || runQuery == null)
                {
                    failure = PriceUnreadable(null);
                    return 0.0;
                }

                var listPrice = Rp1Types.ToDouble(totalCost.Invoke(vessel, null)) ?? 0.0;
                var query = runQuery.Invoke(null, new object[] { reason, -listPrice, 0.0, 0.0 });
                var canAfford = query?.GetType().GetMethod("CanAfford", new[] { _currency! });
                var getTotal = query?.GetType().GetMethod("GetTotal", new[] { _currency!, typeof(bool) });
                if (query == null || canAfford == null)
                {
                    failure = PriceUnreadable(null);
                    return 0.0;
                }

                affordable = canAfford.Invoke(query, new[] { funds }) is bool ok && ok;

                // The charge RP-1 arrived at, not the list price: leaders and
                // strategies move it, and a refusal that quoted the wrong number
                // would send an operator looking for funds they already have. The
                // query states it as a negative delta, so it is negated back.
                var charged = getTotal == null
                    ? (double?)null
                    : Rp1Types.ToDouble(getTotal.Invoke(query, new object[] { funds, true }));
                return charged.HasValue ? -charged.Value : listPrice;
            }
            catch (Exception ex)
            {
                failure = PriceUnreadable(ex);
                return 0.0;
            }
        }

        /// <summary>
        /// The refusal for a price this Uplink could not compute. It REFUSES, and
        /// that direction is the whole point: RP-1's SpendFunds does no
        /// affordability test of its own, so proceeding on an unreadable price is
        /// how a career ends up in negative funds with nothing to show for it.
        /// </summary>
        private static CommandResult PriceUnreadable(Exception? ex) => CommandResult.Fail(
            CommandErrorCode.ModeUnavailable,
            "RP-1's own price for this vehicle could not be read, so the build was not started"
            + (ex == null ? "" : ": " + Reason(ex)));

        /// <summary>
        /// The career's funds, for the number beside a refusal only. Read off
        /// KSP's own Funding rather than anything of RP-1's, because RP-1 keeps
        /// no balance of its own; absent when it cannot be read, which costs a
        /// refusal its second number and nothing else.
        /// </summary>
        private static double? ReadFundsBalance()
        {
            var funding = Rp1Types.Find("Funding");
            if (funding == null)
            {
                return null;
            }
            return Rp1Types.ReadDouble(Rp1Types.StaticValue(funding, "Instance"), "Funds");
        }

        private object? ScmInstance() => _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");

        /// <summary>
        /// A public instance method by name and arity. Arity rather than the
        /// parameter TYPES because those are RP-1's own and naming them would need
        /// the compile-time reference this assembly deliberately does not have.
        /// </summary>
        private static MethodInfo? InstanceMethod(object target, string name, int parameterCount) =>
            Match(target.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance), name, parameterCount);

        private static MethodInfo? StaticMethod(Type type, string name, int parameterCount) =>
            Match(type.GetMethods(BindingFlags.Public | BindingFlags.Static), name, parameterCount);

        private static MethodInfo? Match(IEnumerable<MethodInfo> methods, string name, int parameterCount)
        {
            foreach (var m in methods)
            {
                if (m.Name == name && m.GetParameters().Length == parameterCount)
                {
                    return m;
                }
            }
            return null;
        }

        /// <summary>
        /// What to quote from a throw. Reflection wraps a handler's own exception
        /// in a TargetInvocationException whose message says only that an
        /// exception was thrown, which tells an operator nothing at all.
        /// </summary>
        private static string Reason(Exception ex) =>
            (ex is TargetInvocationException tie && tie.InnerException != null ? tie.InnerException : ex).Message;
    }
}
