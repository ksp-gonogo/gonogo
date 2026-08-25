using System;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The reflection primitives both halves of this Uplink need: resolving an
    /// RP-1 type by name, reading a static, and reading an instance member.
    /// Null-safe per hop and fail-soft throughout, so a member RP-1 moved
    /// degrades to absent and never takes the Uplink inert.
    /// </summary>
    /// <remarks>
    /// Shared because two readers need the same hops and a second copy of a
    /// null-safe reflection walk is a second place for the safety to be got
    /// slightly wrong. The provenance rules these follow, and the list of RP-1
    /// members deliberately NOT called, are in <see cref="Rp1ScReflection"/>'s
    /// header.
    /// </remarks>
    public static class Rp1Types
    {
        private static readonly Dictionary<string, MemberInfo?> Members = new Dictionary<string, MemberInfo?>();

        /// <summary>
        /// Resolves a type by full name across the loaded assemblies, preferring
        /// RP-1's own if it is identifiable by name. The name scan is a FAST PATH
        /// only: presence is decided by whether the type resolved, never by an
        /// assembly name, because RP-1 historically shipped its construction-time
        /// fork under an assembly called <c>KerbalConstructionTime</c> and a name
        /// match is not evidence the types exist.
        /// </summary>
        public static Type? Find(string fullName)
        {
            Assembly[] assemblies;
            try
            {
                assemblies = AppDomain.CurrentDomain.GetAssemblies();
            }
            catch (Exception)
            {
                return null;
            }

            foreach (var a in assemblies)
            {
                if (!LooksLikeRp1(a))
                {
                    continue;
                }
                var hit = TypeIn(a, fullName);
                if (hit != null)
                {
                    return hit;
                }
            }

            foreach (var a in assemblies)
            {
                var hit = TypeIn(a, fullName);
                if (hit != null)
                {
                    return hit;
                }
            }
            return null;
        }

        private static bool LooksLikeRp1(Assembly assembly)
        {
            try
            {
                var name = assembly.GetName().Name;
                return name != null
                    && (name.StartsWith("RP0", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("RP-1", StringComparison.OrdinalIgnoreCase));
            }
            catch (Exception)
            {
                // an assembly that will not name itself is simply not the fast path
                return false;
            }
        }

        private static Type? TypeIn(Assembly assembly, string fullName)
        {
            try
            {
                return assembly.GetType(fullName);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Reads a static property or field, public or not. Null on anything unreadable.</summary>
        public static object? StaticValue(Type type, string name)
        {
            const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
            try
            {
                var pi = type.GetProperty(name, flags);
                if (pi != null && pi.CanRead)
                {
                    return pi.GetValue(null);
                }
                var fi = type.GetField(name, flags);
                return fi?.GetValue(null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Reads a named property or field off an object's runtime type, walking
        /// the base chain so a protected member declared on a base class resolves
        /// from the concrete subclass. Cached per (type, member).
        /// </summary>
        public static object? Member(object? target, string name)
        {
            if (target == null)
            {
                return null;
            }
            var type = target.GetType();
            var key = type.FullName + "." + name;
            MemberInfo? member;
            lock (Members)
            {
                if (!Members.TryGetValue(key, out member))
                {
                    member = Resolve(type, name);
                    Members[key] = member;
                }
            }
            try
            {
                switch (member)
                {
                    case PropertyInfo pi:
                        return pi.GetValue(target);
                    case FieldInfo fi:
                        return fi.GetValue(target);
                    default:
                        return null;
                }
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>The member as a double, or null when it is absent or not a number.</summary>
        public static double? ReadDouble(object? target, string name) => ToDouble(Member(target, name));

        public static double? ToDouble(object? value)
        {
            switch (value)
            {
                case double d: return d;
                case float f: return f;
                case int i: return i;
                case long l: return l;
                default: return null;
            }
        }

        private static MemberInfo? Resolve(Type type, string name)
        {
            const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;
            for (var t = type; t != null; t = t.BaseType)
            {
                try
                {
                    var pi = t.GetProperty(name, flags);
                    if (pi != null && pi.CanRead)
                    {
                        return pi;
                    }
                    var fi = t.GetField(name, flags);
                    if (fi != null)
                    {
                        return fi;
                    }
                }
                catch (Exception)
                {
                    // keep walking: an unreadable level is not the end of the chain
                }
            }
            return null;
        }
    }
}
