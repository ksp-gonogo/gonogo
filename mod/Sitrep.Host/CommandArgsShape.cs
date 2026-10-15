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
        /// <paramref name="argsType"/>. Arguments nested inside an argument, or
        /// inside the elements of a list argument, are held to the same rule
        /// and named by their path (<c>steps[1].target</c>).
        ///
        /// <para>An argument sent as an explicit null is refused when its type
        /// cannot hold null: a number, flag or enum, or a reference the contract
        /// marks as not nullable, as a list element is too. <paramref name="requireAll"/> false leaves
        /// out the check that every required argument is sent, for a question
        /// about a call whose arguments are not all chosen yet.</para>
        /// </summary>
        internal static string? Violation(string command, object? args, Type argsType, bool requireAll = true)
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

            if (args == null)
            {
                var required = requireAll ? RequiredOf(props, argsType) : new List<PropertyInfo>();
                return required.Count == 0
                    ? null
                    : $"\"{command}\" was sent no arguments but requires {Names(required)}";
            }

            return args is IDictionary<string, object?> dict
                ? Walk(command, "", dict, argsType, props, requireAll)
                : null;
        }

        private static string? Walk(
            string command,
            string path,
            IDictionary<string, object?> dict,
            Type type,
            List<PropertyInfo> props,
            bool requireAll)
        {
            foreach (var key in dict.Keys)
            {
                if (!props.Any(p => string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)))
                {
                    return $"\"{command}\" has no argument \"{path}{key}\"; its arguments are {Names(props)}";
                }
            }

            if (requireAll)
            {
                foreach (var prop in RequiredOf(props, type))
                {
                    var sent = dict.FirstOrDefault(kv => string.Equals(kv.Key, prop.Name, StringComparison.OrdinalIgnoreCase));
                    if (sent.Key == null)
                    {
                        return $"\"{command}\" requires argument \"{path}{WireName(prop)}\" and it was not sent";
                    }
                    if (sent.Value == null)
                    {
                        return $"\"{command}\" requires argument \"{path}{WireName(prop)}\" and it was sent as null";
                    }
                }
            }

            foreach (var kv in dict)
            {
                var prop = props.First(p => string.Equals(p.Name, kv.Key, StringComparison.OrdinalIgnoreCase));
                if (kv.Value == null)
                {
                    if (CannotBeNull(prop))
                    {
                        return $"\"{command}\" argument \"{path}{WireName(prop)}\" cannot be null";
                    }

                    continue;
                }

                var inner = Nested(command, path + WireName(prop), kv.Value, prop.PropertyType, requireAll, ElementsCannotBeNull(prop));
                if (inner != null)
                {
                    return inner;
                }
            }

            return null;
        }

        private static string? Nested(string command, string path, object? value, Type type, bool requireAll, bool elementsCannotBeNull)
        {
            if (value is IDictionary<string, object?> dict)
            {
                var props = Declared(type);
                return props.Count == 0 ? null : Walk(command, path + ".", dict, type, props, requireAll);
            }

            var element = ElementTypeOf(type);
            if (element == null || !(value is System.Collections.IEnumerable items) || value is string)
            {
                return null;
            }

            var index = 0;
            foreach (var item in items)
            {
                if (item == null)
                {
                    if (elementsCannotBeNull)
                    {
                        return $"\"{command}\" argument \"{path}[{index}]\" cannot be null";
                    }

                    index++;
                    continue;
                }

                var inner = Nested(command, $"{path}[{index}]", item, element, requireAll, false);
                if (inner != null)
                {
                    return inner;
                }

                index++;
            }

            return null;
        }

        private static Type? ElementTypeOf(Type type)
        {
            if (type.IsArray)
            {
                return type.GetElementType();
            }

            if (type == typeof(string) || !type.IsGenericType)
            {
                return null;
            }

            var generic = type.GetGenericTypeDefinition();
            return generic == typeof(List<>) || generic == typeof(IList<>) || generic == typeof(IReadOnlyList<>)
                || generic == typeof(IEnumerable<>) || generic == typeof(ICollection<>) || generic == typeof(IReadOnlyCollection<>)
                ? type.GetGenericArguments()[0]
                : null;
        }

        private static List<PropertyInfo> RequiredOf(List<PropertyInfo> props, Type type)
        {
            var defaults = DefaultInstance(type);
            return props.Where(p => IsRequired(p, defaults)).ToList();
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

        private static bool CannotBeNull(PropertyInfo prop) =>
            prop.PropertyType.IsValueType
                ? Nullable.GetUnderlyingType(prop.PropertyType) == null
                : IsAnnotatedNotNull(prop);

        private static bool ElementsCannotBeNull(PropertyInfo prop)
        {
            var element = ElementTypeOf(prop.PropertyType);
            if (element == null)
            {
                return false;
            }

            if (element.IsValueType)
            {
                return Nullable.GetUnderlyingType(element) == null;
            }

            var flags = NullableFlagsOf(prop);
            return flags != null && (flags.Length == 1 ? flags[0] : flags.Length > 1 ? flags[1] : (byte)0) == NotNullAnnotated;
        }

        private static byte[]? NullableFlagsOf(PropertyInfo prop)
        {
            foreach (var attribute in prop.CustomAttributes)
            {
                if (attribute.AttributeType.FullName == NullableAttributeName)
                {
                    var argument = attribute.ConstructorArguments[0];
                    if (argument.Value is byte single)
                    {
                        return new[] { single };
                    }

                    return ((IReadOnlyList<CustomAttributeTypedArgument>)argument.Value!).Select(f => (byte)f.Value!).ToArray();
                }
            }

            for (var scope = prop.DeclaringType; scope != null; scope = scope.DeclaringType)
            {
                foreach (var attribute in scope.GetTypeInfo().CustomAttributes)
                {
                    if (attribute.AttributeType.FullName == NullableContextAttributeName)
                    {
                        return new[] { (byte)attribute.ConstructorArguments[0].Value! };
                    }
                }
            }

            return null;
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
