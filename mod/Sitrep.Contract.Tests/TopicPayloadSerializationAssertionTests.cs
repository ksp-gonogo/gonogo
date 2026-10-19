using System.Collections.Generic;
using Sitrep.Contract.TestSupport;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Contract.Tests
{
    public class TopicPayloadSerializationAssertionTests
    {
        [SitrepTopic("fixture.plain")]
        private sealed class PlainObjectPayload
        {
            public string? Name { get; set; }
        }

        [SitrepTopic("fixture.dictionary")]
        private sealed class DictionaryPayload : Dictionary<string, object?>
        {
        }

        [SitrepTopic("fixture.plainList", isArray: true)]
        private sealed class PlainObjectListPayload
        {
            public int? Count { get; set; }
        }

        [Fact]
        public void The_topic_payload_types_of_an_assembly_are_its_tagged_concrete_classes()
        {
            var found = TopicPayloadSerializationAssertion.TopicPayloadTypes(typeof(TopicPayloadSerializationAssertionTests).Assembly);

            Assert.Contains(typeof(PlainObjectPayload), found);
            Assert.Contains(typeof(DictionaryPayload), found);
        }

        [Fact]
        public void A_payload_published_as_a_plain_object_fails_naming_its_topic_and_type()
        {
            var ex = Assert.Throws<TrueException>(() =>
                TopicPayloadSerializationAssertion.AssertSerializes(new[] { typeof(PlainObjectPayload) }));

            Assert.Contains("fixture.plain (PlainObjectPayload)", ex.Message);
            Assert.Contains("unsupported CLR value type", ex.Message);
        }

        [Fact]
        public void An_array_topic_is_written_as_a_list_of_its_type()
        {
            var ex = Assert.Throws<TrueException>(() =>
                TopicPayloadSerializationAssertion.AssertSerializes(new[] { typeof(PlainObjectListPayload) }));

            Assert.Contains("fixture.plainList (PlainObjectListPayload)", ex.Message);
        }

        [Fact]
        public void A_type_the_producer_flattens_is_not_written()
        {
            TopicPayloadSerializationAssertion.AssertSerializes(
                new[] { typeof(PlainObjectPayload), typeof(PlainObjectListPayload) },
                nameof(PlainObjectPayload),
                nameof(PlainObjectListPayload));
        }

        [Fact]
        public void An_excused_name_that_matches_no_payload_type_fails()
        {
            var ex = Assert.Throws<TrueException>(() =>
                TopicPayloadSerializationAssertion.AssertSerializes(new[] { typeof(PlainObjectPayload) }, nameof(PlainObjectPayload), "Gone"));

            Assert.Contains("Gone", ex.Message);
        }

        [Fact]
        public void A_payload_type_the_writer_has_a_case_for_passes()
        {
            TopicPayloadSerializationAssertion.AssertSerializes(new[] { typeof(DictionaryPayload) });
        }
    }
}
