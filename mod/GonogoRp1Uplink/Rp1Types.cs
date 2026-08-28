using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
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

        /// <summary>
        /// Writes a numeric member, converting to whatever width RP-1 declared it
        /// at. False when the member is absent, is not a number, or will not take a
        /// value; never throws.
        /// </summary>
        /// <remarks>
        /// One of the two writes in an otherwise read-only file, and it earns its
        /// place rather than opening a door: <see cref="Rp1DerivedCurrencyWithholder"/>
        /// has to put RP-1's confidence balance back after RP-1 has derived it from
        /// a science credit the currency-delay subsystem is withholding, and both
        /// halves of that balance (<c>confidence</c> and <c>confidenceEarned</c>)
        /// are private doubles with no public setter that can lower them. Reading
        /// them and putting the same numbers back is the narrowest possible write,
        /// and it is still a write, so it lives beside the reads where the same
        /// null-safety and provenance rules apply to it.
        ///
        /// <para>A telemetry READ must never write to the player's save (see
        /// <see cref="Rp1ScReflection"/>'s header). This is not one: it is the
        /// delay model's own correction, and the value it writes is a value RP-1
        /// itself held one event earlier.</para>
        /// </remarks>
        public static bool WriteDouble(object? target, string name, double value)
        {
            if (target == null)
            {
                return false;
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
                    case FieldInfo fi:
                        fi.SetValue(target, Convert.ChangeType(value, fi.FieldType, CultureInfo.InvariantCulture));
                        return true;
                    case PropertyInfo pi when pi.CanWrite:
                        pi.SetValue(target, Convert.ChangeType(value, pi.PropertyType, CultureInfo.InvariantCulture));
                        return true;
                    default:
                        return false;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>The member as a bool, or null when it is absent or not one.</summary>
        public static bool? ReadBool(object? target, string name) => Member(target, name) is bool b ? b : (bool?)null;

        /// <summary>The member as a string, or null when it is absent or not one.</summary>
        public static string? ReadString(object? target, string name) => Member(target, name) as string;

        /// <summary>
        /// The member as a Guid rendered to its string form, or the string it
        /// already was. RP-1 keeps a vehicle's identity as a <c>Guid</c> on the
        /// vehicle and as its <c>ToString()</c> on the operations that reference
        /// it, so one reader has to answer both.
        /// </summary>
        public static string? ReadGuidString(object? target, string name)
        {
            var value = Member(target, name);
            return value is Guid g ? g.ToString() : value as string;
        }

        /// <summary>
        /// An enum member read as its NAME. RP-1's ordinals are its own business
        /// and shift between releases; a name is stable, legible in a bug report,
        /// and is what a client maps.
        /// </summary>
        public static string? ReadEnumName(object? target, string name)
        {
            var value = Member(target, name);
            if (value == null)
            {
                return null;
            }
            try
            {
                var type = value.GetType();
                return type.IsEnum ? Enum.GetName(type, value) : Convert.ToString(value, CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Enumerates one of RP-1's collections. They are
        /// <c>ROUtils.DataTypes.PersistentList&lt;T&gt;</c> from a separate
        /// assembly, so they are walked as a bare <see cref="IEnumerable"/> and
        /// never cast to <c>List&lt;T&gt;</c>: a cast that happens to work today
        /// is one release from throwing.
        /// </summary>
        public static IEnumerable<object> Enumerate(object? collection)
        {
            if (!(collection is IEnumerable e) || collection is string)
            {
                yield break;
            }
            foreach (var item in e)
            {
                if (item != null)
                {
                    yield return item;
                }
            }
        }

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

        /// <summary>
        /// A public instance method by name and arity. Arity rather than the
        /// parameter TYPES because those are RP-1's own and naming them would
        /// need the compile-time reference this assembly deliberately does not
        /// have.
        /// </summary>
        public static MethodInfo? InstanceMethod(object target, string name, int parameterCount)
        {
            try
            {
                return MatchArity(
                    target.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance), name, parameterCount);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// A public instance method by name, arity AND the full name of its first
        /// parameter's type, for the overloads arity alone cannot tell apart.
        ///
        /// <para>The instance twin of <see cref="StaticMethodOn"/>, needed for the
        /// same shape of hazard: RP-1 declares
        /// <c>GetEffectiveEngineersForSalary(LaunchComplex)</c> and
        /// <c>GetEffectiveEngineersForSalary(LCSpaceCenter)</c>, so a
        /// name-and-arity match picks whichever the runtime lists first and would
        /// report a whole CENTRE's payroll against one launch complex.</para>
        /// </summary>
        public static MethodInfo? InstanceMethodOn(object target, string name, string firstParameterTypeFullName, int parameterCount)
        {
            MethodInfo[] candidates;
            try
            {
                candidates = target.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance);
            }
            catch (Exception)
            {
                return null;
            }

            foreach (var m in candidates)
            {
                if (m.Name != name)
                {
                    continue;
                }
                try
                {
                    var parameters = m.GetParameters();
                    if (parameters.Length == parameterCount
                        && parameters.Length > 0
                        && parameters[0].ParameterType.FullName == firstParameterTypeFullName)
                    {
                        return m;
                    }
                }
                catch (Exception)
                {
                    // See StaticMethodOn: one unresolvable overload must not hide
                    // the rest, and reading a parameter type is what loads it.
                }
            }
            return null;
        }

        /// <summary>A public static method by name and arity; see <see cref="InstanceMethod"/> for why arity.</summary>
        public static MethodInfo? StaticMethod(Type type, string name, int parameterCount)
        {
            try
            {
                return MatchArity(type.GetMethods(BindingFlags.Public | BindingFlags.Static), name, parameterCount);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// A public static method by name, arity AND the full name of its first
        /// parameter's type, for the overloads arity alone cannot tell apart.
        ///
        /// <para>Needed because RP-1 declares
        /// <c>ChangeEngineers(LaunchComplex, int)</c> and
        /// <c>ChangeEngineers(LCSpaceCenter, int)</c>, so a name-and-arity match
        /// picks whichever the runtime lists first and would move a CENTRE's
        /// engineer pool when a complex was meant. The type is named as a string
        /// for the same reason everything else here is: this assembly holds no
        /// reference to RP-1 and cannot name the type any other way.</para>
        /// </summary>
        public static MethodInfo? StaticMethodOn(Type type, string name, string firstParameterTypeFullName, int parameterCount)
        {
            MethodInfo[] candidates;
            try
            {
                candidates = type.GetMethods(BindingFlags.Public | BindingFlags.Static);
            }
            catch (Exception)
            {
                return null;
            }

            foreach (var m in candidates)
            {
                if (m.Name != name)
                {
                    continue;
                }
                try
                {
                    var parameters = m.GetParameters();
                    if (parameters.Length == parameterCount
                        && parameters.Length > 0
                        && parameters[0].ParameterType.FullName == firstParameterTypeFullName)
                    {
                        return m;
                    }
                }
                catch (Exception)
                {
                    // One overload whose signature this runtime cannot resolve
                    // must not hide the others. Reading a parameter TYPE loads
                    // that type, so an overload referencing an absent assembly
                    // throws here and only here.
                }
            }
            return null;
        }

        /// <summary>
        /// Writes a named field or settable property, walking the base chain the
        /// same way <see cref="Member"/> reads it. False when the member is
        /// absent, read-only or the write threw, and a false is never treated as
        /// a write that happened.
        /// </summary>
        /// <remarks>
        /// The second of this file's two writers, and it exists for the two RP-1
        /// fields a command has to set that no RP-1 method sets for it:
        /// <c>LaunchComplex.IsRushing</c> and
        /// <c>VesselProject.launchSiteIndex</c>. Uncached, unlike the reads:
        /// a write happens once per operator press, so the lookup cost is not
        /// worth a second cache to keep correct.
        ///
        /// <para>Separate from <see cref="WriteDouble"/> rather than folded into
        /// it, because the two do different work: that one converts a double to
        /// whatever numeric width RP-1 declared the field at, which is the whole
        /// of its job and is meaningless for a bool or an int index. Folding them
        /// would give the numeric conversion a path where it silently does
        /// nothing.</para>
        /// </remarks>
        public static bool WriteMember(object? target, string name, object? value)
        {
            if (target == null)
            {
                return false;
            }
            const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;
            for (var t = target.GetType(); t != null; t = t.BaseType)
            {
                try
                {
                    var pi = t.GetProperty(name, flags);
                    if (pi != null && pi.CanWrite)
                    {
                        pi.SetValue(target, value);
                        return true;
                    }
                    var fi = t.GetField(name, flags);
                    if (fi != null)
                    {
                        fi.SetValue(target, value);
                        return true;
                    }
                }
                catch (Exception)
                {
                    return false;
                }
            }
            return false;
        }

        /// <summary>
        /// A public constructor by arity. Optional parameters COUNT, because
        /// reflection does not apply defaults: RP-1's rollout constructor takes
        /// four with the last defaulted, and an invoke has to pass all four.
        /// </summary>
        public static ConstructorInfo? Constructor(Type type, int parameterCount)
        {
            try
            {
                foreach (var c in type.GetConstructors(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (c.GetParameters().Length == parameterCount)
                    {
                        return c;
                    }
                }
            }
            catch (Exception)
            {
                return null;
            }
            return null;
        }

        /// <summary>
        /// What to quote from a throw. Reflection wraps a handler's own
        /// exception in a <see cref="TargetInvocationException"/> whose message
        /// says only that an exception was thrown, which tells an operator
        /// nothing at all.
        /// </summary>
        public static string ExceptionReason(Exception ex) =>
            (ex is TargetInvocationException tie && tie.InnerException != null ? tie.InnerException : ex).Message;

        /// <summary>
        /// The first method of this name with this arity, skipping any overload
        /// whose signature this runtime cannot resolve.
        /// </summary>
        /// <remarks>
        /// The per-candidate try is not defensive padding. <c>GetParameters</c>
        /// LOADS each parameter's type, so one overload referencing a type from an
        /// absent assembly throws, and an unguarded loop would lose every later
        /// overload with it. RP-1's <c>KCTUtilities</c> is a hundred-method static
        /// class reaching KSP, ROUtils and its own types, which is exactly the
        /// shape where that bites.
        /// </remarks>
        private static MethodInfo? MatchArity(IEnumerable<MethodInfo> methods, string name, int parameterCount)
        {
            foreach (var m in methods)
            {
                if (m.Name != name)
                {
                    continue;
                }
                try
                {
                    if (m.GetParameters().Length == parameterCount)
                    {
                        return m;
                    }
                }
                catch (Exception)
                {
                    // see the remarks: a signature this runtime cannot resolve is
                    // not this overload, and must not cost us the rest
                }
            }
            return null;
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
