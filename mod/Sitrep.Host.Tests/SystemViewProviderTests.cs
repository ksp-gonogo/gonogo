using System;
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

        [Fact]
        public void BuildSystemBodiesCarriesTheAlmanacEnrichmentFields()
        {
            // The "better-than-Telemachus almanac" field set: gravParameter (the
            // compute primitive), soi, rotationPeriod, tidallyLocked, hasOcean,
            // description, and a nested atmosphere object -- null when airless.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        // Airless, oceanless body (e.g. the Mun): atmosphere -> null.
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Mun",
                            ["index"] = 0,
                            ["parentIndex"] = null,
                            ["radius"] = 200_000.0,
                            ["gravParameter"] = 6.5138398e10,
                            ["sphereOfInfluence"] = 2_429_559.1,
                            ["rotationPeriod"] = 138_984.38,
                            ["tidallyLocked"] = true,
                            ["hasOcean"] = false,
                            ["description"] = "The Mun.",
                            ["hasAtmosphere"] = false,
                        },
                        // Oxygenated atmosphere + ocean (e.g. Kerbin).
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbin",
                            ["index"] = 1,
                            ["parentIndex"] = 0,
                            ["radius"] = 600_000.0,
                            ["gravParameter"] = 3.5316e12,
                            ["sphereOfInfluence"] = 84_159_286.0,
                            ["rotationPeriod"] = 21_549.425,
                            ["tidallyLocked"] = false,
                            ["hasOcean"] = true,
                            ["description"] = "Kerbin.",
                            ["hasAtmosphere"] = true,
                            ["atmosphereDepth"] = 70_000.0,
                            ["atmosphereHasOxygen"] = true,
                            ["atmosphereSeaLevelPressure"] = 101.325,
                            ["sma"] = 13_599_840_256.0,
                            ["ecc"] = 0.0,
                            ["meanAnomalyAtEpoch"] = 3.14,
                            ["epoch"] = 0.0,
                        },
                    },
                },
            };

            var payload = SystemViewProvider.BuildSystemBodies(snapshot);
            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var bodies = Assert.IsType<List<object?>>(root["bodies"]);

            var mun = Assert.IsType<Dictionary<string, object?>>(bodies[0]);
            Assert.Equal(6.5138398e10, mun["gravParameter"]);
            Assert.Equal(2_429_559.1, mun["sphereOfInfluence"]);
            Assert.Equal(138_984.38, mun["rotationPeriod"]);
            Assert.Equal(true, mun["tidallyLocked"]);
            Assert.Equal(false, mun["hasOcean"]);
            Assert.Equal("The Mun.", mun["description"]);
            Assert.Null(mun["atmosphere"]); // airless -> null, never an empty descriptor

            var kerbin = Assert.IsType<Dictionary<string, object?>>(bodies[1]);
            Assert.Equal(3.5316e12, kerbin["gravParameter"]);
            Assert.Equal(84_159_286.0, kerbin["sphereOfInfluence"]);
            Assert.Equal(true, kerbin["hasOcean"]);
            var atmo = Assert.IsType<Dictionary<string, object?>>(kerbin["atmosphere"]);
            Assert.Equal(70_000.0, atmo["depth"]);
            Assert.Equal(true, atmo["hasOxygen"]);
            Assert.Equal(101.325, atmo["seaLevelPressure"]);

            // Serializes cleanly through the real production path (no NaN/Infinity).
            var streamData = new StreamData<object?>
            {
                Topic = SystemViewProvider.Topic,
                Payload = payload,
                Meta = new Meta { Source = "system", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };
            var json = EnvelopeCodec.WriteStreamData(streamData);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            var parsedBodies = Assert.IsType<List<object?>>(parsedRoot["bodies"]);
            var parsedKerbin = Assert.IsType<Dictionary<string, object?>>(parsedBodies[1]);
            var parsedAtmo = Assert.IsType<Dictionary<string, object?>>(parsedKerbin["atmosphere"]);
            Assert.Equal(70_000.0, parsedAtmo["depth"]);
        }

        // ----------------------------------------------------------------
        // system.vessels -- M3 R3 roster capture-add
        // ----------------------------------------------------------------

        [Fact]
        public void BuildSystemVesselsMapsEveryVesselAndResolvesMainBodyToAnIndex()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 },
                        new Dictionary<string, object?> { ["name"] = "Mun", ["index"] = 2 },
                    },
                    ["vessels"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["id"] = "11111111-2222-3333-4444-555555555555",
                            ["name"] = "Kerbal X",
                            ["vesselType"] = "Ship",
                            ["situation"] = "ORBITING",
                            ["mainBody"] = "Kerbin",
                        },
                        new Dictionary<string, object?>
                        {
                            ["id"] = "66666666-7777-8888-9999-000000000000",
                            ["name"] = "Munar Relay",
                            ["vesselType"] = "Relay",
                            ["situation"] = "ORBITING",
                            ["mainBody"] = "Mun",
                        },
                    },
                },
            };

            var payload = SystemViewProvider.BuildSystemVessels(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var vessels = Assert.IsType<List<object?>>(root["vessels"]);
            Assert.Equal(2, vessels.Count);

            var first = Assert.IsType<Dictionary<string, object?>>(vessels[0]);
            Assert.Equal("11111111-2222-3333-4444-555555555555", first["vesselId"]);
            Assert.Equal("Kerbal X", first["name"]);
            Assert.Equal((int)VesselType.Ship, first["vesselType"]);
            Assert.Equal((int)Situation.Orbiting, first["situation"]);
            Assert.Equal(1, first["bodyIndex"]);

            var second = Assert.IsType<Dictionary<string, object?>>(vessels[1]);
            Assert.Equal(2, second["bodyIndex"]); // "Mun" -> index 2
        }

        [Fact]
        public void BuildSystemVesselsDropsAnEntryWithNoResolvableIdRatherThanFabricatingOne()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessels"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["name"] = "No Id Vessel" }, // missing "id"
                        new Dictionary<string, object?> { ["id"] = "", ["name"] = "Empty Id Vessel" },
                        new Dictionary<string, object?> { ["id"] = "22222222-0000-0000-0000-000000000000", ["name"] = "Valid" },
                    },
                },
            };

            var payload = SystemViewProvider.BuildSystemVessels(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var vessels = Assert.IsType<List<object?>>(root["vessels"]);
            var entry = Assert.Single(vessels);
            var dict = Assert.IsType<Dictionary<string, object?>>(entry);
            Assert.Equal("22222222-0000-0000-0000-000000000000", dict["vesselId"]);
        }

        [Fact]
        public void BuildSystemVesselsLeavesBodyIndexNullWhenMainBodyIsAbsentOrUnresolved()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 },
                    },
                    ["vessels"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["id"] = "id-1", ["name"] = "No Body" }, // mainBody absent
                        new Dictionary<string, object?> { ["id"] = "id-2", ["name"] = "Unknown Body", ["mainBody"] = "Eeloo" },
                    },
                },
            };

            var payload = SystemViewProvider.BuildSystemVessels(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var vessels = Assert.IsType<List<object?>>(root["vessels"]);
            var first = Assert.IsType<Dictionary<string, object?>>(vessels[0]);
            var second = Assert.IsType<Dictionary<string, object?>>(vessels[1]);
            Assert.Null(first["bodyIndex"]);
            Assert.Null(second["bodyIndex"]);
        }

        [Fact]
        public void BuildSystemVesselsReturnsEmptyRosterNotNullWhenTheListIsEmpty()
        {
            // Distinguishes "no data yet" (no "vessels" key -> null payload,
            // covered above) from "FlightGlobals genuinely reports zero
            // vessels" (key present, empty list -> {"vessels": []}).
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["vessels"] = new List<object?>() },
            };

            var payload = SystemViewProvider.BuildSystemVessels(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            Assert.Empty(Assert.IsType<List<object?>>(root["vessels"]));
        }

        [Fact]
        public void BuildSystemVesselsReturnsNullWhenSnapshotHasNoVesselsKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(SystemViewProvider.BuildSystemVessels(snapshot));
        }

        // ----------------------------------------------------------------
        // game.dlc -- installed-DLC capability capture-add (Meta.Dlc path)
        // ----------------------------------------------------------------

        [Fact]
        public void BuildGameDlcMapsRawDlcGroupToTwoBoolsAndSerializesCleanly()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["dlc"] = new Dictionary<string, object?>
                    {
                        ["breakingGround"] = true,
                        ["makingHistory"] = false,
                    },
                },
            };

            var payload = SystemViewProvider.BuildGameDlc(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            Assert.Equal(true, root["breakingGround"]);
            Assert.Equal(false, root["makingHistory"]);

            // Serializes through the REAL production path, same as the other
            // system.* payloads above.
            var streamData = new StreamData<object?>
            {
                Topic = SystemViewProvider.DlcTopic,
                Payload = payload,
                Meta = new Meta { Source = "system", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };
            var json = EnvelopeCodec.WriteStreamData(streamData);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            Assert.Equal(SystemViewProvider.DlcTopic, parsed.Topic);
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal(true, parsedRoot["breakingGround"]);
            Assert.Equal(false, parsedRoot["makingHistory"]);
        }

        [Fact]
        public void BuildGameDlcDefaultsAMissingExpansionBoolToFalseNotNull()
        {
            // A present-but-partial "dlc" group (only breakingGround supplied)
            // still emits two plain bools -- the unmentioned expansion is
            // treated as not installed, never a null on the wire.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["dlc"] = new Dictionary<string, object?> { ["breakingGround"] = true },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildGameDlc(snapshot));
            Assert.Equal(true, root["breakingGround"]);
            Assert.Equal(false, root["makingHistory"]);
        }

        [Fact]
        public void BuildGameDlcReturnsNullWhenSnapshotHasNoDlcGroupAtAll()
        {
            // "No sample yet" (no "dlc" key) is null -- distinct from "DLC
            // genuinely absent" (key present, both bools false).
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(SystemViewProvider.BuildGameDlc(snapshot));
        }

        [Fact]
        public void GameDlcContractTypeMirrorsTheProviderWireShapeExactly()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["dlc"] = new Dictionary<string, object?>
                    {
                        ["breakingGround"] = true,
                        ["makingHistory"] = true,
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildGameDlc(snapshot));

            // Exactly { breakingGround, makingHistory } -- no `meta` on a
            // game.* payload (it rides the envelope).
            Assert.Equal(WireFieldNamesOf(typeof(GameDlc)), root.Keys.ToHashSet());
        }

        // ----------------------------------------------------------------
        // Contract-shape mirror (P0.5): the named Sitrep.Contract payload
        // types (SystemBodies/BodyEntry/OrbitEntry, SystemVessels/
        // VesselRosterEntry) exist so a widget resolves a real payload type
        // instead of `unknown`. They are TYPING-ONLY — they do NOT
        // participate in serialization (JsonWriter walks the provider's live
        // value tree, not these POCOs). Nothing at compile time binds the
        // POCO field set to the dict keys the provider actually emits, so
        // these tests bind them at run time: every field name the provider
        // puts on the wire must equal the camelCased public-property set of
        // its contract type (RtConfig's CamelCaseForProperties rule), and no
        // more. A rename/add/remove on either side — or a `meta` key
        // creeping onto a system.* payload — fails here.
        // ----------------------------------------------------------------

        // RtConfig.CamelCaseForProperties: lowercase the first char only
        // (every property here is single-or-multi-word PascalCase, e.g.
        // MeanAnomalyAtEpoch -> meanAnomalyAtEpoch, ArgPe -> argPe).
        private static string CamelCase(string pascal) =>
            pascal.Length == 0 ? pascal : char.ToLowerInvariant(pascal[0]) + pascal.Substring(1);

        private static HashSet<string> WireFieldNamesOf(Type contractType) =>
            contractType
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(p => CamelCase(p.Name))
                .ToHashSet();

        private static HashSet<string> KeysOf(object? node) =>
            Assert.IsType<Dictionary<string, object?>>(node).Keys.ToHashSet();

        [Fact]
        public void SystemBodiesContractTypeMirrorsTheProviderWireShapeExactly()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["name"] = "Kerbol", ["index"] = 0, ["radius"] = 261_600_000.0 },
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
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildSystemBodies(snapshot));

            // Top level: exactly { bodies } — no `meta` on a system.* payload.
            Assert.Equal(WireFieldNamesOf(typeof(SystemBodies)), root.Keys.ToHashSet());

            var bodies = Assert.IsType<List<object?>>(root["bodies"]);
            var planet = Assert.IsType<Dictionary<string, object?>>(bodies[1]);
            Assert.Equal(WireFieldNamesOf(typeof(BodyEntry)), KeysOf(planet));
            Assert.Equal(WireFieldNamesOf(typeof(OrbitEntry)), KeysOf(planet["orbit"]));

            // The eccentricAnomaly wart cannot exist on either the wire or the type.
            Assert.DoesNotContain("eccentricAnomaly", WireFieldNamesOf(typeof(OrbitEntry)));
            Assert.DoesNotContain("eccentricAnomaly", KeysOf(planet["orbit"]));
        }

        [Fact]
        public void SystemVesselsContractTypeMirrorsTheProviderWireShapeExactly()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 },
                    },
                    ["vessels"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["id"] = "11111111-2222-3333-4444-555555555555",
                            ["name"] = "Kerbal X",
                            ["vesselType"] = "Ship",
                            ["situation"] = "ORBITING",
                            ["mainBody"] = "Kerbin",
                        },
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildSystemVessels(snapshot));

            Assert.Equal(WireFieldNamesOf(typeof(SystemVessels)), root.Keys.ToHashSet());

            var vessels = Assert.IsType<List<object?>>(root["vessels"]);
            Assert.Equal(WireFieldNamesOf(typeof(VesselRosterEntry)), KeysOf(vessels[0]));
        }
    }
}
