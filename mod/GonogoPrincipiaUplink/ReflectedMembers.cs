using System;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads members off a third-party object by name, with the cache and the
    /// tolerance every reader here needs, and with the ONE rule that keeps this
    /// safe enforced rather than documented.
    ///
    /// <para><b>The rule: a field read is safe, a CALL is safe only if its body
    /// has been read.</b> The looser version, "managed and parameterless is safe,
    /// the native ABI is the danger", was measured and is false.
    /// <c>ReferenceFrameSelector</c> holds no native handle at all and three of its
    /// parameterless methods still reach <c>Log.Fatal</c> through their own default
    /// branches, and <c>Log.Fatal</c> aborts the process. So a getter-shaped
    /// managed call on a class that cannot reach native code can still take KSP
    /// down, and "it looked harmless" is not a safety argument.</para>
    ///
    /// <para>Hence <see cref="InvocableMembers"/>. <see cref="Invoke"/> refuses any
    /// name not on that list, so adding a call means adding a name here, and the
    /// comment beside it is where the audit is recorded. Enforcing it at runtime
    /// rather than in review is deliberate: the dangerous version is the one that
    /// looks like every other read, so a reviewer has nothing to notice.</para>
    /// </summary>
    public sealed class ReflectedMembers
    {
        /// <summary>
        /// Every method this assembly is allowed to invoke on a third-party object,
        /// each one having had its decompiled body read.
        ///
        /// <list type="bullet">
        /// <item><c>Δv</c> on the burn editor: three slider-value reads and a
        /// <c>Vector3d.magnitude</c>. No plugin call, no throw.</item>
        /// <item><c>ok</c> on the integrator's status struct: the integrator's own
        /// definition of a healthy status, preferred over assuming that error code
        /// zero means OK.</item>
        /// </list>
        ///
        /// <para>Notable REFUSALS, all reachable and all innocuous-looking:
        /// <c>FrameParameters</c>, <c>Name</c>, <c>NavballName</c> and
        /// <c>Abbreviation</c> on the frame selector (each reaches
        /// <c>Log.Fatal</c>), and <c>time_base</c> on the burn editor (a property,
        /// but it calls into the plugin with a guid). Everything those would have
        /// given us is derived from plain fields instead.</para>
        /// </summary>
        public static readonly string[] InvocableMembers = { "Δv", "ok" };

        private const BindingFlags AnyInstance =
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        private readonly Dictionary<string, MemberInfo?> _members = new Dictionary<string, MemberInfo?>();

        /// <summary>
        /// The named field's or property's value, or null when it cannot be read.
        ///
        /// <para>Tolerant per-read on purpose: a version of the integrator that
        /// renamed one member should cost that one value, not the whole
        /// observation. A getter that throws is the integrator's business.</para>
        /// </summary>
        public object? Value(object target, string name)
        {
            var member = Member(target.GetType(), name);
            try
            {
                return member switch
                {
                    FieldInfo field => field.GetValue(target),
                    PropertyInfo property => property.GetValue(target, null),
                    _ => null,
                };
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Calls a parameterless method from <see cref="InvocableMembers"/> and
        /// returns its result, or null.
        ///
        /// <para>A name not on that list throws, and the throw is the point: this
        /// is a compile-time-invisible mistake with a process-abort consequence, so
        /// it fails loudly in the first test that reaches it rather than quietly in
        /// front of an operator.</para>
        /// </summary>
        public object? Invoke(object target, string name)
        {
            if (Array.IndexOf(InvocableMembers, name) < 0)
            {
                throw new InvalidOperationException(
                    "Refusing to invoke '" + name + "' on a third-party object. A call is only " +
                    "permitted once its decompiled body has been read: parameterless managed " +
                    "methods here reach Log.Fatal, which aborts the process. Read the body, then " +
                    "add the name to ReflectedMembers.InvocableMembers with what you found.");
            }
            var method = Member(target.GetType(), name) as MethodInfo;
            if (method == null || method.GetParameters().Length != 0)
            {
                return null;
            }
            try
            {
                return method.Invoke(target, null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        public double? ReadDouble(object target, string name) => AsDouble(Value(target, name));

        public double? InvokeDouble(object target, string name) => AsDouble(Invoke(target, name));

        public bool? ReadBool(object target, string name) => Value(target, name) as bool?;

        public bool? InvokeBool(object target, string name) => Invoke(target, name) as bool?;

        /// <summary>An <c>int?</c> on the far side arrives boxed as an <c>int</c>
        /// when it has a value and as null when it does not, so one cast covers both
        /// a nullable field and a plain one.</summary>
        public int? ReadInt(object target, string name) => Value(target, name) as int?;

        public string? ReadString(object target, string name) =>
            Value(target, name) as string;

        /// <summary>
        /// The count of a collection-valued member, or null.
        ///
        /// <para>Read as a count rather than as its contents: how many frames hide
        /// their unpinned markers is the operator-facing fact, and enumerating the
        /// set would mean naming its element type, which is one of the producer's.</para>
        ///
        /// <para>Counted through the member's own <c>Count</c> and only then by
        /// enumeration. The obvious version, a cast to the non-generic
        /// <c>System.Collections.ICollection</c>, compiles and silently answers null
        /// for the exact types this is aimed at: <c>HashSet&lt;T&gt;</c> implements
        /// <c>ICollection&lt;T&gt;</c> and <c>IReadOnlyCollection&lt;T&gt;</c> and NOT
        /// the legacy interface. Both of the producer's fields here are
        /// <c>HashSet</c>s, so that version would have reported "unknown" in
        /// production for a value it could read perfectly well, and a fixture is the
        /// only thing that would ever have said so.</para>
        /// </summary>
        public int? ReadCount(object target, string name)
        {
            var value = Value(target, name);
            if (value == null)
            {
                return null;
            }
            if (Value(value, "Count") is int count)
            {
                return count;
            }
            if (value is System.Collections.IEnumerable items)
            {
                var n = 0;
                foreach (var _ in items)
                {
                    n++;
                }
                return n;
            }
            return null;
        }

        public static double? AsDouble(object? value) =>
            value switch
            {
                double d => double.IsNaN(d) || double.IsInfinity(d) ? null : d,
                float f => float.IsNaN(f) || float.IsInfinity(f) ? null : f,
                long l => l,
                int i => i,
                _ => null,
            };

        /// <summary>
        /// The named field, property or method on <paramref name="type"/> or any of
        /// its bases, cached including the misses.
        ///
        /// <para>Walks the base chain by hand because <c>BindingFlags.NonPublic</c>
        /// does not inherit: a private field declared on a base class is invisible
        /// to a <c>GetField</c> on the derived type, and these hierarchies have
        /// several layers. Caching the misses matters as much as the hits, since a
        /// renamed member would otherwise re-walk the whole chain on every read, and
        /// some of these run per frame.</para>
        /// </summary>
        private MemberInfo? Member(Type type, string name)
        {
            var key = type.FullName + "." + name;
            if (_members.TryGetValue(key, out var cached))
            {
                return cached;
            }
            MemberInfo? found = null;
            for (var t = type; t != null && found == null; t = t.BaseType)
            {
                found = (MemberInfo?)t.GetField(name, AnyInstance)
                    ?? (MemberInfo?)t.GetProperty(name, AnyInstance)
                    ?? t.GetMethod(name, AnyInstance);
            }
            _members[key] = found;
            return found;
        }
    }
}
