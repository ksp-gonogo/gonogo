using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// An Uplink publishing a plain typed map, the shape an author reaches for first, must
    /// reach the wire as an object rather than fail on its first delivery.
    /// </summary>
    public class JsonTypedMapTests
    {
        private static JsonElement Written(object payload)
        {
            var json = EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "map",
                Payload = payload,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            });
            return JsonDocument.Parse(json).RootElement.GetProperty("payload").Clone();
        }

        [Fact]
        public void a_map_of_numbers_is_an_object()
        {
            var payload = Written(new Dictionary<string, double> { ["fuel"] = 12.5, ["oxidizer"] = 15.0 });

            Assert.Equal(12.5, payload.GetProperty("fuel").GetDouble());
            Assert.Equal(15.0, payload.GetProperty("oxidizer").GetDouble());
        }

        [Fact]
        public void a_map_of_strings_is_an_object()
        {
            var payload = Written(new Dictionary<string, string> { ["state"] = "armed" });

            Assert.Equal("armed", payload.GetProperty("state").GetString());
        }

        [Fact]
        public void a_map_with_other_keys_is_refused()
        {
            Assert.ThrowsAny<System.NotSupportedException>(() => Written(new Dictionary<int, double> { [1] = 2.0 }));
        }
    }
}
