using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// Proves that every Topic payload type an Uplink declares can be written to
    /// the wire by the host's own serializer. The host writes a payload through
    /// <see cref="EnvelopeCodec.WriteStreamData"/> and throws on any type it has no
    /// case for, which marks the whole Uplink unavailable, so a payload published
    /// as a plain object instead of a flattened dictionary is invisible to a build
    /// and to a unit test of the producer, and shows up only on a running game.
    /// Used by each Uplink's own test project next to <see cref="UnitCoverageAssertion"/>.
    ///
    /// <para>A type the Uplink's producer flattens to a dictionary before publishing
    /// is named in <c>flattenedByProducer</c> and is not written here: its wire form
    /// is the producer's, and the producer's own tests grade it. Every name must
    /// match a declared type, so an entry left behind after a type is renamed or
    /// removed fails rather than excusing nothing.</para>
    /// </summary>
    public static class TopicPayloadSerializationAssertion
    {
        /// <summary>
        /// Every concrete class in the assembly tagged <see cref="SitrepTopicAttribute"/>,
        /// the payload types its Topics publish.
        /// </summary>
        public static IEnumerable<Type> TopicPayloadTypes(Assembly contractAssembly) =>
            contractAssembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract)
                .Where(t => t.IsDefined(typeof(SitrepTopicAttribute), false));

        /// <summary>
        /// Every Topic payload type in the Uplink's contract assembly writes through
        /// the host's serializer, apart from those it names as flattened by the producer.
        /// </summary>
        /// <param name="contractAssembly">The Uplink's own contract assembly, reached
        /// with <c>typeof(OneOfItsTypes).Assembly</c>.</param>
        /// <param name="flattenedByProducer">Simple names of payload types the producer
        /// converts to a dictionary before publishing.</param>
        public static void AssertEveryTopicPayloadSerializes(
            Assembly contractAssembly,
            params string[] flattenedByProducer) =>
            AssertSerializes(TopicPayloadTypes(contractAssembly), flattenedByProducer);

        /// <summary>
        /// The same check over an explicit set of payload types.
        /// </summary>
        /// <param name="payloadTypes">Types tagged <see cref="SitrepTopicAttribute"/>.</param>
        /// <param name="flattenedByProducer">Simple names of types the producer flattens.</param>
        public static void AssertSerializes(IEnumerable<Type> payloadTypes, params string[] flattenedByProducer)
        {
            var types = payloadTypes.ToList();
            var excused = new HashSet<string>(flattenedByProducer, StringComparer.Ordinal);

            var stale = excused.Where(n => types.All(t => t.Name != n)).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                stale.Count == 0,
                "These names are listed as flattened by the producer but are not Topic payload types here:\n  " +
                string.Join("\n  ", stale));

            var failures = new List<string>();
            foreach (var type in types.Where(t => !excused.Contains(t.Name)))
            {
                var topic = type.GetCustomAttribute<SitrepTopicAttribute>(false)!;
                try
                {
                    var sample = Activator.CreateInstance(type);
                    object? payload = sample;
                    if (topic.IsArray)
                    {
                        var list = (System.Collections.IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(type))!;
                        list.Add(sample);
                        payload = list;
                    }

                    EnvelopeCodec.WriteStreamData(new StreamData<object?>
                    {
                        Topic = topic.TopicId,
                        Payload = payload,
                    });
                }
                catch (Exception ex)
                {
                    failures.Add(topic.TopicId + " (" + type.Name + "): " + ex.Message);
                }
            }

            Assert.True(
                failures.Count == 0,
                "These Topic payloads cannot be written to the wire, and publishing one marks its Uplink unavailable:\n  " +
                string.Join("\n  ", failures) +
                "\n\nFlatten the payload to a Dictionary<string, object?> before Publish and name its type in " +
                "flattenedByProducer, with a test that holds the dictionary to every field of the type.");
        }
    }
}
