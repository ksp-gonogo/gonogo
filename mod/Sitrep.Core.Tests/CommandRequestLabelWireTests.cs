using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Regression guard for the Task-2-review gap: <see cref="CommandRequest{TArgs}.Label"/>
    /// exists on the contract type (see <see cref="Sitrep.Contract.PendingUplink.Label"/>'s
    /// doc comment — it's carried verbatim into <c>system.uplink.pending</c>
    /// entries), but the hand-written wire codec (<see cref="EnvelopeCodec.ParseCommandRequest"/> /
    /// <see cref="EnvelopeCodec.WriteCommandRequest"/>) used to read/write only
    /// <c>requestId, command, args, sentAt</c> — a live client's <c>label</c>
    /// was silently dropped before it ever reached the host. These prove the
    /// field now survives the REAL wire round trip both directions.
    /// </summary>
    public class CommandRequestLabelWireTests
    {
        [Fact]
        public void LabelSurvivesWriteThenParseRoundTrip()
        {
            var original = new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = "req-1",
                Command = "kos.run",
                Label = "run.",
                Args = null,
                SentAt = 100,
            };

            var wire = EnvelopeCodec.WriteCommandRequest(original);
            var parsed = EnvelopeCodec.ParseCommandRequest(wire);

            Assert.Equal("run.", parsed.Label);
            Assert.Equal(original.RequestId, parsed.RequestId);
            Assert.Equal(original.Command, parsed.Command);
            Assert.Equal(original.SentAt, parsed.SentAt);
        }

        [Fact]
        public void WriteEmitsLabelOnTheWire()
        {
            var wire = EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = "req-1",
                Command = "kos.run",
                Label = "run.",
                Args = null,
                SentAt = 100,
            });

            Assert.Contains("\"label\":\"run.\"", wire);
        }

        [Fact]
        public void ParseDefaultsLabelToEmptyStringWhenAbsent_BackwardCompatibleWithAPreLabelClient()
        {
            // A pre-Label client's wire message simply won't carry this key --
            // must not throw (unlike requestId/command/sentAt, which ARE
            // required) and must default to "" (PendingUplink.Label's own
            // fallback-to-Command contract).
            const string wireWithoutLabel =
                "{\"type\":\"command-request\",\"requestId\":\"req-1\",\"command\":\"kos.run\",\"args\":null,\"sentAt\":100}";

            var parsed = EnvelopeCodec.ParseCommandRequest(wireWithoutLabel);

            Assert.Equal("", parsed.Label);
        }

        [Fact]
        public void TopicSurvivesWriteThenParseRoundTrip()
        {
            var original = new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = "req-1",
                Command = "kos.run",
                Label = "run.",
                Topic = "kos/7",
                Args = null,
                SentAt = 100,
            };

            var wire = EnvelopeCodec.WriteCommandRequest(original);
            var parsed = EnvelopeCodec.ParseCommandRequest(wire);

            Assert.Equal("kos/7", parsed.Topic);
            Assert.Equal(original.RequestId, parsed.RequestId);
            Assert.Equal(original.Command, parsed.Command);
            Assert.Equal(original.SentAt, parsed.SentAt);
        }

        [Fact]
        public void WriteEmitsTopicOnTheWire()
        {
            var wire = EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = "req-1",
                Command = "kos.run",
                Label = "run.",
                Topic = "kos/7",
                Args = null,
                SentAt = 100,
            });

            Assert.Contains("\"topic\":\"kos/7\"", wire);
        }

        [Fact]
        public void ParseDefaultsTopicToEmptyStringWhenAbsent_BackwardCompatibleWithAPreTopicClient()
        {
            // A pre-Topic client's wire message simply won't carry this key --
            // must not throw (unlike requestId/command/sentAt, which ARE
            // required) and must default to "" (PendingUplink.Topic's own
            // unscoped fallback).
            const string wireWithoutTopic =
                "{\"type\":\"command-request\",\"requestId\":\"req-1\",\"command\":\"kos.run\",\"args\":null,\"sentAt\":100}";

            var parsed = EnvelopeCodec.ParseCommandRequest(wireWithoutTopic);

            Assert.Equal("", parsed.Topic);
        }
    }
}
