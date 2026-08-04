using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;

namespace Sitrep.Contract
{
    /// <summary>
    /// The contract's unit knowledge, as data, derived by reflection.
    /// </summary>
    ///
    /// <remarks>
    /// <para>Every other piece of the unit system is a TypeScript artifact:
    /// the generated <c>Value&lt;"kW"&gt;</c> types, the unit maps, the
    /// decode-time wrap. None of it survives the wire. A consumer that is not
    /// TypeScript receives <c>{"heatShieldFlux": 3400.0}</c> and has no way to
    /// learn it is kilowatts.</para>
    ///
    /// <para>This class is why the mod can answer that question. It lives here
    /// rather than in <c>RtConfig</c> because <c>RtConfig</c> references
    /// Reinforced.Typings, which is a codegen-time dependency that the shipped
    /// mod does not carry: touching it at runtime would fail to load. Nothing
    /// in this file references anything outside the contract assembly and the
    /// BCL.</para>
    ///
    /// <para><b>Reflected, not embedded.</b> The obvious alternative is to
    /// bake the generated <c>units.json</c> into the assembly as a resource.
    /// That would give the served descriptor its own copy of the truth, free
    /// to drift from the attributes it claims to describe the moment someone
    /// annotates a property without re-running codegen. Reflecting the same
    /// assembly the payloads come from makes drift impossible rather than
    /// merely tested-against. Codegen calls this too, so the file on disk and
    /// the document on the wire are one implementation.</para>
    /// </remarks>
    public static class UnitDescriptor
    {
        /// <summary>Version of the descriptor DOCUMENT's shape, not of the contract it describes.</summary>
        public const int Version = 1;

        /// <summary>
        /// Tokens that declare a property has no physical dimension AND is not
        /// a number you would ever scale, add or compare. They stay bare on the
        /// wire type. See <c>RtConfig</c>'s copy of this reasoning for why
        /// Count/Ratio/Percent/Dimensionless are deliberately absent.
        /// </summary>
        public static readonly ISet<string> NonQuantityUnits = new HashSet<string>(StringComparer.Ordinal)
        {
            Units.Text,
            Units.Flag,
            Units.Enumeration,
            Units.Id,
            Units.NotApplicable,
        };

        /// <summary>The five collections the descriptor carries, all sorted so the output is byte-stable.</summary>
        public sealed class Maps
        {
            public SortedSet<string> Vocabulary { get; set; }
            public SortedDictionary<string, SortedDictionary<string, string>> ByType { get; set; }
            public SortedDictionary<string, SortedDictionary<string, string>> ByTopic { get; set; }
            public SortedDictionary<string, SortedDictionary<string, string>> ShapesByType { get; set; }
            public SortedDictionary<string, SortedDictionary<string, string>> ShapesByTopic { get; set; }
        }

        /// <summary>
        /// The descriptor as a JSON document. Sorted throughout, so re-running
        /// produces identical bytes.
        /// </summary>
        /// <param name="assembly">
        /// Which assembly to describe. Defaults to this one, the first-party
        /// contract. An Uplink passes its OWN contract assembly and gets its
        /// own descriptor with no edit to first-party code: declaring a unit
        /// was always symmetric (<see cref="SitrepUnitAttribute"/> takes an
        /// arbitrary string), and this is the codegen half of that symmetry.
        /// </param>
        public static string ToJson(Assembly assembly = null)
        {
            return ToJson(Collect(assembly: assembly));
        }

        /// <summary>
        /// Reflects over every <c>[SitrepUnit]</c>-tagged property in this
        /// assembly.
        /// </summary>
        /// <param name="validateVocabulary">
        /// When true, a token outside the <see cref="Units"/> catalog throws.
        /// That is right for CODEGEN, where everything reflected is compiled
        /// into this assembly and a typo is drift. It is wrong at RUNTIME
        /// inside KSP, where throwing would take the mod down over a
        /// descriptor nobody asked for; there the offending field is simply
        /// carried as-is and a consumer sees an unknown token, which the
        /// open `SitrepUnit` union already allows for.
        /// </param>
        /// <param name="assembly">
        /// Which assembly to reflect over. Defaults to this one. An Uplink's
        /// own contract assembly works exactly as well: nothing here is
        /// specific to the first-party contract except the default.
        /// </param>
        public static Maps Collect(bool validateVocabulary = false, Assembly assembly = null)
        {
            var vocabulary = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var field in typeof(Units).GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                if (field.IsLiteral && field.FieldType == typeof(string))
                {
                    vocabulary.Add((string)field.GetRawConstantValue());
                }
            }

            var byType = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var byTopic = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var shapesByType = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var shapesByTopic = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);

