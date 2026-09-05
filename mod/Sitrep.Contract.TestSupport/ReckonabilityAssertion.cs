using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// The gate behind <see cref="SitrepReckonableAttribute"/>: a value marked
    /// reckonable must publish, on the wire, every input its declared model needs.
    ///
    /// <para><b>Why a gate at all.</b> The mark is a promise to an API consumer who
    /// holds the stream and nothing else: "you can carry this value forward yourself,
    /// from these inputs". A declared input that resolves to nothing is that promise
    /// broken in the one way nobody notices, because the client that made the mark
    /// has the value in hand anyway and never asks the wire for it. Reflection over
    /// the contract's own metadata is the only place the promise and the published
    /// surface can be compared.</para>
    ///
    /// <para><b>It takes its universe as arguments and asserts nothing.</b> That is
    /// what lets a fixture drive it: the planted violations in
    /// <c>Sitrep.Contract.Tests</c> are POCOs in the test assembly carrying real
    /// marks with unresolvable inputs, and a gate that reached for
    /// <c>typeof(VesselTarget).Assembly</c> internally could never be pointed at
    /// them. A gate that cannot be shown failing reports zero and zero reads as
    /// success. <c>UnitCoverageAssertion.AssertExhaustive</c> is the counter-example
    /// on the other side of this file: it takes an assembly and asserts, and there is
    /// no way to plant a violation for it that does not ship.</para>
    /// </summary>
    public static class ReckonabilityAssertion
    {
        /// <summary>Marks a whole-payload cross-topic input: <c>@system.bodies</c>.</summary>
        private const char TopicPrefix = '@';

        /// <summary>Separates a cross-topic input's topic from its field path: <c>@vessel.orbit#mu</c>.</summary>
        private const char PathSeparator = '#';

        /// <summary>
        /// One <c>[SitrepReckonable]</c> declaration, resolved down to the names the
        /// wire uses so a caller never has to re-derive the camelCasing.
        /// </summary>
        public sealed class ReckonableMark
        {
            internal ReckonableMark(Type declaringType, PropertyInfo property, SitrepReckonableAttribute declaration)
            {
                DeclaringType = declaringType;
                Property = property;
                Declaration = declaration;
                var topic = declaringType.GetCustomAttribute<SitrepTopicAttribute>(false);
                Topic = topic?.TopicId ?? "";
                IsArrayTopic = topic?.IsArray ?? false;
                Field = CamelCase(property.Name);
            }

            public Type DeclaringType { get; }

            public PropertyInfo Property { get; }

            public SitrepReckonableAttribute Declaration { get; }

            /// <summary>The declaring type's Topic id, or <c>""</c> when it carries no <c>[SitrepTopic]</c>.</summary>
            public string Topic { get; }

            /// <summary>Whether that Topic's payload is a bare JSON array of the declaring type.</summary>
            public bool IsArrayTopic { get; }

            /// <summary>The property name as the wire spells it.</summary>
            public string Field { get; }

            /// <summary>What a failure message and a sort order both want: <c>Type.Property</c>.</summary>
            public string Where => DeclaringType.Name + "." + Property.Name;
        }

        /// <summary>
        /// Every reckonability declaration among <paramref name="candidateTypes"/>,
        /// ordered by <c>(topic, field)</c> so a caller never depends on reflection
        /// order.
        ///
        /// <para>DECLARED properties only. A mark inherited onto a Topic payload would
        /// generate a projection field the payload's own interface does not declare,
        /// and <c>Pick&lt;T, K&gt;</c> would stop being exact.</para>
        /// </summary>
        public static IReadOnlyList<ReckonableMark> Marks(IEnumerable<Type> candidateTypes)
        {
            var marks = new List<ReckonableMark>();

            foreach (var type in candidateTypes)
            {
                if (!type.IsClass || type.IsAbstract)
                {
                    continue;
                }

                foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    var declaration = prop.GetCustomAttribute<SitrepReckonableAttribute>(false);
                    if (declaration is not null)
                    {
                        marks.Add(new ReckonableMark(type, prop, declaration));
                    }
                }
            }

            return marks
                .OrderBy(m => m.Topic, StringComparer.Ordinal)
                .ThenBy(m => m.Field, StringComparer.Ordinal)
                .ToList();
        }

        /// <summary>
        /// The <c>topicId -&gt; payload type</c> map the gate resolves cross-topic
        /// inputs against. For an array Topic the value is the ELEMENT type, which is
        /// what the tag carries.
        /// </summary>
        public static IReadOnlyDictionary<string, Type> TopicPayloads(IEnumerable<Type> candidateTypes)
        {
            var map = new Dictionary<string, Type>(StringComparer.Ordinal);

            foreach (var type in candidateTypes)
            {
                var topic = type.GetCustomAttribute<SitrepTopicAttribute>(false);
                if (topic is not null && !map.ContainsKey(topic.TopicId))
                {
                    map[topic.TopicId] = type;
                }
            }

            return map;
        }

        /// <summary>
        /// The closed basis vocabulary, read off <see cref="ReckoningBases"/> rather
        /// than repeated here, so a token added to the catalogue is legal the moment
        /// it exists and a token deleted from it goes red at every use.
        /// </summary>
        public static IReadOnlyCollection<string> KnownBases() =>
            typeof(ReckoningBases)
                .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
                .Where(f => f.IsLiteral && !f.IsInitOnly && f.FieldType == typeof(string))
                .Select(f => (string)f.GetRawConstantValue()!)
                .ToList();

        /// <summary>
        /// Every unresolved reckonability declaration among
        /// <paramref name="candidateTypes"/>, as "<c>Type.Property -&gt; what is
        /// wrong</c>" strings. Empty means clean.
        /// </summary>
        /// <param name="candidateTypes">The universe to scan. Supplied by the caller
        /// so a fixture assembly can be scanned the same way the contract is.</param>
        /// <param name="topicPayloads">What a cross-topic input may name; see
        /// <see cref="TopicPayloads"/>.</param>
        /// <param name="knownBases">The legal basis tokens; see <see cref="KnownBases"/>.</param>
        public static IReadOnlyList<string> Problems(
            IReadOnlyList<Type> candidateTypes,
            IReadOnlyDictionary<string, Type> topicPayloads,
            IReadOnlyCollection<string> knownBases)
        {
            var problems = new List<string>();

            foreach (var mark in Marks(candidateTypes))
            {
                foreach (var problem in ProblemsWith(mark, topicPayloads, knownBases))
                {
                    problems.Add(mark.Where + " -> " + problem);
                }
            }

            return problems;
        }

        private static IEnumerable<string> ProblemsWith(
            ReckonableMark mark,
            IReadOnlyDictionary<string, Type> topicPayloads,
            IReadOnlyCollection<string> knownBases)
        {
            if (mark.Topic.Length == 0)
            {
                yield return "the declaring type carries no [SitrepTopic], so there is no Topic for the "
                    + "generated projection to key the field under. Reckonability is declared on a "
                    + "published value, and a type nothing publishes has none.";
                yield break;
            }

            if (mark.IsArrayTopic)
            {
                yield return "'" + mark.Topic + "' is an array Topic. Its projection would be an array of "
                    + "anonymous values with the identity fields picked away, which cannot be joined back "
                    + "to the element it came from. Carrying identity into the projection is a design "
                    + "decision on its own, not a mark to add here.";
            }

            if (!knownBases.Contains(mark.Declaration.Basis))
            {
                yield return "basis '" + mark.Declaration.Basis + "' is not in the ReckoningBases catalogue ("
                    + string.Join(", ", knownBases.OrderBy(b => b, StringComparer.Ordinal))
                    + "). The vocabulary is closed: adding a token says a new class of arithmetic is honest.";
            }

            var inputs = mark.Declaration.Inputs ?? new string[0];
            if (inputs.Length == 0)
            {
                yield return "no declared inputs. A mark with none is the pre-declaration state the "
                    + "attribute exists to end: it promises a model and names nothing it runs on.";
            }

            foreach (var duplicate in inputs.GroupBy(i => i, StringComparer.Ordinal).Where(g => g.Count() > 1))
            {
                yield return "input '" + duplicate.Key + "' is declared " + duplicate.Count() + " times.";
            }

            foreach (var input in inputs.Distinct(StringComparer.Ordinal))
            {
                var problem = ProblemWithInput(mark, input, topicPayloads);
                if (problem is not null)
                {
                    yield return problem;
                }
            }
        }

        private static string? ProblemWithInput(
            ReckonableMark mark,
            string input,
            IReadOnlyDictionary<string, Type> topicPayloads)
        {
            if (input.Length == 0)
            {
                return "an empty input string.";
            }

            if (input[0] != TopicPrefix)
            {
                if (string.Equals(input, mark.Field, StringComparison.Ordinal))
                {
                    return "input '" + input + "' is the marked value itself. Every model is anchored on the "
                        + "value it advances, so that anchor is implicit and must not be listed.";
                }

                return Resolves(mark.DeclaringType, input)
                    ? null
                    : "input '" + input + "' does not resolve to a published property path on "
                        + mark.DeclaringType.Name + ". A mark is a promise about what the WIRE carries, "
                        + "so an input the payload does not publish is a promise the stream cannot keep.";
            }

            var body = input.Substring(1);
            var separator = body.IndexOf(PathSeparator);
            var topicId = separator < 0 ? body : body.Substring(0, separator);
            var path = separator < 0 ? "" : body.Substring(separator + 1);

            if (topicId.Length == 0)
            {
                return "input '" + input + "' names no topic after the '" + TopicPrefix + "'.";
            }

            if (!topicPayloads.TryGetValue(topicId, out var payload))
            {
                return "input '" + input + "' names topic '" + topicId + "', which no [SitrepTopic] type "
                    + "publishes. A consumer holding the stream cannot subscribe to a topic that is not "
                    + "on it.";
            }

            if (separator < 0)
            {
                return null;
            }

            if (path.Length == 0)
            {
                return "input '" + input + "' has a '" + PathSeparator + "' and no path after it. Drop the "
                    + "separator to declare the whole payload.";
            }

            return Resolves(payload, path)
                ? null
                : "input '" + input + "' does not resolve to a published property path on " + payload.Name
                    + ", the payload of '" + topicId + "'.";
        }

        /// <summary>
        /// Whether a dotted camelCase path names a public instance property, walking
        /// nested contract types segment by segment.
        ///
        /// <para>Nullable value types are unwrapped so <c>double?</c> is walkable as
        /// <c>double</c>; a collection is NOT, because an input that names one element
        /// of a list has not said which element and the gate should say so by refusing
        /// rather than by guessing.</para>
        /// </summary>
        private static bool Resolves(Type root, string path)
        {
            var current = root;

            foreach (var segment in path.Split('.'))
            {
                if (segment.Length == 0)
                {
                    return false;
                }

                var match = current
                    .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                    .FirstOrDefault(p => string.Equals(CamelCase(p.Name), segment, StringComparison.Ordinal));

                if (match is null)
                {
                    return false;
                }

                current = Nullable.GetUnderlyingType(match.PropertyType) ?? match.PropertyType;
            }

            return true;
        }

        /// <summary>
        /// Mirrors <c>UnitDescriptor.CamelCase</c>, which is internal to
        /// <c>Sitrep.Contract</c> and visible only to <c>Sitrep.Core</c>: lowercase the
        /// leading character, leave the rest alone, so <c>DynamicPressureKPa</c> stays
        /// <c>dynamicPressureKPa</c> and <c>GForce</c> becomes <c>gForce</c>, exactly as
        /// the emitted contract spells them.
        /// </summary>
        private static string CamelCase(string name)
        {
            if (string.IsNullOrEmpty(name) || !char.IsUpper(name[0]))
            {
                return name;
            }

            return char.ToLowerInvariant(name[0]) + name.Substring(1);
        }
    }
}
