using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Gonogo.ActionGroupsExtendedUplink
{
    /// <summary>
    /// The arm's-length REFLECTION surface onto Action Groups Extended (AGX)
    /// (docs/superpowers/specs/2026-07-17-agx-backend-design.md §3/§5.2). NO
    /// compile-time reference to AGExt's assembly exists anywhere in this
    /// project — every AGExt member is reached by runtime reflection against
    /// the loaded <c>AGExt</c> assembly, so the GPL3 boundary is never
    /// crossed: we USE the running mod's public API, we don't INCORPORATE
    /// its code.
    ///
    /// <para>Surface (source-verified against <c>linuxgurugamer/AGExt</c>
    /// <c>AGExt/External.cs</c>, namespace <c>ActionGroupsExtended</c>, class
    /// <c>AGExtExternal</c>, all members <c>public static</c>): the
    /// active-vessel variants only — <c>AGXListOfAssignedGroups()</c>,
    /// <c>AGXGroupState(int)</c>, <c>AGXActivateGroup(int, bool)</c>, plus
    /// the optional <c>AGXInstalled()</c> capability check. Deliberately NOT
    /// the <c>*DelayCheck</c> variants (gonogo owns its own delay authority)
    /// nor the <c>AGX2Vsl*</c>/<c>AGXAllActions</c> forms (would need a
    /// flightID or would force reflecting the <c>AGXAction</c> type across
    /// the boundary). Only <c>int</c>/<c>string</c>/<c>bool</c> ever cross.</para>
    ///
    /// <para>Fail-soft throughout: a missing type/member (an AGX version
    /// whose surface moved) degrades to <c>null</c>/typed-false rather than
    /// throwing.</para>
    ///
    /// <para><b>Runtime binding is UNVERIFIED pending live validation</b> —
    /// no <c>AGExt.dll</c> is on the reference path in CI/dev today, so this
    /// surface is verified from AGExt's GPL3 source but the actual shipped
    /// assembly's name/method binding is ASSUMED until the Deck
    /// live-validation task runs (same posture as
    /// <c>GonogoRealAntennasUplink.RaReflection</c>).</para>
    /// </summary>
    public sealed class AgxReflection : IAgxApi
    {
        public const string AgxAssemblyName = "AGExt";
        private const string AgxExternalTypeName = "ActionGroupsExtended.AGExtExternal";

        private readonly MethodInfo? _listOfAssignedGroups;
        private readonly MethodInfo? _groupState;
        private readonly MethodInfo? _activateGroup;
        private readonly MethodInfo? _installed;

        private AgxReflection(
            MethodInfo? listOfAssignedGroups,
            MethodInfo? groupState,
            MethodInfo? activateGroup,
            MethodInfo? installed)
        {
            _listOfAssignedGroups = listOfAssignedGroups;
            _groupState = groupState;
            _activateGroup = activateGroup;
            _installed = installed;
        }

        /// <summary>
        /// Whether AGExt's assembly is loaded and its full surface resolved
        /// — the election gate. A NOT-available instance (this is null-safe
        /// on every read/write member below) rather than a null
        /// <see cref="AgxReflection"/> reference: <see cref="Probe"/> always
        /// returns an instance, never null.
        /// </summary>
        public bool IsAvailable =>
            _listOfAssignedGroups != null && _groupState != null && _activateGroup != null;

        /// <summary>
        /// Probe for the loaded AGExt assembly and resolve its external
        /// static surface. ALWAYS returns a non-null instance — when AGExt
        /// is not installed/loaded (or any part of the probe throws), the
        /// returned instance simply reports <see cref="IsAvailable"/> false
        /// and every read/write member fail-softs to null/false, so the
        /// caller never registers the AGX action-groups provider and stock
        /// stays elected.
        /// </summary>
        public static AgxReflection Probe()
        {
            try
            {
                var asm = AppDomain.CurrentDomain
                    .GetAssemblies()
                    .FirstOrDefault(a => string.Equals(
                        a.GetName().Name, AgxAssemblyName, StringComparison.OrdinalIgnoreCase));
                var type = asm?.GetType(AgxExternalTypeName, throwOnError: false);
                if (type == null)
                {
                    return new AgxReflection(null, null, null, null);
                }

                var list = type.GetMethod("AGXListOfAssignedGroups", BindingFlags.Public | BindingFlags.Static);
                var state = type.GetMethod("AGXGroupState", BindingFlags.Public | BindingFlags.Static);
                var activate = type.GetMethod("AGXActivateGroup", BindingFlags.Public | BindingFlags.Static);
                var installed = type.GetMethod("AGXInstalled", BindingFlags.Public | BindingFlags.Static);
                return new AgxReflection(list, state, activate, installed);
            }
            catch (Exception)
            {
                return new AgxReflection(null, null, null, null);
            }
        }

        /// <summary>
        /// Index -&gt; (name, state) for every group AGExt reports assigned
        /// on the active vessel (the active-vessel form scopes internally —
        /// we never touch FlightGlobals ourselves). Null on "no data this
        /// tick" / read failure — never a fabricated empty list.
        /// </summary>
        public IReadOnlyList<AgxGroup>? AssignedGroups()
        {
            if (_listOfAssignedGroups == null || _groupState == null)
            {
                return null;
            }
            try
            {
                if (_listOfAssignedGroups.Invoke(null, null) is not IDictionary raw)
                {
                    return null;
                }

                var result = new List<AgxGroup>(raw.Count);
                foreach (DictionaryEntry entry in raw)
                {
                    if (entry.Key is not int index)
                    {
                        continue;
                    }
                    var name = entry.Value as string;
                    var state = _groupState.Invoke(null, new object[] { index }) is true;
                    result.Add(new AgxGroup(index, name, state));
                }
                return result;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Sets one group by AGExt's own 1-based index. Returns AGExt's own success bool, or false on any failure.</summary>
        public bool Activate(int index, bool on)
        {
            if (_activateGroup == null)
            {
                return false;
            }
            try
            {
                return _activateGroup.Invoke(null, new object[] { index, on }) is true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
