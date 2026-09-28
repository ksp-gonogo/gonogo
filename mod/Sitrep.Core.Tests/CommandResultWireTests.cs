using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// F2 Part 3 (R7 wire-flatten) regression guard: before this landed,
    /// <see cref="JsonWriter.AppendValue"/> threw <c>NotSupportedException</c>
    /// on a <see cref="CommandResult"/> / <c>CommandResult&lt;T&gt;</c> POCO,
    /// so EVERY command response (success or failure) fail-softed at the wire
    /// boundary (<see cref="EnvelopeCodec.WriteCommandResponse"/> ->
    /// <see cref="JsonWriter.AppendValue"/>) and the client got an error or
    /// silence instead of its result. These tests serialize REAL results
    /// through the real codec and assert the decoded wire shape. Only
    /// <c>System.Text.Json</c> is used to inspect the produced bytes; never to
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
            Assert.False(result.TryGetProperty("errorCode", out _));
            Assert.Equal(3, result.GetProperty("payload").GetInt32());
        }

        [Fact]
        public void SuccessfulCommandResultOfStringSerializesOverTheWire()
        {
            var result = WriteAndDecodeResult(CommandResult<string>.Ok("node-1"));

            Assert.True(result.GetProperty("success").GetBoolean());
            Assert.False(result.TryGetProperty("errorCode", out _));
            Assert.Equal("node-1", result.GetProperty("payload").GetString());
        }

        [Fact]
        public void PlainSuccessfulCommandResultSerializesWithoutAPayloadKey()
        {
            var result = WriteAndDecodeResult(CommandResult.Ok());

            Assert.True(result.GetProperty("success").GetBoolean());
            Assert.False(result.TryGetProperty("errorCode", out _));
            Assert.False(result.TryGetProperty("payload", out _), "a non-generic CommandResult must not emit a payload key");
        }

        [Fact]
        public void FailedCommandResultCarriesTheTypedErrorCodeAsItsRootId()
        {
            var result = WriteAndDecodeResult(CommandResult<int>.Fail(CommandErrorCode.Range));

            Assert.False(result.GetProperty("success").GetBoolean());
            Assert.Equal("range", result.GetProperty("errorCode").GetString());
            Assert.False(result.TryGetProperty("reason", out _));
            // Generic subtype still emits the payload key on failure, for a
            // value-type T it is default(T) (0 for int), for a reference-type T
            // it is null (see the string case below).
            Assert.Equal(0, result.GetProperty("payload").GetInt32());
        }

        [Fact]
        public void FailedCommandResultOfReferenceTypeHasNullPayload()
        {
            var result = WriteAndDecodeResult(CommandResult<string>.Fail(CommandErrorCode.NotFound));

            Assert.False(result.GetProperty("success").GetBoolean());
            Assert.Equal("notFound", result.GetProperty("errorCode").GetString());
            Assert.Equal(JsonValueKind.Null, result.GetProperty("payload").ValueKind);
        }

        [Fact]
        public void ARefinementTravelsAsItsRootWithItsOwnIdAsTheReason()
        {
            var refinement = CommandErrorCode.CareerModeRequired.Refine("probe.notManaging", "the probe is not managing this save");

            var result = WriteAndDecodeResult(CommandResult.Fail(refinement));

            Assert.Equal("careerModeRequired", result.GetProperty("errorCode").GetString());
            Assert.Equal("probe.notManaging", result.GetProperty("reason").GetString());
        }

        [Fact]
        public void NullResultStillSerializesAsJsonNull()
        {
            // The pre-F2 fail-soft path (a command with no result) must remain
            // intact: a CLR null Result is a real value written as JSON null.
            var result = WriteAndDecodeResult(null);
            Assert.Equal(JsonValueKind.Null, result.ValueKind);
        }

        [Fact]
        public void AScienceTransmissionPayloadCrossesTheWireAsItsCamelCaseFields()
        {
            CommandResult returned = CommandResult<ScienceTransmission>.Ok(new ScienceTransmission
            {
                SubjectId = "crewReport@KerbinSrfLandedShores",
                Title = "Crew Report from Kerbin's Shores",
                StartedAt = 1000,
                StreamSeconds = 1.05,
                DataAmount = 5,
            });

            var payload = WriteAndDecodeResult(returned).GetProperty("payload");

            Assert.Equal("crewReport@KerbinSrfLandedShores", payload.GetProperty("subjectId").GetString());
            Assert.Equal("Crew Report from Kerbin's Shores", payload.GetProperty("title").GetString());
            Assert.Equal(1000, payload.GetProperty("startedAt").GetDouble());
            Assert.Equal(1.05, payload.GetProperty("streamSeconds").GetDouble());
            Assert.Equal(5, payload.GetProperty("dataAmount").GetDouble());
        }
    }
}
