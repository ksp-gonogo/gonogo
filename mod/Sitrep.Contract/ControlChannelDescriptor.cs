using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

namespace Sitrep.Contract
{
    /// <summary>
    /// The contract's control-channel knowledge, as data, derived by reflection:
    /// which write command carries a value, and which wire key that value sits
    /// under in its args. A sibling of <see cref="UnitDescriptor"/>, and like it
    /// reflected at runtime from the declarations rather than embedded, so it
    /// cannot drift from them.
    ///
    /// <para><b>What it is for.</b> A pending uplink says a command is in
    /// flight; without this it cannot say WHAT the command asked for, because
    /// the args arrive as a decoded bag keyed by wire name and nothing on the
    /// server knows which key of that bag is the value. That is the difference
    /// between rendering "a SAS command is in flight" and rendering the mode it
    /// asked for, and the second is what a command-echo expectation needs.</para>
    /// <internal>
    /// <c>RtConfig.EmitChannelMap</c> reflects over the same attribute to generate
    /// the TypeScript table, but <c>RtConfig</c> references Reinforced.Typings, a
    /// codegen-time dependency the shipped mod does not carry, so it cannot be
    /// touched at runtime. Nothing in this file references anything outside the
    /// contract assembly and the BCL.
    /// </internal>
    /// </summary>
    /// <category>Commands</category>
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
        /// <param name="assembly">The assembly to read declarations from; this contract assembly when null.</param>
        /// <returns>Write command name to its camel-cased value key.</returns>
        public static IReadOnlyDictionary<string, string> ValueKeyByCommand(Assembly assembly = null)
        {
            var target = assembly ?? typeof(ControlChannelDescriptor).Assembly;
            var found = new Dictionary<string, string>(StringComparer.Ordinal);
            var ambiguous = new HashSet<string>(StringComparer.Ordinal);

            foreach (var type in SafeTypes(target))
            {
                foreach (var property in SafeProperties(type))
                {
                    var attr = SafeControlChannelAttribute(property);
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
        ///
        /// <para>A bool comes back as 1 or 0 and an enum as its ordinal, which is
        /// what they already are on the wire: the channel's own declared args type
        /// says how to read the number back. A string or a nested object yields
        /// null rather than a parse attempt, because a channel's value field is
        /// always a scalar, so anything else means the args did not come from the
        /// channel they claim.</para>
        /// </summary>
        /// <param name="args">The decoded args bag, an <c>IDictionary&lt;string, object&gt;</c> keyed by wire name.</param>
        /// <param name="valueKey">The camel-cased key, as <see cref="ValueKeyByCommand"/> returns it.</param>
        /// <returns>The value as a double, or null.</returns>
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
        /// This type's public instance properties, or none if the type will not
        /// yield them. The <see cref="SafeTypes"/> argument one level down: a
        /// type that survived assembly-level enumeration can still fail when
        /// its own members are materialised.
        /// </summary>
        private static IEnumerable<PropertyInfo> SafeProperties(Type type)
        {
            try
            {
                return type.GetProperties(BindingFlags.Public | BindingFlags.Instance);
            }
            catch (Exception ex) when (IsAssemblyResolutionFailure(ex))
            {
                return Array.Empty<PropertyInfo>();
            }
        }

        /// <summary>
        /// This property's control-channel attribute, or null if its attributes
        /// cannot be materialised at all.
        /// </summary>
        ///
        /// <remarks>
        /// Asking for ONE attribute type still makes the runtime build the
        /// property's whole attribute list, so it must resolve every attribute
        /// assembly present on that property, not just the one asked for. The
        /// contract's netstandard2.0 build carries Reinforced.Typings'
        /// <c>[TsProperty]</c>, and that package is deliberately compile-time
        /// only (<c>PrivateAssets="all"</c> with no <c>runtime</c>, because a
        /// deployed net472 assembly carrying RT attributes would make Kopernicus
        /// fail to resolve them at startup). So on any runtime consumer of the
        /// netstandard2.0 build this throws <c>FileNotFoundException</c> for an
        /// assembly that is correctly absent.
        ///
        /// <para>Unguarded, that throw escapes through this method's only caller
        /// into the middle of an object initializer and aborts the whole dispatch,
        /// so a delayed command is never enqueued AND never sent. Skipping the
        /// property is right rather than merely safe: a property whose attributes
        /// will not load cannot be declaring a control channel that could be
        /// acted on.</para>
        /// </remarks>
        private static SitrepControlChannelAttribute SafeControlChannelAttribute(PropertyInfo property)
        {
            try
            {
                return property.GetCustomAttribute<SitrepControlChannelAttribute>();
            }
            catch (Exception ex) when (IsAssemblyResolutionFailure(ex))
            {
                return null;
            }
        }

        /// <summary>
        /// The load failures worth swallowing: an assembly or type that cannot
        /// be found or loaded. Named rather than a bare <c>catch</c> so a real
        /// defect in an attribute's own constructor still surfaces.
        /// </summary>
        private static bool IsAssemblyResolutionFailure(Exception ex) =>
            ex is FileNotFoundException
            || ex is FileLoadException
            || ex is TypeLoadException
            || ex is BadImageFormatException;

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