            var target = assembly ?? typeof(UnitDescriptor).Assembly;
            var assemblyTypes = target.GetTypes();
            // The catalog belongs to THIS assembly, so it can only judge this
            // assembly's tokens. A third party cannot add to `Units` (a
            // const-string class compiled in here), which is exactly why the
            // generated `SitrepUnit` union is open; validating their tokens
            // against our catalog would mean an Uplink could never declare a
            // unit at all.
            var validate = validateVocabulary && target == typeof(UnitDescriptor).Assembly;
            var contractTypes = new HashSet<string>(StringComparer.Ordinal);
            foreach (var t in assemblyTypes)
            {
                contractTypes.Add(t.Name);
            }

            foreach (var type in assemblyTypes)
            {
                var fields = new SortedDictionary<string, string>(StringComparer.Ordinal);
                var nested = new SortedDictionary<string, string>(StringComparer.Ordinal);
                foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    // A property whose type is ANOTHER contract shape (or a
                    // list, or a map, of one). The unit maps are flat per
                    // type, so without this a nested shape's declared units
                    // are unreachable from the parent's entry. Vec3 is
                    // excluded: its unit is declared per USE SITE and
                    // propagates onto dotted leaf keys below.
                    bool isMap;
                    var nestedType = NestedContractType(prop.PropertyType, out isMap);
                    if (nestedType != null
                        && nestedType != typeof(Vec3)
                        && contractTypes.Contains(nestedType.Name))
                    {
                        // A leading `*` marks a DICTIONARY of the shape: the
                        // runtime has to map over the values rather than treat
                        // the dictionary itself as one payload.
                        nested[CamelCase(prop.Name)] =
                            (isMap ? "*" : string.Empty) + nestedType.Name;
                    }

                    var unit = prop.GetCustomAttribute<SitrepUnitAttribute>();
                    if (unit == null)
                    {
                        continue;
                    }

                    // An Uplink's token is NOT checked against this catalog
                    // even when validating: it cannot add to `Units`, which is
                    // a const-string class in this assembly, so a closed check
                    // would mean an Uplink could never declare a unit at all.
                    // Its tokens ride the open arm of the generated
                    // `SitrepUnit` union and are registered client-side
                    // through `registerUnit`.
                    if (validate && !vocabulary.Contains(unit.Unit))
                    {
                        throw new InvalidOperationException(
                            "[SitrepUnit] on " + type.Name + "." + prop.Name + " carries \"" + unit.Unit +
                            "\", which is not a Sitrep.Contract.Units constant. Add it to the Units catalog. " +
                            "(A third-party Uplink does not go through this check: it declares its unit as a " +
                            "plain string and registers the kind client-side via registerUnit.)");
                    }

                    var field = CamelCase(prop.Name);
                    if (prop.PropertyType == typeof(Vec3))
                    {
                        // A [SitrepUnit] on a Vec3-TYPED field states the unit
                        // of the WHOLE vector, and the wire carries three
                        // scalar leaves, so the unit propagates to each.
                        foreach (var leaf in Vec3LeafNames())
                        {
                            fields.Add(field + "." + leaf, unit.Unit);
                        }
                    }
                    else
                    {
                        fields.Add(field, unit.Unit);
                    }
                }

                var topic = type.GetCustomAttribute<SitrepTopicAttribute>();

                if (nested.Count > 0)
                {
                    shapesByType.Add(type.Name, nested);
                    if (topic != null)
                    {
                        shapesByTopic.Add(topic.TopicId, nested);
                    }
                }

                if (fields.Count == 0)
                {
                    continue;
                }

                byType.Add(type.Name, fields);

