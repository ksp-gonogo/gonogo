using System.Collections.Generic;
using System.Text.Json;
using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The wire shape of <c>realantennas.antennaChains</c>, through the REAL
    /// <c>EnvelopeCodec.WriteStreamData</c> path so the bytes are asserted rather
    /// than the builder.
    ///
    /// <para>It matters more here than for this Uplink's flat channels because
    /// this is the first payload in the slice that NESTS: each entry carries its
    /// own array of objects. A value with no route through the codec throws at the
    /// wire boundary and the frame is dropped, so a subscribed client receives
    /// "subscribed" and then silence, which for a fallback chain would read as the
    /// craft having no chains at all.</para>
    /// </summary>
    public class RaChainWireTests
    {
        private static JsonElement Write(object? value)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "realantennas.antennaChains",
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

        private static RealAntennasAntennaChain Chain() => new RealAntennasAntennaChain
        {
            AntennaId = "4021/0",
            Steps = new[]
            {
                new RealAntennasTargetStep { Mode = "BodyCenter" },
                new RealAntennasTargetStep
                {
                    Mode = "BodyLatLonAlt",
                    BodyName = "Mun",
                    Latitude = -0.5,
                    Longitude = 121.25,
                    Altitude = 1500.0,
                },
            },
            ActiveStep = 1,
            State = RaChainPolicy.StateSettling,
            Detail = "Waiting to see whether the target in place gives the craft a link.",
            SettleSeconds = 30.0,
            LastAppliedUt = 9001.5,
            Laps = 2,
            Connected = false,
            Carrying = false,
            Meta = new PayloadMeta { Source = "vessel:1", Quality = Quality.Loaded },
        };

        /// <summary>The channel value is a bare ARRAY, like the two channels beside it.</summary>
        [Fact]
        public void ChannelValueIsABareArray()
        {
            var payload = Write(RaWire.Chains(new[] { Chain() }));

            Assert.Equal(JsonValueKind.Array, payload.ValueKind);
            Assert.Equal(1, payload.GetArrayLength());
        }

        [Fact]
        public void EveryFieldReachesTheWireUnderItsCamelCaseName()
        {
            var entry = Write(RaWire.Chains(new[] { Chain() }))[0];

            Assert.Equal("4021/0", entry.GetProperty("antennaId").GetString());
            Assert.Equal(1, entry.GetProperty("activeStep").GetInt32());
            Assert.Equal(RaChainPolicy.StateSettling, entry.GetProperty("state").GetString());
            Assert.Equal(30.0, entry.GetProperty("settleSeconds").GetDouble());
            Assert.Equal(9001.5, entry.GetProperty("lastAppliedUt").GetDouble());
            Assert.Equal(2, entry.GetProperty("laps").GetInt32());
            Assert.False(entry.GetProperty("connected").GetBoolean());
            Assert.False(entry.GetProperty("carrying").GetBoolean());
            Assert.NotNull(entry.GetProperty("detail").GetString());
            Assert.Equal("vessel:1", entry.GetProperty("meta").GetProperty("source").GetString());
        }

        /// <summary>
        /// The entries nest as objects inside each chain, in the order the craft
        /// tries them. Order is the whole meaning of the list: an unordered chain
        /// is a set of targets and not a fallback.
        /// </summary>
        [Fact]
        public void TheEntriesNestInTheOrderTheCraftTriesThem()
        {
            var steps = Write(RaWire.Chains(new[] { Chain() }))[0].GetProperty("steps");

            Assert.Equal(JsonValueKind.Array, steps.ValueKind);
            Assert.Equal(2, steps.GetArrayLength());
            Assert.Equal("BodyCenter", steps[0].GetProperty("mode").GetString());
            Assert.Equal("BodyLatLonAlt", steps[1].GetProperty("mode").GetString());
            Assert.Equal("Mun", steps[1].GetProperty("bodyName").GetString());
            Assert.Equal(-0.5, steps[1].GetProperty("latitude").GetDouble());
            Assert.Equal(1500.0, steps[1].GetProperty("altitude").GetDouble());
        }

        /// <summary>
        /// The three fields that carry three answers each stay NULL on the wire
        /// rather than collapsing. A walk that has never started is not a walk on
        /// its first entry, and an unread link is not a lost one: the walk itself
        /// refuses to move on the third answer, so a client must be able to see
        /// it.
        /// </summary>
        [Fact]
        public void AnUnstartedWalkAndAnUnreadLinkStayNullRatherThanCollapsing()
        {
            var chain = Chain();
            chain.ActiveStep = null;
            chain.LastAppliedUt = null;
            chain.Connected = null;
            chain.Carrying = null;

            var entry = Write(RaWire.Chains(new[] { chain }))[0];

            Assert.Equal(JsonValueKind.Null, entry.GetProperty("activeStep").ValueKind);
            Assert.Equal(JsonValueKind.Null, entry.GetProperty("lastAppliedUt").ValueKind);
            Assert.Equal(JsonValueKind.Null, entry.GetProperty("connected").ValueKind);
            Assert.Equal(JsonValueKind.Null, entry.GetProperty("carrying").ValueKind);
        }

        /// <summary>
        /// An empty list is a legitimate value, not typed absence: the channel is
        /// LossyLatest, so withholding it on a craft with no chains would leave
        /// the previous craft's standing on the wire.
        /// </summary>
        [Fact]
        public void ACraftWithNoChainsPublishesAnEmptyArray()
        {
            var payload = Write(RaWire.Chains(new List<RealAntennasAntennaChain>()));

            Assert.Equal(JsonValueKind.Array, payload.ValueKind);
            Assert.Equal(0, payload.GetArrayLength());
        }

        /// <summary>
        /// A chain with no entries still serialises its empty array rather than a
        /// null, so a client iterating it needs no guard. The register never
        /// stores one, which is why this is asserted at the wire rather than left
        /// to that invariant.
        /// </summary>
        [Fact]
        public void AChainWithNoEntriesCarriesAnEmptyArrayRatherThanNull()
        {
            var chain = Chain();
            chain.Steps = new RealAntennasTargetStep[0];

            var steps = Write(RaWire.Chains(new[] { chain }))[0].GetProperty("steps");

            Assert.Equal(JsonValueKind.Array, steps.ValueKind);
            Assert.Equal(0, steps.GetArrayLength());
        }
    }
}
