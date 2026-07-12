using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Regression guard for the <c>kos.processors</c> "subscribed but no
    /// stream-data" bug: <see cref="JsonWriter.AppendValue"/> threw
    /// <c>NotSupportedException</c> on a <see cref="KosProcessorInfo"/> POCO, so
    /// a NON-EMPTY processor list (a vessel with kOS CPUs) fail-softed at the
    /// wire boundary and the client got nothing — while an empty list serialized
    /// fine as <c>[]</c>. Same class of bug the <c>CommsDelay</c> flatten already
    /// fixed. These serialize through the real writer and assert the decoded
    /// camelCase wire shape the generated TS contract consumes.
    /// </summary>
    public class KosProcessorInfoWireTests
    {
        private static JsonElement Write(object? value)
        {
            // Serialize through the REAL stream-data wire path (the same
            // EnvelopeCodec -> JsonWriter funnel a subscribed client receives),
            // then read back the payload. System.Text.Json only inspects the
            // produced bytes — it never produces them.
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "kos.processors",
                Payload = value,
                Meta = new Meta
                {
                    Source = "kos",
                    ValidAt = 0,
                    Seq = 1,
                    DeliveredAt = 0,
                    Vantage = "v",
                    Quality = Quality.OnRails,
                    Active = true,
                    Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            };
            var json = EnvelopeCodec.WriteStreamData(msg);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.GetProperty("payload").Clone();
        }

        [Fact]
        public void PopulatedProcessorSerializesToCamelCaseWireShape()
        {
            var el = Write(new KosProcessorInfo
            {
                CoreId = 7,
                Tag = "mainframe",
                HasBooted = true,
                BootFilePath = "0:/boot/startup.ks",
                ProcessorMode = "READY",
            });

            Assert.Equal(7, el.GetProperty("coreId").GetInt32());
            Assert.Equal("mainframe", el.GetProperty("tag").GetString());
            Assert.True(el.GetProperty("hasBooted").GetBoolean());
            Assert.Equal("0:/boot/startup.ks", el.GetProperty("bootFilePath").GetString());
            Assert.Equal("READY", el.GetProperty("processorMode").GetString());
        }

        [Fact]
        public void NullTagAndBootFileSerializeAsJsonNull_NotEmptyString()
        {
            var el = Write(new KosProcessorInfo
            {
                CoreId = 1,
                Tag = null,
                HasBooted = false,
                BootFilePath = null,
                ProcessorMode = "OFF",
            });

            Assert.Equal(JsonValueKind.Null, el.GetProperty("tag").ValueKind);
            Assert.Equal(JsonValueKind.Null, el.GetProperty("bootFilePath").ValueKind);
        }

        [Fact]
        public void NonEmptyProcessorListSerializesAsArrayOfObjects()
        {
            var el = Write(new List<KosProcessorInfo>
            {
                new KosProcessorInfo { CoreId = 1, Tag = "a", HasBooted = true, ProcessorMode = "READY" },
                new KosProcessorInfo { CoreId = 2, Tag = null, HasBooted = false, ProcessorMode = "OFF" },
            });

            Assert.Equal(JsonValueKind.Array, el.ValueKind);
            Assert.Equal(2, el.GetArrayLength());
            Assert.Equal(1, el[0].GetProperty("coreId").GetInt32());
            Assert.Equal(2, el[1].GetProperty("coreId").GetInt32());
        }
    }
}