                if (topic != null)
                {
                    byTopic.Add(topic.TopicId, fields);
                }
            }

            return new Maps
            {
                Vocabulary = vocabulary,
                ByType = byType,
                ByTopic = byTopic,
                ShapesByType = shapesByType,
                ShapesByTopic = shapesByTopic,
            };
        }

        /// <summary>
        /// The maps as JSON. Written by hand rather than through a serializer
        /// because this assembly targets netstandard2.0 and carries no JSON
        /// dependency, and because the output wants to be stable byte-for-byte:
        /// every collection is already sorted, so a diff means the contract
        /// actually changed.
        /// </summary>
        public static string ToJson(Maps maps)
        {
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"version\": ").Append(Version).Append(",\n");
            sb.Append("  \"vocabulary\": [\n");
            var first = true;
            foreach (var token in maps.Vocabulary)
            {
                if (!first)
                {
                    sb.Append(",\n");
                }
                first = false;
                sb.Append("    ").Append(JsonString(token));
            }
            sb.Append("\n  ],\n");
            AppendJsonMap(sb, "types", maps.ByType, false);
            AppendJsonMap(sb, "topics", maps.ByTopic, false);
            AppendJsonMap(sb, "typeShapes", maps.ShapesByType, false);
            AppendJsonMap(sb, "topicShapes", maps.ShapesByTopic, true);
            sb.Append("}\n");
            return sb.ToString();
        }

        private static void AppendJsonMap(
            StringBuilder sb,
            string name,
            SortedDictionary<string, SortedDictionary<string, string>> map,
            bool last)
        {
            sb.Append("  ").Append(JsonString(name)).Append(": {\n");
            var firstOuter = true;
            foreach (var outer in map)
            {
                if (!firstOuter)
                {
                    sb.Append(",\n");
                }
                firstOuter = false;
                sb.Append("    ").Append(JsonString(outer.Key)).Append(": {\n");
                var firstInner = true;
                foreach (var inner in outer.Value)
                {
                    if (!firstInner)
                    {
                        sb.Append(",\n");
                    }
                    firstInner = false;
                    sb.Append("      ").Append(JsonString(inner.Key)).Append(": ").Append(JsonString(inner.Value));
                }
                sb.Append("\n    }");
            }
            sb.Append("\n  }").Append(last ? "\n" : ",\n");
        }

        /// <summary>
        /// A JSON string literal. The tokens and field names here are
        /// identifiers and unit symbols, so the escapes that can actually occur
        /// are the quote and the backslash; the control-character arm is there
        /// so a future token cannot silently produce invalid JSON.
        /// </summary>
        private static string JsonString(string value)
        {
            var sb = new StringBuilder("\"");
            foreach (var c in value)
            {
                if (c == '"' || c == '\\')
                {
                    sb.Append('\\').Append(c);
                }
                else if (c < ' ')
                {
                    sb.Append("\\u").Append(((int)c).ToString("x4"));
                }
                else
                {
                    sb.Append(c);
                }
            }
            return sb.Append('"').ToString();
        }

        /// <summary>
        /// The nested contract shape a property holds, or null. <paramref
        /// name="isMap"/> is true for a <c>Dictionary&lt;string, T&gt;</c>,
        /// which the runtime has to map over rather than wrap whole.
        /// </summary>
        internal static Type NestedContractType(Type type, out bool isMap)
        {
            isMap = false;
            var dictionaryValue = DictionaryValueType(type);
            if (dictionaryValue != null)
            {
                isMap = true;
                return dictionaryValue;
            }

            var element = NumericSequenceElement(type) ?? type;
            var underlying = Nullable.GetUnderlyingType(element) ?? element;
            if (underlying.IsPrimitive || underlying.IsEnum || underlying == typeof(string)
                || underlying == typeof(decimal) || underlying == typeof(DateTime))
            {
                return null;
            }

            return underlying.IsClass || underlying.IsValueType ? underlying : null;
        }

        /// <summary>
        /// The VALUE type of a <c>Dictionary&lt;string, T&gt;</c>-shaped
        /// property, or null for anything else. A contract map is always keyed
        /// by string on the wire, so the key is never interesting.
        /// </summary>
        internal static Type DictionaryValueType(Type type)
        {
            if (!type.IsGenericType)
            {
                return null;
            }

            var args = type.GetGenericArguments();
            if (args.Length != 2 || args[0] != typeof(string))
            {
                return null;
            }

            return typeof(System.Collections.IEnumerable).IsAssignableFrom(type)
                ? args[1]
                : null;
        }

        /// <summary>The element type of an array or single-arg sequence, or null.</summary>
        internal static Type NumericSequenceElement(Type type)
        {
            if (type == typeof(string))
            {
                return null;
            }

            if (type.IsArray)
            {
                return type.GetElementType();
            }

            if (type.IsGenericType)
            {
                var args = type.GetGenericArguments();
                if (args.Length == 1 && typeof(System.Collections.IEnumerable).IsAssignableFrom(type))
                {
                    return args[0];
                }
            }

            return null;
        }

        /// <summary>Vec3's leaf names, read off the shape so they track a rename of X/Y/Z.</summary>
        internal static List<string> Vec3LeafNames()
        {
            var names = new List<string>();
            foreach (var prop in typeof(Vec3).GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                names.Add(CamelCase(prop.Name));
            }

            return names;
        }

        /// <summary>
        /// Mirrors Reinforced.Typings' <c>CamelCaseForProperties</c>:
        /// lowercase the leading character, leave the rest alone (so
        /// <c>DynamicPressureKPa</c> stays <c>dynamicPressureKPa</c> and
        /// <c>GForce</c> becomes <c>gForce</c>, both exactly as they appear in
        /// the emitted contract.ts).
        /// </summary>
        internal static string CamelCase(string name)
        {
            if (string.IsNullOrEmpty(name) || !char.IsUpper(name[0]))
            {
                return name;
            }

            return char.ToLowerInvariant(name[0]) + name.Substring(1);
        }
    }
}
