using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The <c>isru.*</c> payloads through the REAL stream-data wire path. Both
    /// topics publish a bare <c>List&lt;T&gt;</c> raw, so without a
    /// <see cref="JsonWriter.AppendValue"/> case per element type a populated
    /// payload throws <c>NotSupportedException</c> at the wire boundary and a
    /// subscriber sees "subscribed" and then nothing: the same
    /// silently-dropped-frame bug <see cref="CommsWireTests"/> guards for comms.
    /// The converter case nests a second level (its two recipe sides), so it needs
    /// its element type covered too, not just the entry.
    /// </summary>
    public class IsruWireTests
    {
        private static JsonElement Write(string topic, object? value)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = topic,
                Payload = value,
                Meta = new Meta
                {
                    Source = "isru",
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
        public void DrillsSerializeToCamelCaseWireShape()
        {
            var el = Write("isru.drills", new List<IsruDrillEntry>
            {
                new IsruDrillEntry
                {
                    PartId = "12345",
                    PartTitle = "Drill-O-Matic",
                    Resource = "Ore",
                    Deployed = true,
                    Running = true,
                    Abundance = 0.075,
                    Rate = 1.25,
                },
            });

            Assert.Equal(1, el.GetArrayLength());
            var drill = el[0];
            Assert.Equal("12345", drill.GetProperty("partId").GetString());
            Assert.Equal("Drill-O-Matic", drill.GetProperty("partTitle").GetString());
            Assert.Equal("Ore", drill.GetProperty("resource").GetString());
            Assert.True(drill.GetProperty("deployed").GetBoolean());
            Assert.True(drill.GetProperty("running").GetBoolean());
            Assert.Equal(0.075, drill.GetProperty("abundance").GetDouble(), 6);
            Assert.Equal(1.25, drill.GetProperty("rate").GetDouble(), 6);
        }

        /// <summary>
        /// An absent field is a JSON null, never a missing key: a reader
        /// distinguishes "this backend has no abundance concept for this harvest
        /// type" from "this field does not exist in this contract version".
        /// </summary>
        [Fact]
        public void AbsentDrillFieldsAreNullRatherThanOmitted()
        {
            var drill = Write("isru.drills", new List<IsruDrillEntry> { new IsruDrillEntry() })[0];

            Assert.Equal(JsonValueKind.Null, drill.GetProperty("abundance").ValueKind);
            Assert.Equal(JsonValueKind.Null, drill.GetProperty("deployed").ValueKind);
            Assert.Equal(JsonValueKind.Null, drill.GetProperty("resource").ValueKind);
        }

        [Fact]
        public void ConvertersSerializeTheirRecipeBothSides()
        {
            var el = Write("isru.converters", new List<IsruConverterEntry>
            {
                new IsruConverterEntry
                {
                    PartId = "678",
                    PartTitle = "Convert-O-Tron 250",
                    Running = true,
                    Inputs =
                    {
                        new IsruResourceFlow { Resource = "Ore", Rate = 0.5 },
                        new IsruResourceFlow { Resource = "ElectricCharge", Rate = 30.0 },
                    },
                    Outputs = { new IsruResourceFlow { Resource = "LiquidFuel", Rate = 0.45 } },
                },
            });

            var converter = el[0];
            Assert.Equal("678", converter.GetProperty("partId").GetString());
            Assert.True(converter.GetProperty("running").GetBoolean());

            var inputs = converter.GetProperty("inputs");
            Assert.Equal(2, inputs.GetArrayLength());
            Assert.Equal("Ore", inputs[0].GetProperty("resource").GetString());
            Assert.Equal(0.5, inputs[0].GetProperty("rate").GetDouble(), 6);
            Assert.Equal("ElectricCharge", inputs[1].GetProperty("resource").GetString());

            var outputs = converter.GetProperty("outputs");
            Assert.Equal(1, outputs.GetArrayLength());
            Assert.Equal("LiquidFuel", outputs[0].GetProperty("resource").GetString());
            Assert.Equal(0.45, outputs[0].GetProperty("rate").GetDouble(), 6);
        }

        /// <summary>
        /// A converter with no recipe writes empty arrays, not nulls: the contract
        /// declares both sides as non-nullable lists, and "no flows" is a fact about
        /// the part rather than a missing reading.
        /// </summary>
        [Fact]
        public void AnEmptyRecipeSerializesAsEmptyArraysNotNulls()
        {
            var converter = Write("isru.converters", new List<IsruConverterEntry> { new IsruConverterEntry() })[0];

            Assert.Equal(JsonValueKind.Array, converter.GetProperty("inputs").ValueKind);
            Assert.Equal(0, converter.GetProperty("inputs").GetArrayLength());
            Assert.Equal(JsonValueKind.Array, converter.GetProperty("outputs").ValueKind);
            Assert.Equal(0, converter.GetProperty("outputs").GetArrayLength());
        }

        /// <summary>
        /// The vanilla path leaves the bag null, and a null bag writes NO key at
        /// all. This is the additive claim the extension mechanism rests on: a
        /// payload no provider extended is byte-for-byte what it would be if the bag
        /// did not exist.
        /// </summary>
        [Fact]
        public void AnUnextendedPayloadCarriesNoExtensionsKey()
        {
            var drill = Write("isru.drills", new List<IsruDrillEntry> { new IsruDrillEntry { PartId = "1" } })[0];
            var converter = Write("isru.converters", new List<IsruConverterEntry> { new IsruConverterEntry { PartId = "1" } })[0];

            Assert.False(drill.TryGetProperty("extensions", out _));
            Assert.False(converter.TryGetProperty("extensions", out _));
        }

        /// <summary>
        /// An empty list is a legitimate reading on both topics: "this vessel has no
        /// drills", never "ISRU is not tracked". It has to survive the wire as an
        /// empty array rather than throwing or collapsing to null.
        /// </summary>
        [Fact]
        public void AnEmptyVesselSerializesAsAnEmptyArray()
        {
            var drills = Write("isru.drills", new List<IsruDrillEntry>());

            Assert.Equal(JsonValueKind.Array, drills.ValueKind);
            Assert.Equal(0, drills.GetArrayLength());
        }
    }
}
