using System.Collections.Generic;
using System.Text.Json;
using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The wire shape of <c>realantennas.antennas</c>, through the REAL
    /// <c>EnvelopeCodec.WriteStreamData</c> path so the bytes are asserted rather
    /// than the builder. Same regression as <see cref="RaWireTests"/> guards for
    /// the other channels: a payload with no route through <c>AppendValue</c>
    /// throws at the wire boundary and the frame is dropped, so a subscribed
    /// client receives "subscribed" and then silence.
    /// </summary>
    public class RaAntennaWireTests
    {
        private static JsonElement Write(object? value)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "realantennas.antennas",
                Payload = value,
                Meta = new Meta
                {
                    Source = "vessel:1",
                    ValidAt = 0,
                    Seq = 1,
                    DeliveredAt = 0,
                    Vantage = "v",
                    Quality = Quality.Loaded,
                    Active = true,
                    Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            };
            using var doc = JsonDocument.Parse(EnvelopeCodec.WriteStreamData(msg));
            return doc.RootElement.GetProperty("payload").Clone();
        }

        private static RealAntennasAntennaState Dish() => new RealAntennasAntennaState
        {
            AntennaId = "4021/0",
            Index = 0,
            Name = "HG-55 High Gain Antenna",
            Steerable = true,
            Targeted = true,
            Gain = 34.5,
            TechLevel = 4,
            Beamwidth = 2.5,
            Cone3Db = 1.25,
            Cone10Db = 2.5,
            MinimumDistance = 22903.0,
            TargetKind = "BodyLatLonAlt",
            TargetLabel = "Kerbin:(0.00:0.00:-600000)",
            TargetBodyName = "Kerbin",
            TargetLatitude = 0.0,
            TargetLongitude = 0.0,
            TargetAltitude = -600000.0,
            AvailableTargetModes = new[] { "Vessel", "BodyCenter", "BodyLatLonAlt", "AzEl", "OrbitRelative" },
            Meta = new PayloadMeta { Source = "vessel:1", Quality = Quality.Loaded },
        };

        /// <summary>The channel value is a bare ARRAY, like realantennas.hopRates beside it.</summary>
        [Fact]
        public void ChannelValueIsABareArray()
        {
            var el = Write(RaWire.Antennas(new[] { Dish() }));

            Assert.Equal(JsonValueKind.Array, el.ValueKind);
            Assert.Equal(1, el.GetArrayLength());
        }

        [Fact]
        public void AntennaSerializesToItsCamelCaseWireShape()
        {
            var el = Write(RaWire.Antennas(new[] { Dish() }))[0];

            Assert.Equal("4021/0", el.GetProperty("antennaId").GetString());
            Assert.Equal(0, el.GetProperty("index").GetInt32());
            Assert.Equal("HG-55 High Gain Antenna", el.GetProperty("name").GetString());
            Assert.True(el.GetProperty("steerable").GetBoolean());
            Assert.True(el.GetProperty("targeted").GetBoolean());
            Assert.Equal(34.5, el.GetProperty("gain").GetDouble());
            Assert.Equal(4, el.GetProperty("techLevel").GetInt32());
            Assert.Equal(2.5, el.GetProperty("beamwidth").GetDouble());
            Assert.Equal(1.25, el.GetProperty("cone3Db").GetDouble());
            Assert.Equal(2.5, el.GetProperty("cone10Db").GetDouble());
            Assert.Equal("BodyLatLonAlt", el.GetProperty("targetKind").GetString());
            Assert.Equal("Kerbin", el.GetProperty("targetBodyName").GetString());
            Assert.Equal(-600000.0, el.GetProperty("targetAltitude").GetDouble());
        }

        /// <summary>
        /// The mode list is what lets a client offer only what this install's
        /// tech-level table actually allows, so it has to survive as an array of
        /// strings rather than collapse to one joined value.
        /// </summary>
        [Fact]
        public void AvailableTargetModesIsAnArrayOfStrings()
        {
            var el = Write(RaWire.Antennas(new[] { Dish() }))[0].GetProperty("availableTargetModes");

            Assert.Equal(JsonValueKind.Array, el.ValueKind);
            Assert.Equal(5, el.GetArrayLength());
            Assert.Equal("Vessel", el[0].GetString());
        }

        /// <summary>
        /// An unread beamwidth and a beamwidth of zero are different facts and only
        /// one of them is ever true of an antenna, so absence stays null on the
        /// wire rather than collapsing to a number a client would read as real.
        /// </summary>
        [Fact]
        public void UnreadableQuantitiesStayNullRatherThanBecomingZero()
        {
            var el = Write(RaWire.Antennas(new[]
            {
                new RealAntennasAntennaState { AntennaId = "index/0", Meta = new PayloadMeta() },
            }))[0];

            Assert.Equal(JsonValueKind.Null, el.GetProperty("gain").ValueKind);
            Assert.Equal(JsonValueKind.Null, el.GetProperty("beamwidth").ValueKind);
            Assert.Equal(JsonValueKind.Null, el.GetProperty("techLevel").ValueKind);
            Assert.Equal(JsonValueKind.Null, el.GetProperty("targetKind").ValueKind);
            Assert.Equal(JsonValueKind.Null, el.GetProperty("targetLabel").ValueKind);
        }

        /// <summary>
        /// An empty list is a real answer, not typed absence: the channel is
        /// LossyLatest, so withholding it on a craft with no antennas would leave
        /// the PREVIOUS craft's antennas standing on the wire.
        /// </summary>
        [Fact]
        public void EmptyListSerializesAsAnEmptyArray()
        {
            var el = Write(RaWire.Antennas(new List<RealAntennasAntennaState>()));

            Assert.Equal(JsonValueKind.Array, el.ValueKind);
            Assert.Equal(0, el.GetArrayLength());
        }

        [Fact]
        public void MetaIsNestedWithQualityAsItsOrdinal()
        {
            var meta = Write(RaWire.Antennas(new[] { Dish() }))[0].GetProperty("meta");

            Assert.Equal(JsonValueKind.Object, meta.ValueKind);
            Assert.Equal("vessel:1", meta.GetProperty("source").GetString());
            Assert.Equal((int)Quality.Loaded, meta.GetProperty("quality").GetInt32());
        }

        /// <summary>
        /// The regression the flatten exists for, pinned in the failing direction:
        /// publishing the POCO raw reaches AppendValue's default branch and throws
        /// at the wire boundary, which is silence on a subscribed channel rather
        /// than an error a client can see.
        /// </summary>
        [Fact]
        public void RawPocoWouldNotSerialize() =>
            Assert.ThrowsAny<System.Exception>(() => Write(new[] { Dish() }));
    }
}
