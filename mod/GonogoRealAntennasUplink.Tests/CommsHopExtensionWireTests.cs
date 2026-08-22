using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The SERVER half of the CommsHop provider-extension proof: RealAntennas fills
    /// its own namespace of a hop's bag and the REAL wire writer carries it, riding
    /// the core <c>comms.path</c> channel.
    ///
    /// <para>Goes through <see cref="EnvelopeCodec.WriteStreamData"/>, the same call
    /// the courier makes, because the claim is about the WIRE: a namespaced sub-tree
    /// core has never heard of survives serialisation, and a hop nobody extended is
    /// byte-for-byte unchanged. The committed fixture
    /// <c>mod/golden-fixtures/commshop-extensions.json</c> is what the client's
    /// <c>hopExt.test.ts</c> reads back through the real decode path, so neither
    /// side can drift without one going red.</para>
    /// </summary>
    public class CommsHopExtensionWireTests
    {
        private static readonly string FixturePath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "commshop-extensions.json");

        private static string FixtureWire(string name)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(FixturePath));
            foreach (var vector in doc.RootElement.EnumerateArray())
            {
                if (vector.GetProperty("name").GetString() == name)
                {
                    return vector.GetProperty("json").GetString()!;
                }
            }

            throw new InvalidOperationException(
                "No fixture vector named '" + name + "' in " + FixturePath);
        }

        private static Meta FixedMeta() => new()
        {
            Source = "vessel-1",
            ValidAt = 120.5,
            Seq = 7,
            DeliveredAt = 122.75,
            Vantage = "KSC",
            Quality = Quality.OnRails,
            Active = true,
            Staleness = Staleness.Fresh,
            TimelineEpoch = 0,
        };

        /// <summary>A hop carrying the RA namespace, mirroring what RaHopExtensions builds.</summary>
        private static CommsPath PathWithRaHop() => new()
        {
            Hops = new List<CommsHop>
            {
                new CommsHop
                {
                    From = "vessel",
                    To = "home",
                    ToIsHome = true,
                    Kind = CommsHopKind.Home,
                    DistanceMeters = 1234.5,
                    Extensions = new Dictionary<string, object?>
                    {
                        ["realantennas"] = new Dictionary<string, object?>
                        {
                            ["band"] = "X",
                            ["techLevel"] = 7,
                            ["modulationBits"] = 4,
                            ["encoder"] = "Reed-Solomon 255/223",
                            ["codingRate"] = 0.8745,
                            ["requiredEbN0"] = 6.1,
                            ["beamwidth"] = 12.5,
                            ["powerDrawEc"] = 3.25,
                            ["reverseBitsPerSec"] = 9600.0,
                        },
                    },
                },
            },
            Meta = new PayloadMeta { Source = "vessel:1", Quality = Quality.Loaded },
        };

        private static string WritePath(CommsPath path) =>
            EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "comms.path",
                Payload = path,
                Meta = FixedMeta(),
            });

        [Fact]
        public void TheRealAntennasNamespaceReachesTheWireThroughTheRealCodec()
        {
            var json = WritePath(PathWithRaHop());

            Assert.Contains("\"extensions\":{\"realantennas\":{", json);
            Assert.Contains("\"band\":\"X\"", json);
            Assert.Contains("\"requiredEbN0\":6.1", json);
            Assert.Contains("\"reverseBitsPerSec\":9600", json);
        }

        [Fact]
        public void TheCommittedFixtureIsExactlyWhatTheCodecProduces()
        {
            var expected = FixtureWire("path-with-realantennas-hop");
            var actual = WritePath(PathWithRaHop());

            Assert.Equal(expected, actual);
        }

        /// <summary>
        /// The additive claim as bytes: a hop no provider extended carries EXACTLY
        /// the core members and nothing else. The <c>extensions</c> key is omitted,
        /// not written as null, so a bare-CommNet subscriber cannot tell the
        /// mechanism landed.
        /// </summary>
        [Fact]
        public void AnUnextendedHopCarriesTheCoreMembersAndNothingElse()
        {
            var json = WritePath(new CommsPath
            {
                Hops = new List<CommsHop>
                {
                    new CommsHop
                    {
                        From = "vessel",
                        To = "home",
                        ToIsHome = true,
                        Kind = CommsHopKind.Home,
                        DistanceMeters = 1234.5,
                    },
                },
                Meta = new PayloadMeta { Source = "vessel:1", Quality = Quality.Loaded },
            });

            Assert.DoesNotContain("extensions", json);
            Assert.Contains(
                "\"hops\":[{\"from\":\"vessel\",\"to\":\"home\"," +
                "\"fromIsHome\":false,\"toIsHome\":true,\"kind\":0," +
                "\"distanceMeters\":1234.5}]",
                json);
        }
    }
}
