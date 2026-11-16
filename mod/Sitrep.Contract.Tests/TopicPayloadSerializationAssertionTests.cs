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

        [SitrepContract]
        private sealed class MarkedOutcome
        {
            public bool Repaired { get; set; }
            public int FailuresCleared { get; set; }
            public MarkedOutcome? Inner { get; set; }
        }

        private sealed class UnmarkedOutcome
        {
            public bool Repaired { get; set; }
        }

        [SitrepCommand("fixture.marked", Payload = typeof(MarkedOutcome))]
        private sealed class MarkedArgs { }

        [Fact]
        public void A_marked_contract_class_in_a_command_result_is_written_in_camel_case()
        {
            var json = Serialization.EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "fixture.marked",
                Payload = CommandResult<MarkedOutcome>.Ok(new MarkedOutcome { Repaired = true, FailuresCleared = 2 }),
            });

            Assert.Contains("\"payload\":{\"repaired\":true,\"failuresCleared\":2,\"inner\":null}", json);
        }

        [Fact]
        public void The_command_reply_types_of_an_assembly_are_its_command_payloads()
        {
            var found = TopicPayloadSerializationAssertion.CommandReplyTypes(typeof(TopicPayloadSerializationAssertionTests).Assembly);

            Assert.Contains(("fixture.marked", typeof(MarkedOutcome), true), found);
        }

        [Fact]
        public void A_marked_command_reply_passes_the_gate()
        {
            TopicPayloadSerializationAssertion.AssertCommandRepliesSerialize(
                new[] { ("fixture.marked", typeof(MarkedOutcome), true) });
        }

        [Fact]
        public void An_unmarked_command_reply_fails_the_gate_naming_its_command()
        {
            var ex = Assert.Throws<TrueException>(() =>
                TopicPayloadSerializationAssertion.AssertCommandRepliesSerialize(
                    new[] { ("fixture.unmarked", typeof(UnmarkedOutcome), true) }));

            Assert.Contains("fixture.unmarked (UnmarkedOutcome)", ex.Message);
        }
    }
}
