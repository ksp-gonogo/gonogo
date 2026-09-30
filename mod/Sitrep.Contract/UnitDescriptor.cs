using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;

namespace Sitrep.Contract
{
    /// <summary>
    /// The contract's unit knowledge as data, derived by reflection over the
    /// <see cref="SitrepUnitAttribute"/> on every payload property.
    ///
    /// <para>Units do not travel on the wire: a consumer receives
    /// <c>{"heatShieldFlux": 3400.0}</c> with no way to learn it is kilowatts.
    /// This descriptor is how a consumer that is not the TypeScript SDK can find
    /// out. The mod serves it as the <c>system.units</c> Topic, and an Uplink can
    /// build its own from its own contract assembly.</para>
    ///
    /// <para>It is reflected from the same assembly the payloads come from, so it
    /// cannot drift from the attributes it describes.</para>
    /// <internal>
    /// Lives here rather than in RtConfig because RtConfig references
    /// Reinforced.Typings, a codegen-time dependency the shipped mod does not
    /// carry. Nothing in this file references anything outside the contract
    /// assembly and the BCL. Codegen calls this too, so units.json on disk and
    /// the document on the wire are one implementation; embedding units.json as
    /// a resource would have given the served descriptor its own copy of the
    /// truth.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    public static class UnitDescriptor
    {
        /// <summary>The version of the descriptor document's own shape (its <c>"version"</c> field), not of the contract it describes.</summary>
        public const int Version = 1;

        /// <summary>
        /// Unit tokens that declare a property has no physical dimension and is
        /// not a number you would scale, add or compare: text, flag,
        /// enumeration, id and not-applicable. Count, ratio, percent and
        /// dimensionless are quantities and are not in this set.
        /// <internal>These stay bare on the generated wire type; RtConfig carries the same reasoning.</internal>
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
            /// <summary>
            /// Every unit token the catalog knows: the <see cref="Units"/>
            /// constants, plus an Uplink's own catalog when describing an Uplink
            /// assembly. Written as <c>"vocabulary"</c>. A compound token such as
            /// <c>kg/s</c> is not listed; it is known when both halves are.
            /// </summary>
            public SortedSet<string> Vocabulary { get; set; }

            /// <summary>
            /// Type name to (camelCase field name to unit token), for every type
            /// with at least one unit-tagged property. A <c>Vec3</c> field
            /// contributes three dotted keys (<c>field.x</c>, <c>field.y</c>,
            /// <c>field.z</c>) with the vector's unit. Generic type names carry
            /// no arity suffix. Written as <c>"types"</c>.
            /// </summary>
            public SortedDictionary<string, SortedDictionary<string, string>> ByType { get; set; }

            /// <summary>
            /// The same field-to-unit maps as <see cref="ByType"/>, keyed by Topic
            /// id for each payload type tagged with one. Written as
            /// <c>"topics"</c>.
            /// </summary>
            public SortedDictionary<string, SortedDictionary<string, string>> ByTopic { get; set; }

            /// <summary>
            /// Type name to (camelCase field name to nested type name), for each
            /// field whose type is another contract shape, so a consumer can follow
            /// units into nested objects. A leading <c>*</c> marks a dictionary of
            /// that shape and a trailing <c>[]</c> a list of it; <c>Vec3</c> fields
            /// are not listed. Written as <c>"typeShapes"</c>.
            /// </summary>
            public SortedDictionary<string, SortedDictionary<string, string>> ShapesByType { get; set; }

            /// <summary>
            /// The same nested-shape maps as <see cref="ShapesByType"/>, keyed by
            /// Topic id. Written as <c>"topicShapes"</c>.
            /// </summary>
            public SortedDictionary<string, SortedDictionary<string, string>> ShapesByTopic { get; set; }

            /// <summary>
            /// Per type, each <c>enum</c> field's CLR enum wire name, or null for a
            /// field carried as the member's name rather than its ordinal. A field
            /// absent here has no single name to read as.
            /// </summary>
            public SortedDictionary<string, SortedDictionary<string, string>> EnumsByType { get; set; }

            /// <summary>The same, keyed by Topic id.</summary>
            public SortedDictionary<string, SortedDictionary<string, string>> EnumsByTopic { get; set; }

            /// <summary>Every enum an <c>enum</c> field names, as its wire value to member name.</summary>
            public SortedDictionary<string, SortedDictionary<long, string>> EnumMembers { get; set; }

            /// <summary>
            /// Type name to the camelCase fields it declares
            /// <see cref="SitrepStaticAttribute"/>, for every type with at least
            /// one. A <c>Vec3</c> field contributes its three dotted leaf keys,
            /// as it does in <see cref="ByType"/>.
            /// </summary>
            public SortedDictionary<string, SortedSet<string>> StaticByType { get; set; }

            /// <summary>The same, keyed by Topic id.</summary>
            public SortedDictionary<string, SortedSet<string>> StaticByTopic { get; set; }
        }

