using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <c>flight.ended</c> through the real stream-data wire path, including the craft a
    /// docked flight joined.
    /// </summary>
    public class FlightEndedWireTests
    {
        private static JsonElement Write(FlightEnded ended)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "flight.ended",
                Payload = ended,
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
        public void ADockedFlightCarriesTheCraftItJoined()
        {
            var el = Write(new FlightEnded
            {
                FlightId = "f1",
                VesselId = "v1",
                VesselName = "Bravo",
                Reason = FlightEndReason.Docked,
                Ut = 9.0,
                JoinedVesselId = "v2",
                JoinedVesselName = "Alpha",
            });

            Assert.Equal((int)FlightEndReason.Docked, el.GetProperty("reason").GetInt32());
            Assert.Equal("v2", el.GetProperty("joinedVesselId").GetString());
            Assert.Equal("Alpha", el.GetProperty("joinedVesselName").GetString());
        }

        [Fact]
        public void AnyOtherEndCarriesNullForTheJoinedCraft()
        {
            var el = Write(new FlightEnded
            {
                FlightId = "f1",
                VesselId = "v1",
                VesselName = "Bravo",
                Reason = FlightEndReason.Crashed,
                Ut = 9.0,
            });

            Assert.Equal(JsonValueKind.Null, el.GetProperty("joinedVesselId").ValueKind);
            Assert.Equal(JsonValueKind.Null, el.GetProperty("joinedVesselName").ValueKind);
        }
    }
}
