using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Regression guard for the comms.* "subscribed but no stream-data" bug:
    /// every comms.* payload type except <see cref="CommsDelay"/> had NO
    /// <see cref="JsonWriter.AppendValue"/> case, so a POPULATED payload threw
    /// <c>NotSupportedException</c> at the wire boundary and the frame was
    /// dropped: a client subscribed comms.connectivity / comms.path /
    /// comms.network / comms.signalStrength but received only "subscribed" and
    /// zero data. Same class of bug the <see cref="CommsDelay"/> /
    /// <see cref="KosProcessorInfo"/> flattens already fixed. These serialize
    /// through the real stream-data wire path and assert nothing throws plus the
    /// decoded camelCase shape.
    /// </summary>
    public class CommsWireTests
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
        public void ConnectivitySerializesToCamelCaseWireShape()
        {
            var el = Write(new CommsConnectivity
            {
                Connected = true,
                ControlSource = CommsControlSource.Full,
                HasLocalControl = false,
                Meta = new PayloadMeta { Source = "vessel:1", Quality = Quality.Loaded },
            });

            Assert.True(el.GetProperty("connected").GetBoolean());
            Assert.Equal((int)CommsControlSource.Full, el.GetProperty("controlSource").GetInt32());
            Assert.False(el.GetProperty("hasLocalControl").GetBoolean());
            Assert.Equal("vessel:1", el.GetProperty("meta").GetProperty("source").GetString());
            Assert.Equal((int)Quality.Loaded, el.GetProperty("meta").GetProperty("quality").GetInt32());
        }

        [Fact]
        public void SignalStrengthSerializes()
        {
            var el = Write(new CommsSignalStrength { Value = 0.75, Meta = new PayloadMeta() });
            Assert.Equal(0.75, el.GetProperty("value").GetDouble());
            Assert.Equal(JsonValueKind.Object, el.GetProperty("meta").ValueKind);
        }

        [Fact]
        public void ControlStateReasonNullSerializesAsJsonNull()
        {
            var el = Write(new CommsControlState
            {
                State = CommsControlStateKind.Full,
                Reason = null,
                Meta = new PayloadMeta(),
            });
            Assert.Equal((int)CommsControlStateKind.Full, el.GetProperty("state").GetInt32());
            Assert.Equal(JsonValueKind.Null, el.GetProperty("reason").ValueKind);
        }

        [Fact]
        public void ControlStateReasonPresentSerializesAsString()
        {
            var el = Write(new CommsControlState
            {
                State = CommsControlStateKind.PartialManoeuvre,
                Reason = "partial",
                Meta = new PayloadMeta(),
            });
            Assert.Equal("partial", el.GetProperty("reason").GetString());
        }

        [Fact]
        public void PathWithHopsSerializesNestedList()
        {
            var el = Write(new CommsPath
            {
                Hops = new List<CommsHop>
                {
                    new CommsHop
                    {
                        From = "vessel", To = "ksc", Kind = CommsHopKind.Home,
                        DistanceMeters = 1234.5, BandRateBitsPerSec = null,
                    },
                    new CommsHop
                    {
                        From = "relay", To = "ksc", Kind = CommsHopKind.Relay,
                        DistanceMeters = null, BandRateBitsPerSec = 9600,
                    },
                },
                Meta = new PayloadMeta(),
            });

            var hops = el.GetProperty("hops");
            Assert.Equal(JsonValueKind.Array, hops.ValueKind);
            Assert.Equal(2, hops.GetArrayLength());
            Assert.Equal("vessel", hops[0].GetProperty("from").GetString());
            Assert.Equal(1234.5, hops[0].GetProperty("distanceMeters").GetDouble());
            Assert.Equal(JsonValueKind.Null, hops[0].GetProperty("bandRateBitsPerSec").ValueKind);
            Assert.Equal(JsonValueKind.Null, hops[1].GetProperty("distanceMeters").ValueKind);
            Assert.Equal(9600, hops[1].GetProperty("bandRateBitsPerSec").GetDouble());
        }

        [Fact]
        public void EmptyPathSerializesAsEmptyArray()
        {
            var el = Write(new CommsPath { Hops = new List<CommsHop>(), Meta = new PayloadMeta() });
            Assert.Equal(0, el.GetProperty("hops").GetArrayLength());
        }

        [Fact]
        public void NetworkSerializesNodesAndEdges()
        {
            var el = Write(new CommsNetwork
            {
                Nodes = new List<CommsNetworkNode>
                {
                    new CommsNetworkNode { Id = "ksc", Kind = CommsHopKind.Home },
                    new CommsNetworkNode { Id = "vessel", Kind = CommsHopKind.Vessel },
                },
                Edges = new List<CommsNetworkEdge>
                {
                    new CommsNetworkEdge { A = "ksc", B = "vessel", Active = true },
                },
                Meta = new PayloadMeta(),
            });

            Assert.Equal(2, el.GetProperty("nodes").GetArrayLength());
            Assert.Equal("ksc", el.GetProperty("nodes")[0].GetProperty("id").GetString());
            Assert.Equal(1, el.GetProperty("edges").GetArrayLength());
            Assert.True(el.GetProperty("edges")[0].GetProperty("active").GetBoolean());
        }

        [Fact]
        public void DelaySerializesOneWaySecondsAsNumberWhenComputed()
        {
            var el = Write(new CommsDelay
            {
                OneWaySeconds = 3.8,
                Source = CommsDelaySource.SignalDelay,
                Meta = new PayloadMeta { Source = "vessel:1", Quality = Quality.Loaded },
            });

            Assert.Equal(3.8, el.GetProperty("oneWaySeconds").GetDouble());
            Assert.Equal((int)CommsDelaySource.SignalDelay, el.GetProperty("source").GetInt32());
        }

        [Fact]
        public void DelaySerializesOneWaySecondsAsJsonNullWhenNoMeasurablePath()
        {
            // R7 typed absence: no path home is null, NEVER the 0 sentinel
            // (comms-delay-nullable-when-no-path.md).
            var el = Write(new CommsDelay
            {
                OneWaySeconds = null,
                Source = CommsDelaySource.None,
                Meta = new PayloadMeta(),
            });

            Assert.Equal(JsonValueKind.Null, el.GetProperty("oneWaySeconds").ValueKind);
            Assert.Equal((int)CommsDelaySource.None, el.GetProperty("source").GetInt32());
        }

        [Fact]
        public void DelaySerializesOneWaySecondsAsZeroWhenDisabledButConnected()
        {
            // The OTHER "None" case: delay feature off, vessel still
            // connected: a real "zero applied", distinguishable from the
            // no-path null case above only by this value.
            var el = Write(new CommsDelay
            {
                OneWaySeconds = 0.0,
                Source = CommsDelaySource.None,
                Meta = new PayloadMeta(),
            });

            Assert.Equal(JsonValueKind.Number, el.GetProperty("oneWaySeconds").ValueKind);
            Assert.Equal(0.0, el.GetProperty("oneWaySeconds").GetDouble());
        }

        // RealAntennasOnlyPayloadsSerialize stood here, covering the three
        // provider-private payloads (linkQuality/dataRate/linkMargin). Those types
        // moved into GonogoRealAntennasUplink.Contract, and with them the
        // hand-written serializer cases they needed: their producer flattens them
        // at the publish boundary now, so core writes them through the plain
        // dictionary path and has no type to name. Their assertions followed them
        // to that Uplink's own RaWireTests, still going through this same real
        // EnvelopeCodec route.

        [Fact]
        public void DefaultConstructedPayloadsDoNotThrow()
        {
            // The capture bundles default-constructed payloads pre-election; each
            // must serialize (not throw) through the real wire path.
            Write(new CommsConnectivity());
            Write(new CommsSignalStrength());
            Write(new CommsControlState());
            Write(new CommsPath());
            Write(new CommsNetwork());
        }

        [Fact]
        public void NonEmptyListOfPayloadsSerializesViaArrayPath()
        {
            // Guards the IEnumerable -> AppendArray -> AppendValue element path
            // (the exact route a list-valued channel takes), proving each element
            // hits its new case rather than the NotSupportedException default.
            var el = Write(new List<CommsConnectivity>
            {
                new CommsConnectivity { Connected = true },
                new CommsConnectivity { Connected = false },
            });
            Assert.Equal(JsonValueKind.Array, el.ValueKind);
            Assert.Equal(2, el.GetArrayLength());
            Assert.True(el[0].GetProperty("connected").GetBoolean());
        }
    }
}
