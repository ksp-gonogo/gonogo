using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for Task 3's <see cref="SystemViewProvider"/>: a fake
    /// <see cref="KspSnapshot"/> carrying the raw <c>"bodies"</c> encoding
    /// (root star with no parent, an orbiting planet with a full orbit, and
    /// a moon MISSING a couple of raw fields) is mapped to the
    /// <c>system.bodies</c> payload and asserted against every rule in the
    /// class doc: the parent-index tree, root orbit == null, missing raw
    /// fields → null (never a sentinel), no <c>eccentricAnomaly</c> key
    /// anywhere, and the payload serializing cleanly through the REAL
    /// production path — <c>StreamData&lt;object?&gt;.Payload</c> via
    /// <c>Sitrep.Core.Serialization.EnvelopeCodec.WriteStreamData</c>/
    /// <c>ParseStreamData</c> — round-tripping to an equivalent tree.
    /// </summary>
    public class SystemViewProviderTests
    {
        [Fact]
        public void BuildSystemBodiesMapsRawBodiesToTypedTreeFixingTelemachusWarts()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 100.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        // Root star: no parentIndex at all. Deliberately carries
                        // stray orbit-shaped keys to prove the provider
                        // suppresses them for the root regardless.
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbol",
                            ["index"] = 0,
                            ["radius"] = 261_600_000.0,
                            ["sma"] = 999.0, // must be ignored: root has no parent
                        },
                        // Orbiting planet: full orbit data present.
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbin",
                            ["index"] = 1,
                            ["parentIndex"] = 0,
                            ["radius"] = 600_000.0,
                            ["sma"] = 13_599_840_256.0,
                            ["ecc"] = 0.0,
                            ["inc"] = 0.0,
                            ["lan"] = 0.0,
                            ["argPe"] = 0.0,
                            ["meanAnomalyAtEpoch"] = 3.14,
                            ["epoch"] = 0.0,
                        },
                        // Moon of Kerbin: MISSING "radius" entirely and
                        // "ecc" explicitly null — both must map to null,
                        // never a sentinel like -1 or 0.
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Mun",
                            ["index"] = 2,
                            ["parentIndex"] = 1,
                            ["ecc"] = null,
                            ["sma"] = 12_000_000.0,
                            ["inc"] = 0.0,
                            ["lan"] = 0.0,
                            ["argPe"] = 0.0,
                            ["meanAnomalyAtEpoch"] = 1.7,
                            ["epoch"] = 0.0,
                        },
                    },
                },
            };

            var payload = SystemViewProvider.BuildSystemBodies(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var bodies = Assert.IsType<List<object?>>(root["bodies"]);
            Assert.Equal(3, bodies.Count);

            var star = Assert.IsType<Dictionary<string, object?>>(bodies[0]);
            Assert.Equal("Kerbol", star["name"]);
            Assert.Equal(0, star["index"]);
            Assert.Null(star["parentIndex"]);
            Assert.Equal(261_600_000.0, star["radius"]);
            Assert.Null(star["orbit"]); // root: no junk orbit
            Assert.False(star.ContainsKey("eccentricAnomaly"));

            var planet = Assert.IsType<Dictionary<string, object?>>(bodies[1]);
            Assert.Equal("Kerbin", planet["name"]);
            Assert.Equal(1, planet["index"]);
            Assert.Equal(0, planet["parentIndex"]); // tree: Kerbin orbits body 0
            Assert.Equal(600_000.0, planet["radius"]);
            var planetOrbit = Assert.IsType<Dictionary<string, object?>>(planet["orbit"]);
            Assert.Equal(13_599_840_256.0, planetOrbit["sma"]);
            Assert.Equal(0.0, planetOrbit["ecc"]);
            Assert.Equal(3.14, planetOrbit["meanAnomalyAtEpoch"]);
            Assert.False(planetOrbit.ContainsKey("eccentricAnomaly"));

            var moon = Assert.IsType<Dictionary<string, object?>>(bodies[2]);
            Assert.Equal("Mun", moon["name"]);
            Assert.Equal(2, moon["index"]);
            Assert.Equal(1, moon["parentIndex"]); // tree: Mun orbits Kerbin (body 1)
            Assert.Null(moon["radius"]); // missing raw field -> null, not 0/-1
            var moonOrbit = Assert.IsType<Dictionary<string, object?>>(moon["orbit"]);
            Assert.Null(moonOrbit["ecc"]); // explicit-null raw field -> null
            Assert.Equal(12_000_000.0, moonOrbit["sma"]);
            Assert.False(moonOrbit.ContainsKey("eccentricAnomaly"));

            // Serializes cleanly through the REAL production path: dropped
            // straight into a StreamData<object?>.Payload and encoded with
            // the existing Sitrep.Core EnvelopeCodec/JsonWriter — no writer
            // changes needed for this payload shape.
            var streamData = new StreamData<object?>
            {
                Topic = SystemViewProvider.Topic,
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
            Assert.DoesNotContain("eccentricAnomaly", json);

            var parsed = EnvelopeCodec.ParseStreamData(json);
            Assert.Equal(SystemViewProvider.Topic, parsed.Topic);
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            var parsedBodies = Assert.IsType<List<object?>>(parsedRoot["bodies"]);
            Assert.Equal(3, parsedBodies.Count);

            var parsedStar = Assert.IsType<Dictionary<string, object?>>(parsedBodies[0]);
            Assert.Null(parsedStar["parentIndex"]);
            Assert.Null(parsedStar["orbit"]);

            var parsedMoon = Assert.IsType<Dictionary<string, object?>>(parsedBodies[2]);
            Assert.Null(parsedMoon["radius"]);
            var parsedMoonOrbit = Assert.IsType<Dictionary<string, object?>>(parsedMoon["orbit"]);
            Assert.Null(parsedMoonOrbit["ecc"]);
        }

        [Fact]
        public void BuildSystemBodiesReturnsNullWhenSnapshotHasNoBodiesYet()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(SystemViewProvider.BuildSystemBodies(snapshot));
        }

        [Fact]
        public void BuildSystemBodiesTreatsNonFiniteOrbitElementsAsAbsentNotAsNaNOnTheWire()
        {
            // Same R1/F-1 rule as vessel.orbit (VesselViewProviderTests'
            // BuildOrbitTreatsNonFiniteLanAndArgPeAsAbsentNotAsNaNOnTheWire):
            // a body with a near-equatorial/near-circular orbit can
            // genuinely have NaN lan/argPe from KSP -- this must map to
            // null, never a NaN/Infinity token on the wire, and (via the
            // shared SnapshotDict.GetDouble) it does so without needing any
            // "all required" gating here since BuildOrbit maps each element
            // independently.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbin",
                            ["index"] = 0,
                            ["parentIndex"] = null,
                        },
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Mun",
                            ["index"] = 1,
                            ["parentIndex"] = 0,
                            ["radius"] = 200_000.0,
                            ["sma"] = 12_000_000.0,
                            ["ecc"] = 0.0,
                            ["inc"] = 0.0,
                            ["lan"] = double.NaN,
                            ["argPe"] = double.PositiveInfinity,
                            ["meanAnomalyAtEpoch"] = 1.7,
                            ["epoch"] = 0.0,
                        },
                    },
                },
            };

            var payload = SystemViewProvider.BuildSystemBodies(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var bodies = Assert.IsType<List<object?>>(root["bodies"]);
            var moon = Assert.IsType<Dictionary<string, object?>>(bodies[1]);
            var moonOrbit = Assert.IsType<Dictionary<string, object?>>(moon["orbit"]);
            Assert.Null(moonOrbit["lan"]);
            Assert.Null(moonOrbit["argPe"]);
            Assert.Equal(12_000_000.0, moonOrbit["sma"]); // rest of the record unaffected

            var streamData = new StreamData<object?>
            {
                Topic = SystemViewProvider.Topic,
                Payload = payload,
                Meta = new Meta { Source = "system", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };
            var json = EnvelopeCodec.WriteStreamData(streamData);
            Assert.DoesNotContain("NaN", json);
            Assert.DoesNotContain("Infinity", json);
        }
    }
}
