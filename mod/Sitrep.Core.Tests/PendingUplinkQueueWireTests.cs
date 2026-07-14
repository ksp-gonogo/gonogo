using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Regression guard, same class of bug as <c>KosProcessorInfoWireTests</c>:
    /// <see cref="JsonWriter.AppendValue"/> has no generic POCO fallback (see
    /// its <c>default:</c> case, which throws <c>NotSupportedException</c>) --
    /// every <c>Sitrep.Contract</c> payload type needs its own hand-flattened
    /// case, or a subscriber to that topic gets zero stream-data. Without the
    /// <see cref="PendingUplinkQueue"/>/<see cref="PendingUplink"/> cases added
    /// alongside <c>system.uplink.pending</c>'s engine wiring, even an EMPTY
    /// queue would fail-soft at the wire boundary.
    /// </summary>
    public class PendingUplinkQueueWireTests
    {
        private static JsonElement Write(object? value)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "system.uplink.pending",
                Payload = value,
                Meta = new Meta
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
                },
            };
            var json = EnvelopeCodec.WriteStreamData(msg);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.GetProperty("payload").Clone();
        }

        [Fact]
        public void EmptyQueueSerializesAsEmptyPendingArray()
        {
            var el = Write(new PendingUplinkQueue());

            Assert.Equal(JsonValueKind.Array, el.GetProperty("pending").ValueKind);
            Assert.Equal(0, el.GetProperty("pending").GetArrayLength());
        }

        [Fact]
        public void PopulatedQueueSerializesToCamelCaseWireShape()
        {
            var el = Write(new PendingUplinkQueue
            {
                Pending = new List<PendingUplink>
                {
                    new PendingUplink
                    {
                        Id = "c1",
                        Command = "kos.run",
                        Label = "run.",
                        Topic = "kos/7",
                        Vantage = "KSC",
                        DispatchedAt = 0,
                        OneWaySeconds = 5,
                    },
                },
            });

            var entry = el.GetProperty("pending")[0];
            Assert.Equal("c1", entry.GetProperty("id").GetString());
            Assert.Equal("kos.run", entry.GetProperty("command").GetString());
            Assert.Equal("run.", entry.GetProperty("label").GetString());
            Assert.Equal("kos/7", entry.GetProperty("topic").GetString());
            Assert.Equal("KSC", entry.GetProperty("vantage").GetString());
            Assert.Equal(0, entry.GetProperty("dispatchedAt").GetDouble());
            Assert.Equal(5, entry.GetProperty("oneWaySeconds").GetDouble());
        }
    }
}
