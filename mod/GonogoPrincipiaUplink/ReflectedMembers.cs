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

        /// <summary>
        /// Every PROPERTY this assembly is allowed to read, each one having had its
        /// decompiled getter read.
        ///
        /// <para>A property read is a CALL. <see cref="Value"/> resolves a name to
        /// whichever member carries it, so <c>ReadDouble(editor, "time_base")</c> is
        /// a getter invocation that looks exactly like a field read at the call
        /// site, and <c>time_base</c> is the member this class's own summary names
        /// as fatal. The <see cref="InvocableMembers"/> allowlist guarded
        /// <see cref="Invoke"/> and left that path open, which is the same
        /// enforce-rather-than-document argument applied to only one of the two
        /// ways a call can happen.</para>
        ///
        /// <para><c>Count</c> is here because <see cref="ReadCount"/> reads it off a
        /// BCL collection we are already holding, not off a producer type.</para>
        ///
        /// <para>What each getter turned out to be, in the order below. Most are
        /// compiler-generated backing-field reads on auto-properties
        /// (<c>display_patched_conics</c>, <c>frame_type</c>,
        /// <c>frames_that_hide_unpinned_markers</c> and its celestial twin,
        /// <c>selected_celestial</c>, <c>selecting_active_vessel_target</c>,
        /// <c>target</c>, <c>target_frame_selected</c>, <c>flightGlobalsIndex</c>), which cannot run producer code at all. Four
        /// do arithmetic and nothing else: <c>value</c> answers a nullable's
        /// default, <c>history_length</c> forwards to that same slider,
        /// <c>initial_time</c> forwards to a field and <c>final_time</c> adds two.
        /// <c>referenceBody</c> tests one reference and returns either the body's
        /// own parent or itself, so a root body answers itself rather than
        /// null.</para>
        ///
        /// <para><c>predicted_vessel</c> is the one that is not obviously
        /// harmless and it is cleared deliberately. Its getter invokes a delegate
        /// into the producer's addon, which asks the PLUGIN whether the vessel is
        /// one it knows. That is a native call, made outside our own frame
        /// protocol, and it is safe for one specific reason: the call is
        /// <c>HasVessel</c>, the single guid-tolerant entry point on the whole
        /// surface, and it is guarded by a running-plugin test on the line above
        /// it. Nothing else on this list crosses that boundary, and nothing new
        /// should join it without the same paragraph.</para>
        /// </summary>
        public static readonly string[] ReadableProperties =
        {
            "Count",
            "display_patched_conics",
            "final_time",
            "flightGlobalsIndex",
            "frame_type",
            "frames_that_hide_unpinned_celestials",
            "frames_that_hide_unpinned_markers",
            "history_length",
            "initial_time",
            "predicted_vessel",
            "referenceBody",
            "selected_celestial",
            "selecting_active_vessel_target",
            "target",
            "target_frame_selected",
            "value",
        };

        /// <summary>
        /// Properties read in production BEFORE this guard existed, whose getters
        /// have NOT been read.
        ///
        /// <para>Shrink-only. Each name moves to <see cref="ReadableProperties"/>
        /// once its decompiled getter has been read, or out of the codebase if the
        /// value can come from a plain field instead. Nothing is ever added here:
        /// a new property read goes through the audit.</para>
        ///
        /// <para>They are listed separately rather than folded into the audited list
        /// because a list that claims an audit it did not do is the failure this
        /// whole class exists to prevent.</para>
        ///
        /// <para><b>It is now EMPTY, and the settings work is what emptied it.</b>
        /// Eleven of the fifteen names had their getters read and moved to
        /// <see cref="ReadableProperties"/>. The other four never belonged here at
        /// all: <c>bodyName</c>, <c>id</c>, <c>error</c> and <c>message</c> are
        /// plain public fields on their declaring types, so the guard was never
        /// consulted for them and the list was carrying four entries that claimed
        /// a debt that did not exist. Keep it empty.</para>
        /// </summary>
        public static readonly string[] UnauditedProperties = new string[0];

        /// <summary>
        /// Instance AND static, and the static half is a bug fix rather than
        /// breadth for its own sake.
        ///
        /// <para>Several of the producer's settings are static: whether a journal
        /// recorder is actually running, and the two tables its prediction settings
        /// index into. With instance-only flags every one of those resolved to no
        /// member and answered null, which this class's per-read tolerance then
        /// reported as "could not be read" rather than as "was never looked for".
        /// The prediction tolerance and step count were reaching the wire as null
        /// for exactly that reason, on the channel that existed for them, and
        /// nothing failed because a tolerant reader cannot tell a missing member
        /// from a missing value.</para>
        ///
        /// <para>Static widens no permission: a static FIELD read still cannot run
        /// producer code, and a static property still has to be on
        /// <see cref="ReadableProperties"/> like any other.</para>
        /// </summary>
        private const BindingFlags AnyMember =
            BindingFlags.Instance | BindingFlags.Static
            | BindingFlags.Public | BindingFlags.NonPublic;

        private readonly Dictionary<string, MemberInfo?> _members = new Dictionary<string, MemberInfo?>();

        /// <summary>
        /// The named field's or property's value, or null when it cannot be read.
        ///
        /// <para>Tolerant per-read on purpose: a version of the integrator that
        /// renamed one member should cost that one value, not the whole
        /// observation. A getter that throws is the integrator's business.</para>
        ///
        /// <para>Tolerant is not the same as permissive. A field read cannot run
        /// producer code and is always allowed; a PROPERTY read runs a getter and so
        /// goes through <see cref="ReadableProperties"/> on the same terms as
        /// <see cref="Invoke"/>. The catch below does not cover the case that
        /// matters: <c>Log.Fatal</c> aborts the process rather than throwing, so
        /// there is nothing to catch and the guard has to come first.</para>
        /// </summary>
        public object? Value(object target, string name)
        {
            var member = Member(target.GetType(), name);
            if (member is PropertyInfo && !IsReadableProperty(name))
            {
                throw new InvalidOperationException(
                    "Refusing to read property '" + name + "' on a third-party object. Reading a " +
                    "property invokes its getter, which is a call: permitted only once the " +
                    "decompiled body has been read, because getters here reach Log.Fatal, which " +
                    "aborts the process rather than throwing. Read the getter, then add the name " +
                    "to ReflectedMembers.ReadableProperties with what you found.");
            }
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

        private static bool IsReadableProperty(string name) =>
            Array.IndexOf(ReadableProperties, name) >= 0
            || Array.IndexOf(UnauditedProperties, name) >= 0;

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
                found = (MemberInfo?)t.GetField(name, AnyMember)
                    ?? (MemberInfo?)t.GetProperty(name, AnyMember)
                    ?? t.GetMethod(name, AnyMember);
            }
            _members[key] = found;
            return found;
        }
    }
}
