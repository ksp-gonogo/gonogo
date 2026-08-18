using System;
using System.Collections.Generic;
using System.Reflection;

namespace Sitrep.Contract
{
    /// <summary>
    /// The contract's control-channel knowledge, as data, derived by reflection:
    /// which write command carries a value, and which wire key that value sits
    /// under in its args.
    /// </summary>
    ///
    /// <remarks>
    /// <para>Sibling of <see cref="UnitDescriptor"/> and here for the same
    /// reason. <c>RtConfig.EmitChannelMap</c> already reflects over
    /// <see cref="SitrepControlChannelAttribute"/> to generate the TypeScript
    /// table, but <c>RtConfig</c> references Reinforced.Typings, a codegen-time
    /// dependency the shipped mod does not carry: touching it at runtime would
    /// fail to load. Nothing in this file references anything outside the
    /// contract assembly and the BCL, which is exactly the rule the attribute's
    /// own doc states it exists to satisfy ("anything reflecting over it
    /// (codegen, the coverage gate) must never have to resolve an external
    /// assembly").</para>
    ///
    /// <para><b>What it is for.</b> A pending uplink says a command is in
    /// flight; without this it cannot say WHAT the command asked for, because
    /// the args arrive as a decoded bag keyed by wire name and nothing on the
    /// server knows which key of that bag is the value. That is the difference
    /// between rendering "a SAS command is in flight" and rendering the mode it
    /// asked for, and the second is what a command-echo expectation needs.</para>
    ///
    /// <para>Reflected rather than embedded, same argument
    /// <see cref="UnitDescriptor"/> makes: a baked copy of the table would be
    /// free to drift from the attributes it claims to describe the moment
    /// someone declares a channel without re-running codegen.</para>
    /// </remarks>
    public static class ControlChannelDescriptor
    {
        /// <summary>
        /// Write command name to the CAMEL-CASED args key carrying its value,
        /// e.g. <c>"vessel.control.setSas"</c> to <c>"enabled"</c>.
        ///
        /// <para>Camel-cased because that is what crosses the wire
        /// (<c>CamelCaseForProperties</c>), and the decoded args bag is keyed by
        /// wire name. One command may back several channels (six fly-by-wire
        /// axes share <c>setAxes</c>), so a command is only listed when every
        /// channel declaring it agrees on the value key; a disagreement means
        /// the command carries more than one value and no single scalar
        /// describes it, so it is omitted rather than guessed at.</para>
        /// </summary>
        public static IReadOnlyDictionary<string, string> ValueKeyByCommand(Assembly assembly = null)
        {
            var target = assembly ?? typeof(ControlChannelDescriptor).Assembly;
            var found = new Dictionary<string, string>(StringComparer.Ordinal);
            var ambiguous = new HashSet<string>(StringComparer.Ordinal);

            foreach (var type in SafeTypes(target))
            {
                foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    var attr = property.GetCustomAttribute<SitrepControlChannelAttribute>();
                    if (attr == null) continue;

                    var key = UnitDescriptor.CamelCase(attr.ValueField);
                    if (found.TryGetValue(attr.WriteCommand, out var existing))
                    {
                        if (!string.Equals(existing, key, StringComparison.Ordinal))
                        {
                            ambiguous.Add(attr.WriteCommand);
                        }
                    }
                    else
                    {
                        found[attr.WriteCommand] = key;
                    }
                }
            }

            foreach (var command in ambiguous)
            {
                found.Remove(command);
            }

            return found;
        }

        /// <summary>
        /// Pull the scalar a decoded args bag carries under <paramref name="valueKey"/>,
        /// as a double, or null when there is nothing usable there.
        /// </summary>
        ///
        /// <remarks>
        /// A bool comes back as 1 or 0 and an enum as its ordinal, which is what
        /// they already are on the wire: the channel's own declared args type
        /// says how to read the number back, so nothing is lost by carrying one
        /// numeric field rather than a variant. A string or a nested object
        /// yields null rather than a parse attempt: the coverage gate already
        /// requires a channel's value field to be a scalar, so anything else
        /// here means the args did not come from the channel it claims.
        /// </remarks>
        public static double? ScalarFrom(object args, string valueKey)
        {
            if (args == null || string.IsNullOrEmpty(valueKey)) return null;
            if (!(args is IDictionary<string, object> bag)) return null;
            if (!bag.TryGetValue(valueKey, out var raw) || raw == null) return null;

            switch (raw)
            {
                case double d: return d;
                case float f: return f;
                case decimal m: return (double)m;
                case long l: return l;
                case int i: return i;
                case short s: return s;
                case bool b: return b ? 1d : 0d;
                default:
                    return raw is Enum ? Convert.ToDouble(raw) : (double?)null;
            }
        }

        /// <summary>
        /// Reflection over a loaded assembly can partially fail; the same
        /// defensive walk <see cref="UnitDescriptor"/> uses, for the same
        /// reason. A type that will not load contributes no channels rather
        /// than taking the mod down over a descriptor.
        /// </summary>
        private static IEnumerable<Type> SafeTypes(Assembly assembly)
        {
            try
            {
                return assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                var loaded = new List<Type>();
                foreach (var type in ex.Types)
                {
                    if (type != null) loaded.Add(type);
                }
                return loaded;
            }
        }
    }
}
