using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Sitrep.Contract
{
    /// <summary>
    /// One value reachable from a Topic's payload, with every list it sits in.
    /// </summary>
    internal sealed class WalkedValue
    {
        internal WalkedValue(string topic, string path, PropertyInfo property, Type holder, IReadOnlyList<Type> lists)
        {
            Topic = topic;
            Path = path;
            Property = property;
            Holder = holder;
            Lists = lists;
        }

        /// <summary>The Topic id the value is published on.</summary>
        public string Topic { get; }

        /// <summary>
        /// The value's dotted camelCase path from the payload root, with <c>*</c>
        /// for each list or dictionary level it crosses. An array Topic's own
        /// elements are the leading <c>*</c>.
        /// </summary>
        public string Path { get; }

        public PropertyInfo Property { get; }

        /// <summary>The type that declares <see cref="Property"/>, which own-payload inputs resolve against.</summary>
        public Type Holder { get; }

        /// <summary>The element type of every LIST crossed on the way, outermost first. A dictionary is not one: its key is the entry's identity.</summary>
        public IReadOnlyList<Type> Lists { get; }
    }

    /// <summary>
    /// One row of the reckonable-value table: a value a model carries forward,
    /// the model, and its inputs split into the Topic they name and the path
    /// inside it.
    /// </summary>
    internal sealed class ReckonableRow
    {
        internal ReckonableRow(string topic, string field, string basis, IReadOnlyList<(string Topic, string Path)> inputs)
        {
            Topic = topic;
            Field = field;
            Basis = basis;
            Inputs = inputs;
        }

        public string Topic { get; }

        public string Field { get; }

        public string Basis { get; }

        public IReadOnlyList<(string Topic, string Path)> Inputs { get; }
    }

    /// <summary>
    /// Every value a contract assembly publishes, walked from each
    /// <c>[SitrepTopic]</c> payload down through its nested shapes, lists and
    /// dictionaries. The tags a value carries (its sample kind, whether it keys
    /// its list, the models that carry it forward) are read off this one walk by
    /// codegen and by the gates, so the two cannot disagree on where a tag sits.
    /// </summary>
    internal static class ValueTagWalk
    {
        /// <summary>Deeper than any payload the contract publishes, and a stop for a shape that holds itself.</summary>
        private const int MaxDepth = 8;

        /// <summary>Every value reachable from a Topic among <paramref name="types"/>, sorted by Topic then path.</summary>
        public static IReadOnlyList<WalkedValue> Walk(IEnumerable<Type> types)
        {
            var values = new List<WalkedValue>();
            foreach (var type in types)
            {
                var topic = type.GetCustomAttribute<SitrepTopicAttribute>(false);
                if (topic == null)
                {
                    continue;
                }

                var lists = topic.IsArray ? new List<Type> { type } : new List<Type>();
                Descend(topic.TopicId, type, topic.IsArray ? "*." : "", lists, new HashSet<Type> { type }, 0, values);
            }

            return values
                .OrderBy(v => v.Topic, StringComparer.Ordinal)
                .ThenBy(v => v.Path, StringComparer.Ordinal)
                .ToList();
        }

        private static void Descend(
            string topic,
            Type holder,
            string prefix,
            List<Type> lists,
            HashSet<Type> onPath,
            int depth,
            List<WalkedValue> into)
        {
            if (depth > MaxDepth)
            {
                return;
            }

            foreach (var prop in holder.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (prop.GetIndexParameters().Length != 0)
                {
                    continue;
                }

                var path = prefix + UnitDescriptor.CamelCase(prop.Name);
                into.Add(new WalkedValue(topic, path, prop, holder, lists.ToList()));

                var nested = UnitDescriptor.NestedContractType(prop.PropertyType, out var isMap, out var isList);
                if (nested == null || nested == typeof(Vec3) || !IsContractShape(nested, holder) || onPath.Contains(nested))
                {
                    continue;
                }

                var nextLists = isList ? new List<Type>(lists) { nested } : lists;
                onPath.Add(nested);
                Descend(topic, nested, path + (isMap || isList ? ".*." : "."), nextLists, onPath, depth + 1, into);
                onPath.Remove(nested);
            }
        }

        /// <summary>A shape the contract declares: one from the walked assembly or from core's, never a framework type.</summary>
        private static bool IsContractShape(Type type, Type holder) =>
            type.IsClass
            && (type.Assembly == holder.Assembly || type.Assembly == typeof(SitrepTopicAttribute).Assembly);

        /// <summary>
        /// Every reckonable value the assembly declares: the property marks found
        /// on the walk, then the assembly-level marks on another owner's Topics.
        /// Sorted by (topic, field, basis), so the generated table never depends on
        /// reflection order.
        /// </summary>
        public static IReadOnlyList<ReckonableRow> ReckonableRows(Assembly assembly, IReadOnlyList<WalkedValue> walked)
        {
            var rows = new List<ReckonableRow>();
            foreach (var value in walked.Where(ClaimsItsTopic))
            {
                foreach (var mark in value.Property.GetCustomAttributes<SitrepReckonableAttribute>(false))
                {
                    rows.Add(new ReckonableRow(value.Topic, value.Path, mark.Basis, mark.Inputs.Select(SplitInput).ToList()));
                }
            }

            foreach (var mark in assembly.GetCustomAttributes<SitrepReckonableOnAttribute>())
            {
                rows.Add(new ReckonableRow(mark.Topic, mark.Field, mark.Basis, mark.Inputs.Select(SplitInput).ToList()));
            }

            return rows
                .OrderBy(r => r.Topic, StringComparer.Ordinal)
                .ThenBy(r => r.Field, StringComparer.Ordinal)
                .ThenBy(r => r.Basis, StringComparer.Ordinal)
                .ToList();
        }

        /// <summary>
        /// Whether a model marked on this value speaks for the Topic it was reached
        /// from. A mark on a Topic payload's own property is a claim about that
        /// Topic: <c>VesselOrbit</c> is carried forward as the craft's own orbit, and
        /// the same shape published as a target's orbit is a different body under
        /// different forces. A mark on a shape no Topic owns applies wherever the
        /// shape is published.
        /// </summary>
        public static bool ClaimsItsTopic(WalkedValue value)
        {
            var owner = value.Holder.GetCustomAttribute<SitrepTopicAttribute>(false);
            return owner == null || owner.TopicId == value.Topic;
        }

        /// <summary>
        /// One declared input split into the Topic it names and the path inside it.
        /// A bare path is on the object holding the value, so it has no topic;
        /// <c>@topic</c> is another Topic's whole payload; <c>@topic#path</c> has
        /// both. Splitting on the FIRST <c>#</c> keeps <c>vessel.orbit</c> and
        /// <c>vessel.orbit.truth</c> apart.
        /// </summary>
        internal static (string Topic, string Path) SplitInput(string input)
        {
            if (string.IsNullOrEmpty(input) || input[0] != '@')
            {
                return ("", input ?? "");
            }

            var body = input.Substring(1);
            var hash = body.IndexOf('#');
            return hash < 0
                ? (body, "")
                : (body.Substring(0, hash), body.Substring(hash + 1));
        }

        /// <summary>The wire spelling of a kind, as the client's vocabulary has it.</summary>
        internal static string WireName(SampleKind kind)
        {
            switch (kind)
            {
                case SampleKind.Continuous: return "continuous";
                case SampleKind.Discrete: return "discrete";
                case SampleKind.Event: return "event";
                default: throw new ArgumentOutOfRangeException(nameof(kind), kind, "not a SampleKind");
            }
        }
    }
}
