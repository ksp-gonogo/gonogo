using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Sitrep.Host
{
    /// <summary>
    /// Whether a command call names the arguments its args type declares: no
    /// name the type does not have, and every argument the contract marks as
    /// required present.
    ///
    /// <para>Checked on the wire's generic
    /// object shape only; typed in-process args are already of the declared
    /// type. A reference type from an assembly with no nullable annotations
    /// is optional, since nothing says otherwise.</para>
    /// </summary>
    internal static class CommandArgsShape
    {
        private const string NullableAttributeName = "System.Runtime.CompilerServices.NullableAttribute";
        private const string NullableContextAttributeName = "System.Runtime.CompilerServices.NullableContextAttribute";
        private const byte NotNullAnnotated = 1;

        /// <summary>The name an argument has on the wire.</summary>
        internal static string WireName(PropertyInfo prop) =>
            prop.Name.Length == 0 ? prop.Name : char.ToLowerInvariant(prop.Name[0]) + prop.Name.Substring(1);

        /// <summary>
        /// The sentence that says which argument of <paramref name="command"/>
        /// is unknown or missing, or null when the call's names fit
        /// <paramref name="argsType"/>.
        /// </summary>
        internal static string? Violation(string command, object? args, Type argsType)
        {
            if (args != null && argsType.IsInstanceOfType(args))
            {
                return null;
            }

            var props = Declared(argsType);
            if (props.Count == 0)
            {
                return null;
            }

            var defaults = DefaultInstance(argsType);
            var required = props.Where(p => IsRequired(p, defaults)).ToList();
            if (args == null)
            {
                return required.Count == 0
                    ? null
                    : $"\"{command}\" was sent no arguments but requires {Names(required)}";
            }

            if (!(args is IDictionary<string, object?> dict))
            {
                return null;
            }

            foreach (var key in dict.Keys)
            {
                if (!props.Any(p => string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)))
                {
                    return $"\"{command}\" has no argument \"{key}\"; its arguments are {Names(props)}";
                }
            }

            foreach (var prop in required)
            {
                if (!dict.Keys.Any(k => string.Equals(k, prop.Name, StringComparison.OrdinalIgnoreCase)))
                {
                    return $"\"{command}\" requires argument \"{WireName(prop)}\" and it was not sent";
                }
            }

            return null;
        }

        private static List<PropertyInfo> Declared(Type argsType)
        {
            var result = new List<PropertyInfo>();
            if (!argsType.IsClass || argsType == typeof(string) || argsType == typeof(object)
                || Nullable.GetUnderlyingType(argsType) != null
                || typeof(System.Collections.IEnumerable).IsAssignableFrom(argsType))
            {
                return result;
            }

            foreach (var prop in argsType.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (prop.CanWrite && prop.GetIndexParameters().Length == 0)
                {
                    result.Add(prop);
                }
            }

            return result;
        }

        private static string Names(IEnumerable<PropertyInfo> props) =>
            string.Join(", ", props.Select(p => "\"" + WireName(p) + "\""));

        private static object? DefaultInstance(Type argsType)
        {
            try
            {
                return Activator.CreateInstance(argsType);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /*
         * A number, flag or enum left out is the default its handler acts on, and a
         * property whose initializer names a value has a default worth taking, so
         * only a non-nullable reference argument that starts empty (an id or a name)
         * is one a call cannot do without.
         */
        private static bool IsRequired(PropertyInfo prop, object? defaults)
        {
            if (prop.PropertyType.IsValueType || !IsAnnotatedNotNull(prop) || defaults == null)
            {
                return false;
            }

            var initial = prop.GetValue(defaults);
            return initial == null || (initial is string text && text.Length == 0);
        }

        private static bool IsAnnotatedNotNull(PropertyInfo prop)
        {
            foreach (var attribute in prop.CustomAttributes)
            {
                if (attribute.AttributeType.FullName == NullableAttributeName)
                {
                    var argument = attribute.ConstructorArguments[0];
                    if (argument.Value is byte single)
                    {
                        return single == NotNullAnnotated;
                    }

                    var flags = (IReadOnlyList<CustomAttributeTypedArgument>)argument.Value!;
                    return flags.Count != 0 && (byte)flags[0].Value! == NotNullAnnotated;
                }
            }

            for (var scope = prop.DeclaringType; scope != null; scope = scope.DeclaringType)
            {
                foreach (var attribute in scope.GetTypeInfo().CustomAttributes)
                {
                    if (attribute.AttributeType.FullName == NullableContextAttributeName)
                    {
                        return (byte)attribute.ConstructorArguments[0].Value! == NotNullAnnotated;
                    }
                }
            }

            return false;
        }
    }
}
