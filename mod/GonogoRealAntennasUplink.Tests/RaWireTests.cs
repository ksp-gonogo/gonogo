using System.Text.Json;
using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The wire-shape guard for this Uplink's three private channels, following
    /// its payloads out of <c>Sitrep.Core.Tests/CommsWireTests.cs</c> (where these
    /// assertions lived as <c>RealAntennasOnlyPayloadsSerialize</c>) now that the
    /// types live in <c>GonogoRealAntennasUplink.Contract</c>.
    ///
    /// <para><b>What changed underneath them, and why the move is not cosmetic.</b>
    /// Core's <c>JsonWriter</c> used to carry a <c>case</c> and an
    /// <c>AppendComms*</c> helper per type, and this Uplink published the POCOs
    /// raw. A core serializer cannot reference an Uplink assembly, so the flatten
    /// moved to the producer (<see cref="RaWire"/>), the same publish-boundary
    /// pattern every other Uplink in this repository already used. These tests
    /// still go through the REAL <c>EnvelopeCodec.WriteStreamData</c> path, so
    /// they prove the bytes rather than the builder: what a subscriber receives is
    /// what is asserted.</para>
    ///
    /// <para>The regression they guard is the original comms.* "subscribed but no
    /// stream-data" bug: a payload with no route through <c>AppendValue</c> throws
    /// <c>NotSupportedException</c> at the wire boundary and the frame is dropped,
    /// so a subscribed client receives only "subscribed" and then silence. That is
    /// exactly what publishing the relocated POCOs raw would now do, which is why
    /// <see cref="RawPocoWouldNotSerialize"/> pins it deliberately rather than
    /// leaving it to be rediscovered.</para>
    /// </summary>
    public class RaWireTests
    {
        private static JsonElement Write(object? value)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "comms",
                Payload = value,
                Meta = new Meta
                {
                    Source = "comms",
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
        public void LinkQualitySerializesToItsCamelCaseWireShape()
        {
            var el = Write(RaWire.LinkQuality(new CommsLinkQuality { Value = 0.9, Meta = new PayloadMeta() }));

            Assert.Equal(0.9, el.GetProperty("value").GetDouble());
        }

        [Fact]
        public void DataRateSerializesBothDirections()
        {
            var el = Write(RaWire.DataRate(new CommsDataRate
            {
                UpBitsPerSec = 1000,
                DownBitsPerSec = 2000,
                Meta = new PayloadMeta(),
            }));

            Assert.Equal(1000, el.GetProperty("upBitsPerSec").GetDouble());
            Assert.Equal(2000, el.GetProperty("downBitsPerSec").GetDouble());
        }

        [Fact]
        public void LinkMarginSerializesMarginAndClosure()
        {
            var el = Write(RaWire.LinkMargin(new CommsLinkMargin
            {
                DecibelMargin = 3.5,
                ClosesLink = true,
                Meta = new PayloadMeta(),
            }));

            Assert.Equal(3.5, el.GetProperty("decibelMargin").GetDouble());
            Assert.True(el.GetProperty("closesLink").GetBoolean());
        }

        /// <summary>
        /// <c>meta</c> is the part the flatten is easiest to get subtly wrong, and
        /// the part no field assertion above would catch: it is a NESTED object
        /// whose <c>quality</c> is the enum's integer ORDINAL, not its name, which
        /// is the convention every other enum on this wire follows. A builder that
        /// wrote the name instead would serialize fine and decode to a string on a
        /// client expecting a number.
        /// </summary>
        [Fact]
        public void MetaIsNestedWithQualityAsItsOrdinal()
        {
            var el = Write(RaWire.LinkQuality(new CommsLinkQuality
            {
                Value = 0.5,
                Meta = new PayloadMeta { Source = "vessel:1", Quality = Quality.Loaded },
            }));

            var meta = el.GetProperty("meta");
            Assert.Equal(JsonValueKind.Object, meta.ValueKind);
            Assert.Equal("vessel:1", meta.GetProperty("source").GetString());
            Assert.Equal((int)Quality.Loaded, meta.GetProperty("quality").GetInt32());
        }

        /// <summary>
        /// The link-DOWN payloads go through the same flatten. They are the ones
        /// most likely to be missed by a future change, because they are built in a
        /// different file (<see cref="RaLinkDown"/>) from the live-link path.
        /// </summary>
        [Fact]
        public void LinkDownPayloadsSerializeThroughTheSameFlatten()
        {
            var margin = Write(RaWire.LinkMargin(RaLinkDown.LinkMargin("vessel:1")));
            Assert.False(margin.GetProperty("closesLink").GetBoolean());
            Assert.Equal(0.0, margin.GetProperty("decibelMargin").GetDouble());

            var rate = Write(RaWire.DataRate(RaLinkDown.DataRate("vessel:1")));
            Assert.Equal(0.0, rate.GetProperty("upBitsPerSec").GetDouble());
            Assert.Equal(0.0, rate.GetProperty("downBitsPerSec").GetDouble());

            var quality = Write(RaWire.LinkQuality(RaLinkDown.LinkQuality("vessel:1")));
            Assert.Equal(0.0, quality.GetProperty("value").GetDouble());
        }

        /// <summary>
        /// The reason <see cref="RaWire"/> is not optional, pinned as a test rather
        /// than left as a comment. Now that these types live outside
        /// <c>Sitrep.Contract</c>, core's serializer has no case for them and the
        /// POCO falls through to <c>AppendValue</c>'s default branch. Publishing one
        /// raw would throw here instead of on the Courier thread in flight, where
        /// the symptom is a silently dead channel.
        /// </summary>
        [Fact]
        public void RawPocoWouldNotSerialize() =>
            Assert.ThrowsAny<System.Exception>(
                () => Write(new CommsLinkQuality { Value = 0.9, Meta = new PayloadMeta() }));
    }
}
