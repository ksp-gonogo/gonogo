// Buying every tooling a ship is missing, and reshaping a part to tooling already
// owned. Two verbs of DIFFERENT KINDS, which is the thing to keep hold of.
//
// PROVENANCE. Both sequences were read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll, from RP0.ToolingGUI and RP0.ToolingPartResizer:
// the window an operator would otherwise be using.
//
// TOOL ALL IS A PURCHASE. RP-1's own order, replicated:
//
//   1  collect every ModuleTooling on the editor ship where !IsUnlocked()
//   2  price it, and check the career can afford it
//   3  ModuleTooling.PurchaseToolingBatch(parts), which charges through
//      UnlockCreditHandler inside a CareerEventScope
//   4  fire GameEvents.onEditorShipModified so the editor re-prices the vessel
//
// Step 2's PRICE COMES OFF A CACHED FIELD, and the obvious route is a trap.
// RP-1's window prices the ship with ToolingGUI.GetUntooledPartsAndCost, which
// calls PurchaseToolingBatch(parts, isSimulation: true) -- and that "simulation"
// saves the tooling database to a ConfigNode, PERFORMS EVERY PURCHASE FOR REAL,
// then reloads from the node. One throw between the save and the reload leaves the
// career's tooling bought. Nothing here calls it. SpaceCenterManagement
// .EditorToolingCosts is the same number, already deduplicated, as a plain field.
//
// Step 4 is not decoration. The untooled surcharge rides IPartCostModifier, so a
// vessel that has just been tooled is still quoting its old price until the editor
// recomputes, and the thing that makes it recompute is that event. RP-1 fires it
// for the same reason.
//
// REFIT IS AN EDIT, and must not wear the purchase's clothes. It spends nothing
// and writes nothing to the tooling database: ToolingPartResizer.Resize reshapes a
// part so that it fits tooling the career ALREADY owns. That is the other way of
// closing the gap the channel reports, and it is a change to the craft rather than
// to the career.
//
// Its two reaches beyond the part named, both of which RP-1 discloses only
// afterwards in a screen message:
//
//   symmetry counterparts are resized too   (CountCounterparts)
//   the tank material is applied to a GROUP (ApplyRfTypeToGroup)
//
// This surface says them FIRST instead: rp1.tooling[].symmetryCounterparts carries
// the count so a control can warn before the press, and the refusal below names
// the part when it cannot be reshaped at all.
//
// AND IT DOES NOT READ WHICH PANEL IS OPEN. RP-1's control takes its target from
// ToolingPartResizer.PawTarget(), which returns the part whose action window the
// player has open and null when zero or several are. Resize itself takes a Part.
// That distinction is the whole of why this command names a craft id: a verb whose
// subject depends on a panel being open is one an operator at another console
// cannot use, which is the rule the window ratchet exists to hold.
using System;
using System.Collections;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// <c>rp1.tooling.toolAll</c> and <c>rp1.tooling.refit</c>: pay for the tooling
    /// a ship needs, or move the ship to tooling already paid for.
    /// </summary>
    public sealed class Rp1ToolingCommands
    {
        public const string ToolAllCommand = "rp1.tooling.toolAll";

        public const string RefitCommand = "rp1.tooling.refit";

        private const string ModuleToolingTypeName = "RP0.ModuleTooling";

        private const string ResizerTypeName = "RP0.ToolingPartResizer";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";

        private const string CreditTypeName = "RP0.UnlockCreditHandler";

        private const string EditorLogicTypeName = "EditorLogic";

        private const string GameEventsTypeName = "GameEvents";

        private const string PartTypeName = "Part";

        private const string ShipConstructTypeName = "ShipConstruct";

        private const string ReasonsTypeName = "RP0.TransactionReasonsRP0";

        private const string ToolingPurchaseReason = "ToolingPurchase";

        private readonly Type? _moduleTooling;

        private readonly Type? _resizer;

        public Rp1ToolingCommands()
        {
            _moduleTooling = Rp1Types.Find(ModuleToolingTypeName);
            _resizer = Rp1Types.Find(ResizerTypeName);
        }

        /// <summary>
        /// RP-1's tooling module base AND its resizer resolved. Both, because the
        /// two commands need one each and a build missing either should not offer
        /// the pair.
        /// </summary>
        public bool IsAvailable => _moduleTooling != null && _resizer != null;

        /// <summary>Buy every tooling the ship on the editor's table is missing.</summary>
        public CommandResult ToolAll(Rp1ToolAllArgs? args)
        {
            try
            {
                var parts = EditorParts();
                if (parts == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "There is no ship on the editor's table. Tooling is bought for the vehicle being designed.");
                }

                var untooled = UntooledModules(parts);
                if (untooled.Count == 0)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.WrongState,
                        "Every part on this vehicle is already tooled.");
                }

                var cost = CachedToolAllCost();
                if (cost == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1's tooling price for this vehicle could not be read.");
                }

                var affordable = CanAfford(cost.Value);
                if (affordable == false)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "The career cannot afford to tool this vehicle.");
                }

                // Resolved BEFORE the purchase, because everything after it has
                // already spent the money.
                var batch = _moduleTooling == null
                    ? null
                    : Rp1Types.StaticMethod(_moduleTooling, "PurchaseToolingBatch", 2);
                if (batch == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1's tooling purchase could not be reached.");
                }

                // Two arguments, and the second is the one that matters: it is
                // `isSimulation` and it DEFAULTS to false, so reflection sees an
                // arity of two and the value has to be passed. Omitting it is not
                // possible here, and passing true would run the save-purchase-reload
                // path this file refuses.
                batch.Invoke(null, new object?[] { AsToolingList(untooled), false });

                RepriceEditorShip();
                return CommandResult.Ok();
            }
            catch (Exception e)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState, "Tooling the vehicle failed: " + Rp1Types.ExceptionReason(e));
            }
        }

        /// <summary>Reshape a part to a size whose tooling is already owned.</summary>
        public CommandResult Refit(Rp1ToolingRefitArgs? args)
        {
            try
            {
                if (string.IsNullOrEmpty(args?.PartId))
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "A part is required: this reshapes one part, named, rather than whichever the game has selected.");
                }
                if (args!.Diameter == null || args.Length == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "A diameter and a length are required: a refit moves a part TO a size, and there is no default size to move it to.");
                }

                var parts = EditorParts();
                if (parts == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "There is no ship on the editor's table. A refit reshapes a part of the vehicle being designed.");
                }

                var part = FindPart(parts, args.PartId!);
                if (part == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.NotFound, "No part with that id is on this vehicle.");
                }

                var resize = _resizer == null
                    ? null
                    : Rp1Types.StaticMethodOn(_resizer, "Resize", PartTypeName, 4);
                if (resize == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable, "RP-1's part resizer could not be reached.");
                }

                // Four parameters, and the fourth is defaulted: reflection counts it
                // whether or not a caller would have written it, so the material is
                // passed explicitly and a null leaves it alone. RP-1 calls that a
                // resize rather than a refit and so does the doc comment on the args.
                resize.Invoke(
                    null,
                    new object?[]
                    {
                        part,
                        (float)args.Diameter.Value,
                        (float)args.Length.Value,
                        string.IsNullOrEmpty(args.RfType) ? null : args.RfType,
                    });

                return CommandResult.Ok();
            }
            catch (Exception e)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState, "Refitting the part failed: " + Rp1Types.ExceptionReason(e));
            }
        }

        /// <summary>The parts of the ship on the editor's table, or null when there is none.</summary>
        private static IEnumerable<object>? EditorParts()
        {
            var editor = Rp1Types.Find(EditorLogicTypeName);
            var fetch = editor == null ? null : Rp1Types.StaticValue(editor, "fetch");
            var parts = Rp1Types.Member(Rp1Types.Member(fetch, "ship"), "Parts");
            return parts == null ? null : Rp1Types.Enumerate(parts);
        }

        /// <summary>
        /// Every tooling module on the ship that is not yet paid for, recognised by
        /// assignability to RP-1's own base rather than by a list of subclass names.
        /// </summary>
        private List<object> UntooledModules(IEnumerable<object> parts)
        {
            var untooled = new List<object>();
            foreach (var part in parts)
            {
                foreach (var module in Rp1Types.Enumerate(Rp1Types.Member(part, "Modules")))
                {
                    if (!_moduleTooling!.IsInstanceOfType(module))
                    {
                        continue;
                    }
                    var unlocked = Rp1Types.InstanceMethod(module, "IsUnlocked", 0)?.Invoke(module, null);
                    if (unlocked is bool ok && !ok)
                    {
                        untooled.Add(module);
                    }
                }
            }
            return untooled;
        }

        /// <summary>
        /// The modules as the <c>List&lt;ModuleTooling&gt;</c> RP-1's batch expects.
        /// </summary>
        /// <remarks>
        /// Built through the runtime type rather than as a <c>List&lt;object&gt;</c>,
        /// because the parameter is typed and a mismatched generic argument is an
        /// argument exception at the invoke rather than a compile error anywhere.
        /// </remarks>
        private IList AsToolingList(List<object> modules)
        {
            var list = (IList)Activator.CreateInstance(
                typeof(List<>).MakeGenericType(_moduleTooling!))!;
            foreach (var module in modules)
            {
                list.Add(module);
            }
            return list;
        }

        /// <summary>
        /// RP-1's own deduplicated price, off the field it caches it in. See this
        /// file's header for why the window's own pricing call is refused.
        /// </summary>
        private static double? CachedToolAllCost()
        {
            var scm = Rp1Types.Find(ScmTypeName);
            return scm == null
                ? null
                : Rp1Types.ToDouble(Rp1Types.StaticValue(scm, "EditorToolingCosts"));
        }

        /// <summary>
        /// Whether the career can pay, asked the way RP-1 asks it so that unlock
        /// credit counts toward the answer. Null when it could not be asked, which
        /// the caller treats as "do not block": RP-1's own purchase runs its own
        /// affordability check and would refuse anyway.
        /// </summary>
        private static bool? CanAfford(double cost)
        {
            var credit = Rp1Types.Find(CreditTypeName);
            var instance = credit == null ? null : Rp1Types.StaticValue(credit, "Instance");
            var reasons = Rp1Types.Find(ReasonsTypeName);
            if (instance == null || reasons == null)
            {
                return null;
            }
            var method = Rp1Types.InstanceMethod(instance, "GetPrePostCostAndAffordability", 6);
            if (method == null)
            {
                return null;
            }
            var arguments = new object?[]
            {
                cost, Enum.Parse(reasons, ToolingPurchaseReason), 0.0, 0.0, 0.0, false,
            };
            method.Invoke(instance, arguments);
            return arguments[5] as bool?;
        }

        /// <summary>The part on this ship carrying the given craft id.</summary>
        private static object? FindPart(IEnumerable<object> parts, string partId)
        {
            foreach (var part in parts)
            {
                if (string.Equals(
                        Rp1Types.Member(part, "craftID")?.ToString(), partId, StringComparison.Ordinal))
                {
                    return part;
                }
            }
            return null;
        }

        /// <summary>
        /// Tell the editor the ship changed, so it re-prices it.
        ///
        /// <para>Not cosmetic. The untooled surcharge rides
        /// <c>IPartCostModifier</c>, so a vehicle that has just been tooled goes on
        /// quoting its old cost until something makes the editor recompute, and
        /// this event is what RP-1 fires for exactly that reason.</para>
        ///
        /// <para>Best effort, and deliberately not a failure: the tooling is bought
        /// by the time this runs, and reporting an error for a stale price would
        /// say the purchase did not happen.</para>
        /// </summary>
        private static void RepriceEditorShip()
        {
            try
            {
                var events = Rp1Types.Find(GameEventsTypeName);
                var modified = events == null
                    ? null
                    : Rp1Types.StaticValue(events, "onEditorShipModified");
                var editor = Rp1Types.Find(EditorLogicTypeName);
                var ship = Rp1Types.Member(
                    editor == null ? null : Rp1Types.StaticValue(editor, "fetch"), "ship");
                if (modified == null || ship == null)
                {
                    return;
                }
                Rp1Types.InstanceMethodOn(modified, "Fire", ShipConstructTypeName, 1)
                    ?.Invoke(modified, new[] { ship });
            }
            catch (Exception)
            {
                // See the summary: the purchase already landed.
            }
        }
    }
}
