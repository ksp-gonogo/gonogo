using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IPartActionActuator"/>: reads and fires the buttons of
    /// a part's right-click Part Action Window. Resolves the target part by
    /// <c>flightID.ToString()</c> across <see cref="ActiveVesselScope.Current"/>'s parts
    /// (the same join key the read side stamps on <c>vessel.parts</c>), exactly
    /// as <see cref="KspRoboticsActuator"/> does, then walks or invokes
    /// <see cref="BaseEvent"/>s.
    ///
    /// <para><b>The PAW is the union of two event lists.</b> A part's buttons come
    /// from <c>part.Events</c> and from every <c>part.Modules[i].Events</c>, and
    /// the module half is where nearly everything interesting lives (solar
    /// deploy, antenna extend, scanner start, science run) because those are all
    /// <c>PartModule</c>s. Walking only <c>part.Events</c> would produce a
    /// near-empty window. Whether KSP's own <c>part.Events</c> already aggregates
    /// its modules' is not relied on either way:
    /// <see cref="PartActionsViewProvider"/> deduplicates on
    /// <c>(moduleName, name)</c>, so aggregation collapses the duplicate and no
    /// aggregation still yields the full set. See that method's doc comment.</para>
    ///
    /// <para><b>Filter: <c>guiActive</c> only.</b> That is "this button is in the
    /// flight PAW at all". The enabled flag (<c>active</c>) is carried rather than
    /// filtered on, because KSP itself greys an inert button out rather than
    /// removing it: see <see cref="PartActionEntry.Active"/>. Editor-only events
    /// (<c>guiActiveEditor</c>) never qualify, this is a flight surface.</para>
    ///
    /// <para>Like every other actuator here, both methods run on the Unity main
    /// thread (the read via the capture half of
    /// <c>IUplinkHost.AddSampledSource</c>, the invoke via the
    /// <c>ChannelEngine</c> command pump marshalling onto
    /// <c>GonogoAddon.FixedUpdate</c>), and every failure is a typed
    /// <see cref="CommandResult"/> rather than a thrown exception.</para>
    /// </summary>
    public sealed class KspPartActionActuator : IPartActionActuator
    {
        private const string NeedsSomeoneAtTheGame = "that action needs someone at the game's screen";

        public IReadOnlyList<PartActionEntry> List(string partId)
        {
            var entries = new List<PartActionEntry>();

            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null)
            {
                return entries;
            }

            var part = FindPart(vessel, partId);
            if (part == null)
            {
                // A read has no error channel: an unresolvable id yields an empty
                // list, and the invoke command is where that becomes a typed
                // NotFound. See IPartActionActuator.List's doc comment.
                return entries;
            }

            // The part's own events first, then each module's in module order:
            // the order KSP builds the window in. PartActionsViewProvider
            // preserves it rather than re-sorting, so the operator's list reads
            // in the same order as the game's.
            Collect(part.Events, moduleName: null, moduleIndex: null, entries);

            if (part.Modules != null)
            {
                for (var i = 0; i < part.Modules.Count; i++)
                {
                    var module = part.Modules[i];
                    // The game's window leaves out a module that is switched off, with its buttons and its rows.
                    if (module == null || !module.isEnabled)
                    {
                        continue;
                    }
                    Collect(module.Events, module.moduleName, i, entries);
                }
            }

            return entries;
        }

        public IReadOnlyList<PartWindowItem> ListWindow(string partId)
        {
            var items = new List<PartWindowItem>();
            var vessel = ActiveVesselScope.Current;
            var part = vessel == null || vessel.parts == null ? null : FindPart(vessel, partId);
            if (part == null)
            {
                return items;
            }

            CollectFields(part.Fields, part, "", items);
            if (part.Modules != null)
            {
                foreach (PartModule module in part.Modules)
                {
                    if (module != null && module.isEnabled)
                    {
                        CollectFields(module.Fields, module, module.ClassName, items);
                    }
                }
            }

            if (part.Resources != null)
            {
                foreach (PartResource resource in part.Resources)
                {
                    if (resource == null || resource.info == null || !resource.info.isVisible)
                    {
                        continue;
                    }

                    items.Add(new PartWindowItem
                    {
                        Kind = "resource",
                        Name = resource.resourceName,
                        Label = resource.info.displayName ?? resource.resourceName,
                        Number = resource.amount,
                        Min = 0,
                        Max = resource.maxAmount,
                        Flows = resource.flowState,
                    });
                }
            }

            return items;
        }

        private static void CollectFields(BaseFieldList? fields, object host, string moduleName, List<PartWindowItem> into)
        {
            if (fields == null)
            {
                return;
            }

            foreach (BaseField field in fields)
            {
                if (field == null || !field.guiActive)
                {
                    continue;
                }

                var control = field.uiControlFlight;

                var label = PartActionText.Clean(field.guiName);
                if (label == null)
                {
                    continue;
                }

                object? raw = null;
                string text;
                try
                {
                    raw = field.GetValue(host);
                    text = PartWindowText.LabelValue(
                        raw is string held ? PartActionText.Resolve(held) : null,
                        PartActionText.Resolve(field.GuiString(host)),
                        label,
                        PartActionText.Resolve(field.guiName));
                }
                catch (Exception ex)
                {
                    GonogoLog.Warn("a part field read threw", ex);
                    continue;
                }

                var item = new PartWindowItem
                {
                    Module = moduleName,
                    Name = field.name,
                    Label = label,
                    Group = GroupName(field.group),
                    Text = text,
                    Advanced = field.advancedTweakable,
                    Kind = "label",
                };

                switch (control)
                {
                    case UI_FloatRange range:
                        item.Kind = "slider";
                        item.Number = ToNumber(raw);
                        item.Min = range.minValue;
                        item.Max = range.maxValue;
                        item.Step = range.stepIncrement;
                        item.Editable = control.controlEnabled;
                        break;
                    case UI_Toggle toggle:
                        item.Kind = "toggle";
                        item.Number = raw is bool on ? (on ? 1d : 0d) : (double?)null;
                        item.Editable = control.controlEnabled;
                        item.Options = OptionNames(new[] { toggle.disabledText, toggle.enabledText });
                        item.Text = NameAt(item.Options, item.Number, item.Text);
                        break;
                    case UI_ChooseOption choose:
                        item.Kind = "option";
                        item.Options = OptionNames(choose.display ?? choose.options);
                        item.Number = Array.IndexOf(choose.options ?? new string[0], raw as string ?? Convert.ToString(raw));
                        item.Text = NameAt(item.Options, item.Number, item.Text);
                        item.Editable = control.controlEnabled;
                        break;
                    case UI_Cycle cycle:
                        item.Kind = "cycle";
                        item.Options = OptionNames(cycle.stateNames);
                        item.Number = raw is string named
                            ? Array.IndexOf(cycle.stateNames ?? new string[0], named)
                            : ToNumber(raw);
                        item.Text = NameAt(item.Options, item.Number, item.Text);
                        item.Editable = control.controlEnabled;
                        break;
                }

                into.Add(item);
            }
        }

        /// <summary>Each entry as the game prints it, with its localisation tag resolved.</summary>
        private static List<string> OptionNames(string[]? names)
        {
            var resolved = new List<string>();
            if (names != null)
            {
                foreach (var name in names)
                {
                    resolved.Add(PartActionText.ResolveCached(name));
                }
            }

            return resolved;
        }

        /// <summary>The entry the current position names, or <paramref name="printed"/> when the position is outside the list.</summary>
        private static string NameAt(List<string> names, double? position, string printed)
        {
            if (position.HasValue)
            {
                var index = (int)position.Value;
                if (index >= 0 && index < names.Count && index == position.Value)
                {
                    return names[index];
                }
            }

            return printed;
        }

        private static double? ToNumber(object? raw)
        {
            try
            {
                return raw == null ? (double?)null : Convert.ToDouble(raw, System.Globalization.CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return null;
            }
        }

        public CommandResult Invoke(string partId, string eventName, int? moduleIndex)
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var ambiguous = PartIdRule.AmbiguousRefusal(partId, CountParts(vessel, partId));
            if (ambiguous != null)
            {
                return ambiguous;
            }

            var part = FindPart(vessel, partId);
            if (part == null)
            {
                // The part is gone: staged away, undocked into another vessel, or
                // the vessel unloaded. flightID is stable for a part's life on one
                // vessel but not across those events, so this is the expected
                // failure for a client holding a slightly stale id, and it must
                // read as a clean failure rather than a silent no-op.
                return CommandResult.Fail(CommandErrorCode.NotFound, "this part is not on the craft");
            }

            var found = FindEvent(part, eventName, moduleIndex, out var moduleName);
            if (found == null)
            {
                // The part is there but exposes no such button (a mode change
                // retired it, or the client's list is stale). Distinct from
                // NotFound on purpose: "wrong action" is a different fix from
                // "wrong part".
                return CommandResult.Fail(
                    CommandErrorCode.CapabilityMismatch, "this part has no such action");
            }

            if (!found.active || found.EventIsDisabledByVariant)
            {
                // Present but inert. Invoking it in-game does nothing, so refusing
                // is more honest than reporting a success that changed nothing.
                return CommandResult.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    found.EventIsDisabledByVariant
                        ? "this part's variant disables that action"
                        : "that action is not active on this part");
            }

            if (InGameOnlyPartActions.IsInGameOnly(eventName, moduleName))
            {
                return CommandResult.Fail(CommandErrorCode.CapabilityMismatch, NeedsSomeoneAtTheGame);
            }

            var partCountBefore = vessel.parts.Count;
            var locksBefore = new List<string>(InputLockManager.lockStack.Keys);
            var dialogsBefore = new HashSet<PopupDialog>(UnityEngine.Object.FindObjectsOfType<PopupDialog>());
            try
            {
                found.Invoke();
            }
            catch (Exception ex)
            {
                GonogoLog.Warn("a part action threw", ex);
                var outcome = PartActionFault.AfterThrow(
                    part.vessel != vessel || vessel.parts == null || vessel.parts.Count != partCountBefore,
                    ThirdPartyFault.Describe("that part's action", ex));
                if (!outcome.Success)
                {
                    return outcome;
                }
            }

            var locksAdded = InGameOnlyPartActions.NewLocks(locksBefore, InputLockManager.lockStack.Keys);
            if (locksAdded.Count > 0 && !InGameOnlyPartActions.IsMirrored(eventName))
            {
                /* A button no list knew about has locked the craft with nobody at the console able to release it. Undo exactly what this press took. A mod removing a lock already gone later is harmless, since RemoveControlLock returns on an absent key. */
                foreach (var key in locksAdded)
                {
                    InputLockManager.RemoveControlLock(key);
                }
                foreach (var dialog in UnityEngine.Object.FindObjectsOfType<PopupDialog>())
                {
                    if (!dialogsBefore.Contains(dialog))
                    {
                        dialog.Dismiss();
                    }
                }
                InGameOnlyPartActions.Learn(eventName, moduleName);
                return CommandResult.Fail(CommandErrorCode.CapabilityMismatch, NeedsSomeoneAtTheGame);
            }

            return CommandResult.Ok();
        }

        public CommandResult SetField(string partId, string moduleName, string fieldName, double value)
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var ambiguous = PartIdRule.AmbiguousRefusal(partId, CountParts(vessel, partId));
            if (ambiguous != null)
            {
                return ambiguous;
            }

            var part = FindPart(vessel, partId);
            if (part == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "this part is not on the craft");
            }

            PartModule? module = null;
            BaseField? field;
            if (string.IsNullOrEmpty(moduleName))
            {
                field = part.Fields?[fieldName];
            }
            else
            {
                field = FindModuleField(part, moduleName, fieldName, out module);
                if (module == null)
                {
                    return CommandResult.Fail(CommandErrorCode.CapabilityMismatch, "this part has no such module");
                }
            }

            if (field == null)
            {
                return CommandResult.Fail(CommandErrorCode.CapabilityMismatch, "this part has no such field");
            }

            var control = field.uiControlFlight;
            if (!field.guiActive || control == null || !control.controlEnabled)
            {
                return CommandResult.Fail(CommandErrorCode.CapabilityMismatch, "the game does not offer that field in flight");
            }

            var converted = ConvertForControl(field, control, value, out var refusal);
            if (refusal != null)
            {
                return refusal;
            }

            var host = (object?)module ?? part;
            try
            {
                var before = field.GetValue(host);
                var changed = !Equals(before, converted);

                if ((control.affectSymCounterparts & UI_Scene.Flight) != UI_Scene.None)
                {
                    changed |= WriteSymmetryCounterparts(part, module, field, converted);
                }

                if (!changed)
                {
                    return CommandResult.Ok();
                }

                field.SetValue(converted, host);
                control.onFieldChanged?.Invoke(field, before);
            }
            catch (Exception ex)
            {
                GonogoLog.Warn("a part field write threw", ex);
                return PartActionFault.AfterThrow(
                    part.vessel != vessel, ThirdPartyFault.Describe("that part's field", ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// Writes the field on every symmetry counterpart the way the game's own
        /// window does: the counterpart's module at the same position when it is
        /// the same type, else the module of the same class name, then the
        /// counterpart control's symmetry callback. Returns whether any counterpart
        /// held a different value.
        /// </summary>
        private static bool WriteSymmetryCounterparts(Part part, PartModule? module, BaseField field, object converted)
        {
            var changed = false;
            var counterparts = part.symmetryCounterparts;
            if (counterparts == null)
            {
                return false;
            }

            var index = module == null ? -1 : part.Modules.IndexOf(module);
            foreach (var other in counterparts)
            {
                if (other == null)
                {
                    continue;
                }

                BaseFieldList? fields;
                if (module == null)
                {
                    fields = other.Fields;
                }
                else
                {
                    PartModule? twin = null;
                    if (index >= 0 && index < other.Modules.Count && other.Modules[index] != null
                        && other.Modules[index].GetType() == module.GetType())
                    {
                        twin = other.Modules[index];
                    }
                    twin ??= other.Modules[module.ClassName];
                    fields = twin?.Fields;
                }

                if (fields == null || fields[field.name] == null)
                {
                    continue;
                }

                changed |= !Equals(fields.GetValue(field.name), converted);
                fields.SetValue(field.name, converted);
                fields[field.name].uiControlFlight?.onSymmetryFieldChanged?.Invoke(field, converted);
            }

            return changed;
        }

        private static BaseField? FindModuleField(Part part, string moduleName, string fieldName, out PartModule? module)
        {
            module = null;
            if (part.Modules == null)
            {
                return null;
            }

            foreach (PartModule candidate in part.Modules)
            {
                if (candidate == null || (candidate.moduleName != moduleName && candidate.ClassName != moduleName))
                {
                    continue;
                }

                module ??= candidate;
                var found = candidate.Fields?[fieldName];
                if (found != null)
                {
                    module = candidate;
                    return found;
                }
            }

            return null;
        }

        /// <summary>
        /// The value in the type the field holds, or a refusal when the field's
        /// control cannot take it. A control of a kind this does not know is refused
        /// rather than written through unchecked.
        /// </summary>
        private static object ConvertForControl(BaseField field, UI_Control control, double value, out CommandResult? refusal)
        {
            refusal = null;
            var type = field.FieldInfo?.FieldType ?? (field.MemberInfo as System.Reflection.PropertyInfo)?.PropertyType;

            switch (control)
            {
                case UI_Toggle _:
                    if (type != typeof(bool) || (value != 0d && value != 1d))
                    {
                        refusal = CommandResult.Fail(CommandErrorCode.Range, "a switch takes 1 for on or 0 for off");
                        return value;
                    }
                    return value == 1d;

                case UI_FloatRange range:
                    return NumberInRange(type, value, range.minValue, range.maxValue, out refusal);

                case UI_FloatEdit edit:
                    return NumberInRange(type, value, edit.minValue, edit.maxValue, out refusal);

                case UI_ChooseOption choose:
                    return OptionAt(type, value, choose.options, out refusal);

                case UI_Cycle cycle:
                    return OptionAt(type, value, cycle.stateNames, out refusal);

                default:
                    refusal = CommandResult.Fail(CommandErrorCode.CapabilityMismatch, "that field has no control that takes a value");
                    return value;
            }
        }

        private static object NumberInRange(Type? type, double value, double min, double max, out CommandResult? refusal)
        {
            refusal = null;
            if (value < min || value > max)
            {
                refusal = CommandResult.Fail(CommandErrorCode.Range, "that value is outside the range the field takes");
                return value;
            }

            if (type == typeof(float)) return (float)value;
            if (type == typeof(double)) return value;
            if (type == typeof(int)) return (int)Math.Round(value);

            refusal = CommandResult.Fail(CommandErrorCode.CapabilityMismatch, "that field is not a number");
            return value;
        }

        private static object OptionAt(Type? type, double value, string[]? options, out CommandResult? refusal)
        {
            refusal = null;
            var position = (int)Math.Round(value);
            if (options == null || position != value || position < 0 || position >= options.Length)
            {
                refusal = CommandResult.Fail(CommandErrorCode.Range, "that list has no entry at that position");
                return value;
            }

            if (type == typeof(string)) return options[position];
            if (type == typeof(int)) return position;

            refusal = CommandResult.Fail(CommandErrorCode.CapabilityMismatch, "that field does not take a list position");
            return value;
        }

        /// <summary>
        /// Maps every <c>guiActive</c> event on one <see cref="BaseEventList"/>
        /// into <paramref name="into"/>. <paramref name="moduleName"/> is null for
        /// the part's own list, which is what
        /// <see cref="PartActionEntry.ModuleName"/> reports.
        /// </summary>
        private static void Collect(BaseEventList? events, string? moduleName, int? moduleIndex, List<PartActionEntry> into)
        {
            if (events == null)
            {
                return;
            }

            foreach (BaseEvent ev in events)
            {
                if (ev == null || !ev.guiActive)
                {
                    continue;
                }

                // A row whose label carries no words (a lone "-") is a spacer in
                // the game's window and has nothing to press or read.
                // The game draws a button with no label as its event name, and so does this.
                var label = string.IsNullOrWhiteSpace(ev.guiName)
                    ? PartActionText.Clean(ev.name)
                    : PartActionText.Clean(ev.guiName);
                if (label == null)
                {
                    continue;
                }

                into.Add(new PartActionEntry
                {
                    Name = ev.name ?? "",
                    Label = label,
                    // displayName is the player-facing group header; group.name is
                    // the code id, used only when a group carries no display name.
                    Group = GroupName(ev.group),
                    ModuleName = moduleName,
                    ModuleIndex = moduleIndex,
                    // A variant-disabled event (a part variant that removes the
                    // feature) is inert exactly like !active, so it reports as
                    // not-active rather than as a separate flag the client would
                    // have to know to combine.
                    Active = ev.active && !ev.EventIsDisabledByVariant,
                    GuiActiveUnfocused = ev.guiActiveUnfocused,
                    AdvancedTweakable = ev.advancedTweakable,
                    RequireFullControl = ev.requireFullControl,
                });
            }
        }

        private static string? GroupName(BasePAWGroup? group)
        {
            if (group == null)
            {
                return null;
            }
            return PartWindowText.Group(PartActionText.Clean, group.displayName, group.name);
        }

        /// <summary>
        /// Finds one event by <c>BaseEvent.name</c> across the same union
        /// <see cref="List"/> reports, so anything a client was told about is
        /// invokable. Deliberately does not filter on <c>guiActive</c>: an event
        /// that has since left the window is reported as
        /// <see cref="CommandErrorCode.ModeUnavailable"/> by the caller, which is
        /// more useful than the NotFound-shaped answer a filtered lookup would
        /// give.
        /// </summary>
        private static BaseEvent? FindEvent(Part part, string eventName, int? moduleIndex, out string? moduleName)
        {
            moduleName = null;
            var own = moduleIndex == null ? FindIn(part.Events, eventName) : null;
            if (own != null)
            {
                return own;
            }

            if (part.Modules == null)
            {
                return null;
            }

            for (var i = 0; i < part.Modules.Count; i++)
            {
                var module = part.Modules[i];
                if (module == null || (moduleIndex != null && moduleIndex != i))
                {
                    continue;
                }
                var found = FindIn(module.Events, eventName);
                if (found != null)
                {
                    moduleName = module.moduleName;
                    return found;
                }
            }

            return null;
        }

        private static BaseEvent? FindIn(BaseEventList? events, string eventName)
        {
            if (events == null)
            {
                return null;
            }

            foreach (BaseEvent ev in events)
            {
                if (ev != null && ev.name == eventName)
                {
                    return ev;
                }
            }

            return null;
        }

        /// <summary>
        /// Same resolution (and the same uninitialized-flightID guard) as
        /// <c>KspRoboticsActuator.FindPart</c>: <c>flightID</c> is 0 until the part
        /// loads into flight, so the sentinel is skipped rather than matched
        /// against the string <c>"0"</c>.
        /// </summary>
        private static int CountParts(Vessel vessel, string partId)
        {
            var count = 0;
            foreach (var part in vessel.parts)
            {
                if (part != null && part.flightID != 0 && part.flightID.ToString() == partId)
                {
                    count++;
                }
            }
            return count;
        }

        private static Part? FindPart(Vessel vessel, string partId)
        {
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                if (part.flightID != 0 && part.flightID.ToString() == partId)
                {
                    return part;
                }
            }
            return null;
        }
    }
}
