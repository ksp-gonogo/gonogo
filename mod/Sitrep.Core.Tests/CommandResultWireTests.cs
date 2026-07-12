using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// F2 Part 3 (R7 wire-flatten) regression guard: before this landed,
    /// <see cref="JsonWriter.AppendValue"/> threw <c>NotSupportedException</c>
    /// on a <see cref="CommandResult"/> / <c>CommandResult&lt;T&gt;</c> POCO,
    /// so EVERY command response — success or failure — fail-softed at the wire
    /// boundary (<see cref="EnvelopeCodec.WriteCommandResponse"/> ->
    /// <see cref="JsonWriter.AppendValue"/>) and the client got an error or
    /// silence instead of its result. These tests serialize REAL results
    /// through the real codec and assert the decoded wire shape. Only
    /// <c>System.Text.Json</c> is used to inspect the produced bytes — never to
    /// produce them, which is what's under test.
    /// </summary>
    public class CommandResultWireTests
    {
        private static Meta AnyMeta() => new Meta
        {
            Source = "system",
            ValidAt = 0,
            Seq = 1,
            DeliveredAt = 0,
            Vantage = "v",
            Quality = Quality.OnRails,
            Active = true,
            Staleness = Staleness.Fresh,
            TimelineEpoch = 0,
        };

        private static JsonElement WriteAndDecodeResult(object? result)
        {
            var response = new CommandResponse<object?>
            {
                RequestId = "c1",
                Result = result,
                Meta = AnyMeta(),
            };
            var json = EnvelopeCodec.WriteCommandResponse(response);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.GetProperty("result").Clone();
        }

        [Fact]
        public void SuccessfulCommandResultOfIntSerializesOverTheWire()
        {
            var result = WriteAndDecodeResult(CommandResult<int>.Ok(3));

            Assert.True(result.GetProperty("success").GetBoolean());
            Assert.Equal(0, result.GetProperty("errorCode").GetInt32());
            Assert.Equal(3, result.GetProperty("payload").GetInt32());
        }

        [Fact]
        public void SuccessfulCommandResultOfStringSerializesOverTheWire()
        {
            var result = WriteAndDecodeResult(CommandResult<string>.Ok("node-1"));

            Assert.True(result.GetProperty("success").GetBoolean());
            Assert.Equal(0, result.GetProperty("errorCode").GetInt32());
            Assert.Equal("node-1", result.GetProperty("payload").GetString());
        }

        [Fact]
        public void PlainSuccessfulCommandResultSerializesWithoutAPayloadKey()
        {
            var result = WriteAndDecodeResult(CommandResult.Ok());

            Assert.True(result.GetProperty("success").GetBoolean());
            Assert.Equal(0, result.GetProperty("errorCode").GetInt32());
            Assert.False(result.TryGetProperty("payload", out _), "a non-generic CommandResult must not emit a payload key");
        }

        [Fact]
        public void FailedCommandResultCarriesTheTypedErrorCodeAsItsIntegerOrdinal()
        {
            var result = WriteAndDecodeResult(CommandResult<int>.Fail(CommandErrorCode.Range));

            Assert.False(result.GetProperty("success").GetBoolean());
            Assert.Equal((int)CommandErrorCode.Range, result.GetProperty("errorCode").GetInt32());
            // Generic subtype still emits the payload key on failure — for a
            // value-type T it is default(T) (0 for int), for a reference-type T
            // it is null (see the string case below).
            Assert.Equal(0, result.GetProperty("payload").GetInt32());
        }

        [Fact]
        public void FailedCommandResultOfReferenceTypeHasNullPayload()
        {
            var result = WriteAndDecodeResult(CommandResult<string>.Fail(CommandErrorCode.NotFound));

            Assert.False(result.GetProperty("success").GetBoolean());
            Assert.Equal((int)CommandErrorCode.NotFound, result.GetProperty("errorCode").GetInt32());
            Assert.Equal(JsonValueKind.Null, result.GetProperty("payload").ValueKind);
        }

        [Fact]
        public void NullResultStillSerializesAsJsonNull()
        {
            // The pre-F2 fail-soft path (a command with no result) must remain
            // intact: a CLR null Result is a real value written as JSON null.
            var result = WriteAndDecodeResult(null);
            Assert.Equal(JsonValueKind.Null, result.ValueKind);
        }
    }
}
