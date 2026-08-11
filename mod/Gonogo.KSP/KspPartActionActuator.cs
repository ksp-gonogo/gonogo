using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IPartActionActuator"/>: reads and fires the buttons of
    /// a part's right-click Part Action Window. Resolves the target part by
    /// <c>flightID.ToString()</c> across <c>FlightGlobals.ActiveVessel.parts</c>
    /// (the same join key the read side stamps on <c>vessel.parts</c>), exactly
    /// as <see cref="KspRoboticsActuator"/> does, then walks or invokes
    /// <see cref="BaseEvent"/>s.
    ///
    /// <para><b>The PAW is the UNION of two event lists.</b> A part's buttons come
    /// from <c>part.Events</c> AND from every <c>part.Modules[i].Events</c>, and
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
    /// flight PAW at all". The enabled flag (<c>active</c>) is CARRIED rather than
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
        public IReadOnlyList<PartActionEntry> List(string partId)
        {
            var entries = new List<PartActionEntry>();

            var vessel = FlightGlobals.ActiveVessel;
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
            Collect(part.Events, moduleName: null, entries);

            if (part.Modules != null)
            {
                foreach (PartModule module in part.Modules)
                {
                    if (module == null)
                    {
                        continue;
                    }
                    Collect(module.Events, module.moduleName, entries);
                }
            }

            return entries;
        }

        public CommandResult Invoke(string partId, string eventName)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.parts == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var part = FindPart(vessel, partId);
            if (part == null)
            {
                // The part is gone: staged away, undocked into another vessel, or
                // the vessel unloaded. flightID is stable for a part's life on one
                // vessel but not across those events, so this is the expected
                // failure for a client holding a slightly stale id, and it must
                // read as a clean failure rather than a silent no-op.
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var found = FindEvent(part, eventName);
            if (found == null)
            {
                // The part is there but exposes no such button (a mode change
                // retired it, or the client's list is stale). Distinct from
                // NotFound on purpose: "wrong action" is a different fix from
                // "wrong part".
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            if (!found.active || found.EventIsDisabledByVariant)
            {
                // Present but inert. Invoking it in-game does nothing, so refusing
                // is more honest than reporting a success that changed nothing.
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            found.Invoke();
            return CommandResult.Ok();
        }

        /// <summary>
        /// Maps every <c>guiActive</c> event on one <see cref="BaseEventList"/>
        /// into <paramref name="into"/>. <paramref name="moduleName"/> is null for
        /// the part's own list, which is what
        /// <see cref="PartActionEntry.ModuleName"/> reports.
        /// </summary>
        private static void Collect(BaseEventList? events, string? moduleName, List<PartActionEntry> into)
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

                into.Add(new PartActionEntry
                {
                    Name = ev.name ?? "",
                    // guiName is the localized label; it falls back to the code
                    // name only so a button is never rendered blank.
                    Label = !string.IsNullOrEmpty(ev.guiName) ? ev.guiName : (ev.name ?? ""),
                    // displayName is the player-facing group header; group.name is
                    // the code id, used only when a group carries no display name.
                    Group = GroupName(ev.group),
                    ModuleName = moduleName,
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
            if (!string.IsNullOrEmpty(group.displayName))
            {
                return group.displayName;
            }
            return !string.IsNullOrEmpty(group.name) ? group.name : null;
        }

        /// <summary>
        /// Finds one event by <c>BaseEvent.name</c> across the same union
        /// <see cref="List"/> reports, so anything a client was told about is
        /// invokable. Deliberately does NOT filter on <c>guiActive</c>: an event
        /// that has since left the window is reported as
        /// <see cref="CommandErrorCode.ModeUnavailable"/> by the caller, which is
        /// more useful than the NotFound-shaped answer a filtered lookup would
        /// give.
        /// </summary>
        private static BaseEvent? FindEvent(Part part, string eventName)
        {
            var own = FindIn(part.Events, eventName);
            if (own != null)
            {
                return own;
            }

            if (part.Modules == null)
            {
                return null;
            }

            foreach (PartModule module in part.Modules)
            {
                if (module == null)
                {
                    continue;
                }
                var found = FindIn(module.Events, eventName);
                if (found != null)
                {
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
