using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the R6 revert-availability capture-add's
    /// <see cref="SystemViewProvider.BuildRevertAvailability"/>: a fake
    /// <see cref="KspSnapshot"/> carrying the raw <c>"revert"</c> encoding
    /// (<c>Gonogo.KSP.KspHost.BuildRevertAvailability</c>'s two bools, read
    /// from <c>FlightDriver.CanRevertToPrelaunch</c>/<c>CanRevertToPostInit</c>)
    /// is mapped to the <c>ksp.revertAvailability</c> payload and asserted
    /// against the class doc's rules — the "not in flight" (no <c>"revert"</c>
    /// key at all) → null guard, the two-plain-bools shape, missing bool →
    /// <c>false</c> (never offer a revert we can't confirm), and the payload
    /// serializing cleanly through the REAL production path.
    /// </summary>
    public class RevertAvailabilityProviderTests
    {
        [Fact]
        public void BuildRevertAvailabilityReturnsNullWhenSnapshotHasNoRevertKeyAtAll()
        {
            // The out-of-flight case: KspHost only adds a "revert" key in the
            // flight scene - the provider must treat its absence as "not in
            // flight," not fabricate an all-false payload.
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(SystemViewProvider.BuildRevertAvailability(snapshot));
        }

        [Fact]
        public void BuildRevertAvailabilityReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(SystemViewProvider.BuildRevertAvailability(null));
        }

        [Fact]
        public void BuildRevertAvailabilityMapsBothBoolsAndSerializesThroughTheRealPath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 4321.0,
                Values = new Dictionary<string, object?>
                {
                    // Just launched, still on the pad: both reverts available.
                    ["revert"] = new Dictionary<string, object?>
                    {
                        ["canRevertToEditor"] = true,
                        ["canRevertToLaunch"] = true,
                    },
                },
            };

            var payload = SystemViewProvider.BuildRevertAvailability(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            Assert.Equal(true, root["canRevertToEditor"]);
            Assert.Equal(true, root["canRevertToLaunch"]);

            // Serializes cleanly through the REAL production path: dropped
            // straight into a StreamData<object?>.Payload and encoded with the
            // existing Sitrep.Core EnvelopeCodec/JsonWriter, round-tripping to
            // an equivalent tree.
            var streamData = new StreamData<object?>
            {
                Topic = SystemViewProvider.RevertTopic,
                Payload = payload,
                Meta = new Meta
                {
                    Source = "system",
                    ValidAt = snapshot.Ut,
                    Seq = 1,
                    DeliveredAt = snapshot.Ut,
                    Vantage = "host",
                    Quality = Quality.Loaded,
                    Active = true,
                    Staleness = Staleness.Fresh,
                },
            };

            var json = EnvelopeCodec.WriteStreamData(streamData);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            Assert.Equal(SystemViewProvider.RevertTopic, parsed.Topic);
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal(true, parsedRoot["canRevertToEditor"]);
            Assert.Equal(true, parsedRoot["canRevertToLaunch"]);
        }

        [Fact]
        public void BuildRevertAvailabilityCarriesAFalseFlagAsAConcreteFalseNotNull()
        {
            // Mid-flight, well past launch: can still bail to the editor but no
            // longer to launch. A false flag is meaningful ("this revert is
            // genuinely unavailable"), so it must ride the wire as a concrete
            // false, never null.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["revert"] = new Dictionary<string, object?>
                    {
                        ["canRevertToEditor"] = true,
                        ["canRevertToLaunch"] = false,
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildRevertAvailability(snapshot));
            Assert.Equal(true, root["canRevertToEditor"]);
            Assert.Equal(false, root["canRevertToLaunch"]);
        }

        [Fact]
        public void BuildRevertAvailabilityDefaultsAMissingFlagToFalseNotNull()
        {
            // A present-but-partial group (a flag genuinely absent from the raw
            // dict) defaults to false - never offer a revert we can't confirm
            // is available - and the wire shape stays two plain bools.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["revert"] = new Dictionary<string, object?>
                    {
                        ["canRevertToEditor"] = true,
                        // canRevertToLaunch omitted entirely
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildRevertAvailability(snapshot));
            Assert.Equal(true, root["canRevertToEditor"]);
            Assert.Equal(false, root["canRevertToLaunch"]);
        }

        // ----------------------------------------------------------------
        // Contract-shape mirror: the named Sitrep.Contract payload type
        // (RevertAvailability) exists so a widget resolves a real payload type
        // instead of `unknown`. It is TYPING-ONLY (JsonWriter walks the
        // provider's live value tree, not the POCO), so this test binds the
        // two at run time: every field the provider puts on the wire must
        // equal the camelCased public-property set of the contract type, and
        // no more - so a `meta` key or a rename on either side fails here.
        // ----------------------------------------------------------------

        private static string CamelCase(string pascal) =>
            pascal.Length == 0 ? pascal : char.ToLowerInvariant(pascal[0]) + pascal.Substring(1);

        private static HashSet<string> WireFieldNamesOf(System.Type contractType) =>
            contractType
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(p => CamelCase(p.Name))
                .ToHashSet();

        [Fact]
        public void RevertAvailabilityContractTypeMirrorsTheProviderWireShapeExactly()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["revert"] = new Dictionary<string, object?>
                    {
                        ["canRevertToEditor"] = true,
                        ["canRevertToLaunch"] = false,
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildRevertAvailability(snapshot));

            Assert.Equal(WireFieldNamesOf(typeof(RevertAvailability)), root.Keys.ToHashSet());

            // A `meta` key must never creep onto this system-uplink payload.
            Assert.DoesNotContain("meta", root.Keys);
        }
    }
}