        /// <summary>
        /// The descriptor as a JSON document. Sorted throughout, so re-running
        /// produces identical bytes.
        /// </summary>
        /// <param name="assembly">
        /// Which assembly to describe. Defaults to this one, the first-party
        /// contract. An Uplink passes its OWN contract assembly and gets its
        /// own descriptor: <see cref="SitrepUnitAttribute"/> takes an arbitrary
        /// string, so an Uplink declares units the same way this contract does.
        /// </param>
        /// <returns>The descriptor as a JSON document.</returns>
        public static string ToJson(Assembly assembly = null)
        {
            return ToJson(Collect(assembly: assembly));
        }

        /// <summary>Copy every public string constant on <paramref name="source"/> into <paramref name="into"/>.</summary>
        private static void AddStringConstants(Type source, SortedSet<string> into)
        {
            if (source == null) return;
            foreach (var field in source.GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                if (field.IsLiteral && field.FieldType == typeof(string))
                {
                    into.Add((string)field.GetRawConstantValue());
                }
            }
        }

        /// <summary>
        /// An Uplink's own unit catalog: a public static class in the assembly
        /// being reflected whose name is <c>Units</c> or ends in <c>Units</c>
        /// (<c>CareerUnits</c>, <c>AeroUnits</c>).
        /// </summary>
        /// <remarks>
        /// An Uplink models quantities core has never heard of, so it declares
        /// them alongside its wire types and they are judged the same way core's
        /// are. Absent, the Uplink simply declares no units of its own and only
        /// core's catalog applies.
        ///
        /// <para><b>Why the suffix and not the exact name.</b> A catalog named
        /// exactly <c>Units</c> SHADOWS this assembly's own <see cref="Units"/>
        /// for any file in the same namespace, so the moment an Uplink adds one
        /// beside its payloads every existing <c>[SitrepUnit(Units.Flag)]</c> in
        /// that namespace stops resolving. The in-repo slices work round it by
        /// putting their payloads in a different namespace and qualifying their
        /// own as <c>Contract.Units.X</c>, which is a trick nobody would guess
        /// and which the guide could only document as a trap. Accepting a
        /// suffixed name lets an author call theirs <c>ExampleUnits</c> and have
        /// no collision to work round. Accepting the suffix only adds tokens to
        /// the vocabulary, so it cannot make a passing check fail.</para>
        /// </remarks>
        private static void AddUplinkCatalog(Assembly target, SortedSet<string> into)
        {
            if (target == typeof(UnitDescriptor).Assembly) return;
            foreach (var type in LoadableTypes(target))
            {
                if (type.Name.EndsWith("Units", StringComparison.Ordinal) && type.IsAbstract && type.IsSealed)
                {
                    AddStringConstants(type, into);
                }
            }
        }

