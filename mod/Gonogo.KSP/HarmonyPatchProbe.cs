using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;

namespace Gonogo.KSP
{
    /// <summary>
    /// Whether another mod has patched a stock method through Harmony, asked
    /// without referencing Harmony.
    ///
    /// <para>For code that reproduces a stock method's body instead of calling
    /// it. A prefix, postfix or transpiler on the original runs only when the
    /// original is called, so a reproduction silently skips every one of them:
    /// the patching mod's half of the procedure never happens while stock's half
    /// does.</para>
    ///
    /// <para>Reflection rather than a reference because Harmony is somebody
    /// else's optional install. Everything is found by name, so every member is
    /// checked against the installed <c>0Harmony.dll</c> by
    /// <c>HarmonyPatchProbeMirrorTests</c>, and a member that does not resolve
    /// is <see cref="PatchState.Unknown"/>, never
    /// <see cref="PatchState.Unpatched"/>: a probe that cannot look must not
    /// report that it looked and found nothing.</para>
    /// </summary>
    internal static class HarmonyPatchProbe
    {
        internal const string HarmonyTypeName = "HarmonyLib.Harmony";

        /// <summary>The four collections on <c>HarmonyLib.Patches</c>, any of which makes a method patched.</summary>
        internal static readonly string[] PatchCollections = { "Prefixes", "Postfixes", "Transpilers", "Finalizers" };

        internal const string OwnersProperty = "Owners";

        internal enum PatchState
        {
            Unpatched,
            Patched,

            /// <summary>Harmony is loaded and could not be asked.</summary>
            Unknown,
        }

        internal readonly struct Reading
        {
            public PatchState State { get; }

            /// <summary>The Harmony ids that own a patch, for naming them to an operator. Empty unless patched.</summary>
            public IReadOnlyList<string> Owners { get; }

            public Reading(PatchState state, IReadOnlyList<string> owners)
            {
                State = state;
                Owners = owners;
            }

            public static Reading Unpatched => new Reading(PatchState.Unpatched, Array.Empty<string>());

            public static Reading Unknown => new Reading(PatchState.Unknown, Array.Empty<string>());
        }

        /// <summary>
        /// Every Harmony 2 install in this process, asked about
        /// <paramref name="original"/>.
        ///
        /// <para>No Harmony loaded means nothing patched THROUGH HARMONY. This
        /// reads Harmony's own registry and nothing else, so a mod that detours a
        /// method by some other means is invisible to it.</para>
        /// </summary>
        public static Reading Of(MethodBase original)
        {
            Type? harmony;
            try
            {
                harmony = FindHarmony();
            }
            catch (Exception)
            {
                return Reading.Unknown;
            }

            return Of(original, harmony);
        }

        /// <summary>
        /// <paramref name="original"/> asked of <paramref name="harmony"/>, the
        /// loaded <c>HarmonyLib.Harmony</c> type or null for none.
        ///
        /// <para>A registry that throws is <see cref="PatchState.Unknown"/>.
        /// Harmony's first call initialises MonoMod's detour platform, which can
        /// fail on a runtime it does not support; that says nothing about
        /// whether anything is patched.</para>
        /// </summary>
        internal static Reading Of(MethodBase original, Type? harmony)
        {
            if (harmony == null) return Reading.Unpatched;

            var getPatchInfo = ResolveGetPatchInfo(harmony);
            if (getPatchInfo == null) return Reading.Unknown;

            object? patches;
            try
            {
                patches = getPatchInfo.Invoke(null, new object[] { original });
            }
            catch (Exception)
            {
                return Reading.Unknown;
            }

            return Read(patches);
        }

        /// <summary>
        /// The Harmony type once found. Only a hit is kept: Harmony loads before
        /// any mod can patch through it, but a miss is cheap to repeat and caching
        /// one would hide a Harmony loaded after the first ask.
        /// </summary>
        private static Type? _harmony;

        private static Type? FindHarmony()
        {
            if (_harmony != null) return _harmony;

            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                var type = assembly.GetType(HarmonyTypeName, throwOnError: false);
                if (type != null) return _harmony = type;
            }

            return null;
        }

        /// <summary>
        /// Several methods asked as one: <see cref="PatchState.Unknown"/> if any
        /// could not be asked, otherwise <see cref="PatchState.Patched"/> if any
        /// is, naming every owner once.
        /// </summary>
        internal static Reading Combine(params Reading[] readings)
        {
            var owners = new List<string>();
            var patched = false;
            foreach (var reading in readings)
            {
                if (reading.State == PatchState.Unknown) return Reading.Unknown;
                if (reading.State != PatchState.Patched) continue;

                patched = true;
                foreach (var owner in reading.Owners)
                {
                    if (!owners.Contains(owner)) owners.Add(owner);
                }
            }

            return patched ? new Reading(PatchState.Patched, owners) : Reading.Unpatched;
        }

        /// <summary><c>public static Patches GetPatchInfo(MethodBase)</c>, or null.</summary>
        internal static MethodInfo? ResolveGetPatchInfo(Type harmony)
        {
            try
            {
                return harmony.GetMethod(
                    "GetPatchInfo",
                    BindingFlags.Public | BindingFlags.Static,
                    binder: null,
                    types: new[] { typeof(MethodBase) },
                    modifiers: null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// A <c>HarmonyLib.Patches</c>, or the null <c>GetPatchInfo</c> returns
        /// for a method nobody has patched.
        /// </summary>
        internal static Reading Read(object? patches)
        {
            if (patches == null) return Reading.Unpatched;

            try
            {
                var type = patches.GetType();
                var patched = false;
                foreach (var name in PatchCollections)
                {
                    if (!(Member(type, name, patches) is ICollection collection))
                    {
                        return Reading.Unknown;
                    }

                    if (collection.Count > 0) patched = true;
                }

                if (!patched) return Reading.Unpatched;

                var owners = new List<string>();
                if (Member(type, OwnersProperty, patches) is IEnumerable ids)
                {
                    foreach (var id in ids)
                    {
                        if (id is string s && !owners.Contains(s)) owners.Add(s);
                    }
                }

                return new Reading(PatchState.Patched, owners);
            }
            catch (Exception)
            {
                return Reading.Unknown;
            }
        }

        /// <summary>
        /// A public field or property of that name. <c>Patches</c> declares its
        /// four collections as readonly fields and <c>Owners</c> as a property.
        /// </summary>
        private static object? Member(Type type, string name, object instance)
        {
            var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
            if (field != null) return field.GetValue(instance);

            return type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(instance);
        }
    }
}
