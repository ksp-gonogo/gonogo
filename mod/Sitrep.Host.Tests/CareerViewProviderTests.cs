using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the <c>career.status</c> capture-add's
    /// <see cref="CareerViewProvider"/>: a fake <see cref="KspSnapshot"/>
    /// carrying the raw <c>"career"</c> encoding <c>Gonogo.KSP.KspHost.
    /// BuildCareer</c> produces is mapped to the <c>career.status</c>
    /// payload and asserted against the class doc's rules — the Sandbox
    /// (no "career" key at all) -&gt; null guard, primitives-only shape,
    /// missing fields -&gt; null never a sentinel, and the payload
    /// serializing cleanly through the REAL production path.
    /// </summary>
    public class CareerViewProviderTests
    {
        [Fact]
        public void BuildCareerReturnsNullWhenSnapshotHasNoCareerKeyAtAll()
        {
            // The Sandbox case: KspHost.BuildCareer never adds a "career"
            // key at all outside career mode - the provider must treat that
            // exactly like "no data yet," not fabricate an empty payload.
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(CareerViewProvider.BuildCareer(snapshot));
        }

        [Fact]
        public void BuildCareerReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(CareerViewProvider.BuildCareer(null));
        }

        [Fact]
        public void BuildCareerMapsFullSyntheticCareerDictToTheTypedTree()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 12345.0,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["economy"] = new Dictionary<string, object?>
                        {
                            ["funds"] = 125_000.5,
                            ["reputation"] = 42.0,
                            ["science"] = 310.25,
                        },
                        ["facilities"] = new Dictionary<string, object?>
                        {
                            ["LaunchPad"] = new Dictionary<string, object?>
                            {
                                ["level"] = 0.5,
                                ["levelCount"] = 3,
                                ["upgradeCost"] = 74_000.0,
                            },
                            // Not in the Space Center scene when captured -
                            // levelCount/upgradeCost genuinely unavailable.
                            ["VehicleAssemblyBuilding"] = new Dictionary<string, object?>
                            {
                                ["level"] = 1.0,
                                ["levelCount"] = null,
                                ["upgradeCost"] = null,
                            },
                        },
                        ["contracts"] = new Dictionary<string, object?>
                        {
                            ["active"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["title"] = "Rescue Jebediah Kerman",
                                    ["agent"] = "Kerbin Rescue Corps",
                                    ["state"] = "Active",
                                    ["fundsAdvance"] = 5000.0,
                                    ["fundsCompletion"] = 15000.0,
                                    ["fundsFailure"] = 2500.0,
                                    ["scienceCompletion"] = 25.0,
                                    ["reputationCompletion"] = 10.0,
                                    ["reputationFailure"] = 5.0,
                                    ["dateAccepted"] = 1000.0,
                                    ["dateDeadline"] = 500000.0,
                                    ["dateExpire"] = 0.0,
                                },
                            },
                            ["offered"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["title"] = "Test a Part on the Launchpad",
                                    ["agent"] = "Kerbin Space Program",
                                    ["state"] = "Offered",
                                    ["fundsAdvance"] = 0.0,
                                    ["fundsCompletion"] = 2000.0,
                                    ["fundsFailure"] = 0.0,
                                    ["scienceCompletion"] = 5.0,
                                    ["reputationCompletion"] = 2.0,
                                    ["reputationFailure"] = 1.0,
                                    ["dateAccepted"] = 0.0,
                                    ["dateDeadline"] = 0.0,
                                    ["dateExpire"] = 200000.0,
                                },
                            },
                        },
                        ["strategies"] = new Dictionary<string, object?>
                        {
                            ["active"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["title"] = "Outsourced R&D",
                                    ["department"] = "Science",
                                    ["factor"] = 0.75,
                                },
                            },
                            ["activeCount"] = 1,
                        },
                        ["tech"] = new Dictionary<string, object?>
                        {
                            ["unlockedCount"] = 2,
                            ["unlockedIds"] = new List<object?> { "start", "basicRocketry" },
                        },
                    },
                },
            };

            var payload = CareerViewProvider.BuildCareer(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);

            var economy = Assert.IsType<Dictionary<string, object?>>(root["economy"]);
            Assert.Equal(125_000.5, economy["funds"]);
            Assert.Equal(42.0, economy["reputation"]);
            Assert.Equal(310.25, economy["science"]);

            var facilities = Assert.IsType<Dictionary<string, object?>>(root["facilities"]);
            var launchPad = Assert.IsType<Dictionary<string, object?>>(facilities["LaunchPad"]);
            Assert.Equal(0.5, launchPad["level"]);
            Assert.Equal(3, launchPad["levelCount"]);
            Assert.Equal(74_000.0, launchPad["upgradeCost"]);
            var vab = Assert.IsType<Dictionary<string, object?>>(facilities["VehicleAssemblyBuilding"]);
            Assert.Equal(1.0, vab["level"]);
            Assert.Null(vab["levelCount"]); // scene-gated field, genuinely unavailable
            Assert.Null(vab["upgradeCost"]);

            var contracts = Assert.IsType<Dictionary<string, object?>>(root["contracts"]);
            var active = Assert.IsType<List<object?>>(contracts["active"]);
            var activeContract = Assert.IsType<Dictionary<string, object?>>(Assert.Single(active));
            Assert.Equal("Rescue Jebediah Kerman", activeContract["title"]);
            Assert.Equal("Kerbin Rescue Corps", activeContract["agent"]);
            Assert.Equal("Active", activeContract["state"]);
            Assert.Equal(15000.0, activeContract["fundsCompletion"]);
            var offered = Assert.IsType<List<object?>>(contracts["offered"]);
            Assert.Single(offered);

            var strategies = Assert.IsType<Dictionary<string, object?>>(root["strategies"]);
            var activeStrategies = Assert.IsType<List<object?>>(strategies["active"]);
            var strategy = Assert.IsType<Dictionary<string, object?>>(Assert.Single(activeStrategies));
            Assert.Equal("Outsourced R&D", strategy["title"]);
            Assert.Equal("Science", strategy["department"]);
            Assert.Equal(0.75, strategy["factor"]);
            Assert.Equal(1, strategies["activeCount"]);

            var tech = Assert.IsType<Dictionary<string, object?>>(root["tech"]);
            Assert.Equal(2, tech["unlockedCount"]);
            var ids = Assert.IsType<List<object?>>(tech["unlockedIds"]);
            Assert.Equal(2, ids.Count);

            // Serializes cleanly through the REAL production path.
            var streamData = new StreamData<object?>
            {
                Topic = CareerViewProvider.Topic,
                Payload = payload,
                Meta = new Meta
                {
                    Source = "career",
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
            Assert.Equal(CareerViewProvider.Topic, parsed.Topic);
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            var parsedEconomy = Assert.IsType<Dictionary<string, object?>>(parsedRoot["economy"]);
            Assert.Equal(125_000.5, parsedEconomy["funds"]);
        }

        [Fact]
        public void BuildCareerTreatsMissingOrNonFiniteFieldsAsAbsentNotAsSentinels()
        {
            // Missing "reputation" entirely, "science" explicitly null, and
            // a non-finite "funds" (R1/F-1, same rule SystemViewProvider's
            // orbit mapping applies) must all map to null - never 0, never
            // "NaN" on the wire.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["economy"] = new Dictionary<string, object?>
                        {
                            ["funds"] = double.NaN,
                            ["science"] = null,
                            // "reputation" key absent entirely
                        },
                    },
                },
            };

            var payload = CareerViewProvider.BuildCareer(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var economy = Assert.IsType<Dictionary<string, object?>>(root["economy"]);
            Assert.Null(economy["funds"]);
            Assert.Null(economy["science"]);
            Assert.Null(economy["reputation"]);

            var streamData = new StreamData<object?>
            {
                Topic = CareerViewProvider.Topic,
                Payload = payload,
                Meta = new Meta { Source = "career", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };
            var json = EnvelopeCodec.WriteStreamData(streamData);
            Assert.DoesNotContain("NaN", json);
        }

        [Fact]
        public void BuildCareerOmitsGroupsThatAreThemselvesAbsentFromTheRawDict()
        {
            // KspHost's own TryBuildGroup can omit an individual career
            // sub-group (e.g. "contracts") on a build failure without
            // taking out the rest - the provider must map that to a null
            // sub-group, not throw or fabricate one.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["economy"] = new Dictionary<string, object?> { ["funds"] = 100.0 },
                        // facilities/contracts/strategies/tech all absent
                    },
                },
            };

            var payload = CareerViewProvider.BuildCareer(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            Assert.NotNull(root["economy"]);
            Assert.Null(root["facilities"]);
            Assert.Null(root["contracts"]);
            Assert.Null(root["strategies"]);
            Assert.Null(root["tech"]);
        }
    }
}