        /// <summary>
        /// Whether a declared token is one the catalog knows, treating a
        /// compound as known when both of its components are.
        /// </summary>
        /// <remarks>
        /// Rates and per-unit densities compose rather than being enumerated:
        /// declaring every rung of every family crossed with every denominator
        /// would be dozens of constants nobody reads, and the client resolves
        /// the same way by composing the halves. A typo in either half still
        /// fails, which is the whole point of the check.
        /// </remarks>
        private static bool IsKnownToken(string token, SortedSet<string> vocabulary)
        {
            if (token == null) return false;
            if (vocabulary.Contains(token)) return true;
            var slash = token.IndexOf('/');
            if (slash <= 0 || slash == token.Length - 1) return false;
            var numerator = token.Substring(0, slash);
            var denominator = token.Substring(slash + 1);
            return vocabulary.Contains(numerator) && vocabulary.Contains(denominator);
        }

        /// <summary>
        /// Reflects over every unit-tagged property in <paramref name="assembly"/>
        /// and returns the descriptor's collections.
        /// </summary>
        /// <param name="validateVocabulary">
        /// When <c>true</c>, a token outside the catalog (core's
        /// <see cref="Units"/> plus the Uplink's own <c>*Units</c> class, with a
        /// compound known when both halves are) throws
        /// <see cref="InvalidOperationException"/>. Use it at build time, where a
        /// typo is a defect. Leave it <c>false</c> at runtime inside KSP, where
        /// an unknown token is carried as-is rather than taking the mod down.
        /// </param>
        /// <param name="assembly">
        /// Which assembly to reflect over. Defaults to this one. An Uplink's
        /// own contract assembly works exactly as well: nothing here is
        /// specific to the first-party contract except the default.
        /// </param>
        /// <returns>The five sorted collections.</returns>
        public static Maps Collect(bool validateVocabulary = false, Assembly assembly = null)
        {
            var vocabulary = new SortedSet<string>(StringComparer.Ordinal);
            AddStringConstants(typeof(Units), vocabulary);

            var byType = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var byTopic = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var shapesByType = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var shapesByTopic = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var enumsByType = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var enumsByTopic = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
            var enumMembers = new SortedDictionary<string, SortedDictionary<long, string>>(StringComparer.Ordinal);
            var staticByType = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);
            var staticByTopic = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);

            var target = assembly ?? typeof(UnitDescriptor).Assembly;
            var assemblyTypes = LoadableTypes(target);
            AddUplinkCatalog(target, vocabulary);
            /*
             * An Uplink cannot add to `Units`, a const-string class compiled in here, so every
             * Uplink is judged against core's catalog plus its own: it can declare whatever units
             * it models while a typo in either still fails.
             */
            var validate = validateVocabulary;
            var contractTypes = new HashSet<string>(StringComparer.Ordinal);
            foreach (var t in assemblyTypes)
            {
                contractTypes.Add(WireName(t));
            }

            foreach (var type in assemblyTypes)
            {
                var fields = new SortedDictionary<string, string>(StringComparer.Ordinal);
                var nested = new SortedDictionary<string, string>(StringComparer.Ordinal);
                var enums = new SortedDictionary<string, string>(StringComparer.Ordinal);
                var statics = new SortedSet<string>(StringComparer.Ordinal);
                foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    if (prop.GetCustomAttribute<SitrepStaticAttribute>() != null)
                    {
                        var staticField = CamelCase(prop.Name);
                        if (prop.PropertyType == typeof(Vec3))
                        {
                            foreach (var leaf in Vec3LeafNames())
                            {
                                statics.Add(staticField + "." + leaf);
                            }
                        }
                        else
                        {
                            statics.Add(staticField);
                        }
                    }

                    /*
                     * A property whose type is another contract shape (or a list or map of one). The
                     * unit maps are flat per type, so without this a nested shape's units are
                     * unreachable from the parent. Vec3 is excluded: its unit is declared per use site
                     * and propagates onto dotted leaf keys below.
                     */
                    bool isMap;
                    bool isList;
                    var nestedType = NestedContractType(prop.PropertyType, out isMap, out isList);
                    if (nestedType != null
                        && nestedType != typeof(Vec3)
                        && contractTypes.Contains(WireName(nestedType)))
                    {
                        /*
                         * Both markers name the element type and say how many of it the field holds. A
                         * leading `*` marks a dictionary, which the runtime maps over rather than treating
                         * as one payload; a trailing `[]` marks a list. Plurality separates a path a caller
                         * can sample from one it cannot: without it `contracts.active.agent` reads as a
                         * field of `career.status`, when it is a field of one element of an array.
                         */
                        nested[CamelCase(prop.Name)] =
                            (isMap ? "*" : string.Empty)
                            + WireName(nestedType)
                            + (isList ? "[]" : string.Empty);
                    }

                    var unit = prop.GetCustomAttribute<SitrepUnitAttribute>();
                    if (unit == null)
                    {
                        continue;
                    }

                    // Validation judges against core's catalog plus the Uplink's own; see the comment above `validate`.
                    if (validate && !IsKnownToken(unit.Unit, vocabulary))
                    {
                        throw new InvalidOperationException(
                            "[SitrepUnit] on " + type.Name + "." + prop.Name + " carries \"" + unit.Unit +
                            "\", which is not a Sitrep.Contract.Units constant. Add it to the Units catalog. " +
                            "(A third-party Uplink does not go through this check: it declares its unit as a " +
                            "plain string and registers the kind client-side via registerUnit.)");
                    }

                    var field = CamelCase(prop.Name);
                    string enumName;
                    if (unit.Unit == Units.Enumeration && TryEnumWireName(prop.PropertyType, enumMembers, out enumName))
                    {
                        enums.Add(field, enumName);
                    }

                    if (prop.PropertyType == typeof(Vec3))
                    {
                        // A unit on a Vec3 field is the whole vector's, and the wire carries three scalar leaves, so each leaf gets it.
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

                if (statics.Count > 0)
                {
                    staticByType.Add(WireName(type), statics);
                    if (topic != null)
                    {
                        staticByTopic.Add(topic.TopicId, statics);
                    }
                }

                if (nested.Count > 0)
                {
                    shapesByType.Add(WireName(type), nested);
                    if (topic != null)
                    {
                        shapesByTopic.Add(topic.TopicId, nested);
                    }
                }

                if (enums.Count > 0)
                {
                    enumsByType.Add(WireName(type), enums);
                    if (topic != null)
                    {
                        enumsByTopic.Add(topic.TopicId, enums);
                    }
                }

                if (fields.Count == 0)
                {
                    continue;
                }

                byType.Add(WireName(type), fields);

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
                EnumsByType = enumsByType,
                EnumsByTopic = enumsByTopic,
                EnumMembers = enumMembers,
                StaticByType = staticByType,
                StaticByTopic = staticByTopic,
            };
        }

        /// <summary>
        /// Throws when <paramref name="prop"/> is declared both
        /// <see cref="SitrepStaticAttribute"/> and
        /// <see cref="SitrepReckonableAttribute"/>: a static value is carried
        /// forward by constancy, so no model carries it, and the two marks
        /// contradict each other.
        /// </summary>
        /// <param name="prop">A contract property.</param>
        public static void RequireStaticIsNotReckonable(PropertyInfo prop)
        {
            if (prop.IsDefined(typeof(SitrepStaticAttribute), false)
                && prop.IsDefined(typeof(SitrepReckonableAttribute), false))
            {
                throw new InvalidOperationException(
                    "[SitrepStatic] and [SitrepReckonable] on " + prop.DeclaringType?.Name + "." + prop.Name +
                    ": a static value is carried forward by constancy, so no model carries it.");
            }
        }

        /// <summary>
        /// Whether an <c>enum</c> field of <paramref name="propertyType"/> can be
        /// read as a word: a CLR enum yields its wire name (recording its members
        /// in <paramref name="members"/>), a string already carries the member's
        /// name and yields null. Anything else, a bitmask held as an integer, has
        /// no single name.
        /// </summary>
        private static bool TryEnumWireName(
            Type propertyType,
            SortedDictionary<string, SortedDictionary<long, string>> members,
            out string name)
        {
            name = null;
            if (propertyType == typeof(string))
            {
                return true;
            }

            var underlying = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
            if (!underlying.IsEnum)
            {
                return false;
            }

            name = WireName(underlying);
            if (!members.ContainsKey(name))
            {
                var byValue = new SortedDictionary<long, string>();
                foreach (var member in Enum.GetValues(underlying))
                {
                    var value = Convert.ToInt64(member);
                    // An alias shares its value with another member, and one name per value is all a reader needs.
                    if (!byValue.ContainsKey(value))
                    {
                        byValue.Add(value, Enum.GetName(underlying, member));
                    }
                }

                members.Add(name, byValue);
            }

            return true;
        }

        /// <summary>
        /// Writes <paramref name="maps"/> as the descriptor JSON document:
        /// <c>version</c>, <c>vocabulary</c>, <c>types</c>, <c>topics</c>,
        /// <c>typeShapes</c> and <c>topicShapes</c>. Every collection is sorted,
        /// so the output is byte-stable and a diff means the contract changed.
        /// <internal>Written by hand: this assembly targets netstandard2.0 and carries no JSON dependency.</internal>
        /// </summary>
        /// <param name="maps">The collections from <see cref="Collect"/>.</param>
        /// <returns>The JSON document, newline-terminated.</returns>
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
                    continue;
                }
                if (c < ' ')
                {
                    sb.Append("\\u").Append(((int)c).ToString("x4"));
                    continue;
                }
                sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        /// <summary>
        /// Every type in <paramref name="assembly"/> that can actually be
        /// loaded.
        /// </summary>
        /// <remarks>
        /// <para><c>GetTypes()</c> resolves every type in the assembly and
        /// throws the whole call away if one of them references something
        /// absent. A contract assembly may hold a type whose dependencies are
        /// not deployed, and a descriptor that omits an unloadable type is
        /// better than none.</para>
        /// </remarks>
        internal static Type[] LoadableTypes(Assembly assembly)
        {
            try
            {
                return assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                // Partial load: the resolvable types come back on the
                // exception, which is the case worth salvaging.
                var loaded = new List<Type>();
                foreach (var t in ex.Types)
                {
                    if (t != null)
                    {
                        loaded.Add(t);
                    }
                }

                return loaded.ToArray();
            }
            catch (System.IO.FileNotFoundException)
            {
                // A dependency is not deployed at all and nothing comes back: empty rather than an exception the caller cannot act on.
                return new Type[0];
            }
        }

        /// <summary>
        /// The nested contract shape a property holds, or null. <paramref
        /// name="isMap"/> is true for a <c>Dictionary&lt;string, T&gt;</c>,
        /// which the runtime has to map over rather than wrap whole;
        /// <paramref name="isList"/> is true for an array or sequence of the
        /// shape. Both describe the ELEMENT type this returns, and a property
        /// is at most one of them.
        /// </summary>
        internal static Type NestedContractType(Type type, out bool isMap, out bool isList)
        {
            isMap = false;
            isList = false;
            var dictionaryValue = DictionaryValueType(type);
            if (dictionaryValue != null)
            {
                isMap = true;
                return dictionaryValue;
            }

            var sequenceElement = NumericSequenceElement(type);
            isList = sequenceElement != null;
            var element = sequenceElement ?? type;
            var underlying = Nullable.GetUnderlyingType(element) ?? element;
            // An error code crosses the wire as its string id, so it is a scalar here too.
            if (underlying.IsPrimitive || underlying.IsEnum || underlying == typeof(string)
                || underlying == typeof(decimal) || underlying == typeof(DateTime)
                || underlying == typeof(RefusalCode) || underlying == typeof(FaultCode))
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

        /// <summary>
        /// The type's name AS THE EMITTED CONTRACT SPELLS IT, which for a generic
        /// means without the CLR arity suffix: <c>CommandRequest`1</c> keyed as
        /// <c>CommandRequest</c>, matching the <c>CommandRequest&lt;TArgs&gt;</c>
        /// interface a consumer is looking the field up against.
        /// </summary>
        internal static string WireName(Type type)
        {
            var name = type.Name;
            var tick = name.IndexOf('`');
            return tick < 0 ? name : name.Substring(0, tick);
        }
    }
}
