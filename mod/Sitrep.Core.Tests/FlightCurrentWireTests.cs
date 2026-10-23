using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <c>flight.current</c> through the real stream-data wire path, including the
    /// EVA fields.
    /// </summary>
    public class FlightCurrentWireTests
    {
        private static JsonElement Write(FlightCurrent current)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "flight.current",
                Payload = current,
                Meta = new Meta
                {
                    Source = "flight",
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
            using var doc = JsonDocument.Parse(EnvelopeCodec.WriteStreamData(msg));
            return doc.RootElement.GetProperty("payload").Clone();
        }

        [Fact]
        public void AKerbalOnEvaIsNamedOnTheWire()
        {
            var el = Write(new FlightCurrent
            {
                FlightId = "f1",
                VesselId = "v1",
                VesselName = "Alpha",
                Phase = Situation.Orbiting,
                OnEva = true,
                EvaKerbalName = "Jebediah Kerman",
            });

            Assert.True(el.GetProperty("onEva").GetBoolean());
            Assert.Equal("Jebediah Kerman", el.GetProperty("evaKerbalName").GetString());
        }

        [Fact]
        public void NoEvaIsAFalseFlagAndANullName()
        {
            var el = Write(new FlightCurrent { FlightId = "f1", VesselId = "v1", VesselName = "Alpha" });

            Assert.False(el.GetProperty("onEva").GetBoolean());
            Assert.Equal(JsonValueKind.Null, el.GetProperty("evaKerbalName").ValueKind);
        }
    }
}
