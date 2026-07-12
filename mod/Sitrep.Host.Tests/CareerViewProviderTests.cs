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
                                ["currentTier"] = 1,
                                ["maxTier"] = 2,
                                ["upgradeCost"] = 74_000.0,
                            },
                            // Not in the Space Center scene when captured -
                            // currentTier/maxTier/upgradeCost genuinely
                            // unavailable (all three share one live-facility
                            // gate - see KspHost.BuildCareerFacilities).
                            ["VehicleAssemblyBuilding"] = new Dictionary<string, object?>
                            {
                                ["currentTier"] = null,
                                ["maxTier"] = null,
                                ["upgradeCost"] = null,
                            },
                        },
                        ["contracts"] = new Dictionary<string, object?>
                        {
                            ["active"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "123456789012345",
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
                                    ["parameters"] = new List<object?>
                                    {
                                        new Dictionary<string, object?>
                                        {
                                            ["title"] = "Rescue Jebediah Kerman from orbit",
                                            ["state"] = "Incomplete",
                                        },
                                    },
                                },
                            },
                            ["offered"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "987654321098765",
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
                                    ["parameters"] = new List<object?>(),
                                },
                            },
                            ["completedRecent"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "111111111111111",
                                    ["title"] = "Orbit Kerbin",
                                    ["agent"] = "Kerbin Space Program",
                                    ["state"] = "Completed",
                                    ["fundsAdvance"] = 3000.0,
                                    ["fundsCompletion"] = 12000.0,
                                    ["fundsFailure"] = 0.0,
                                    ["scienceCompletion"] = 8.0,
                                    ["reputationCompletion"] = 6.0,
                                    ["reputationFailure"] = 0.0,
                                    ["dateAccepted"] = 1000.0,
                                    ["dateDeadline"] = 0.0,
                                    ["dateExpire"] = 0.0,
                                    ["parameters"] = new List<object?>
                                    {
                                        new Dictionary<string, object?>
                                        {
                                            ["title"] = "Reach orbit",
                                            ["state"] = "Complete",
                                        },
                                    },
                                },
                            },
                        },
                        ["strategies"] = new Dictionary<string, object?>
                        {
                            ["active"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "OutsourceRnDStrategy",
                                    ["title"] = "Outsourced R&D",
                                    ["description"] = "Outsource research to third parties.",
                                    ["department"] = "Science",
                                    ["isActive"] = true,
                                    ["factor"] = 0.75,
                                    ["dateActivated"] = 5000.0,
                                    ["requiredReputation"] = 0.0,
                                    ["initialCostFunds"] = 0.0,
                                    ["initialCostScience"] = 0.0,
                                    ["initialCostReputation"] = 10.0,
                                    ["hasFactorSlider"] = true,
                                    ["factorSliderDefault"] = 0.5,
                                    ["factorSliderSteps"] = 10,
                                    ["canActivate"] = false,
                                    ["activateBlockedReason"] = "Already active",
                                    ["canDeactivate"] = true,
                                    ["deactivateBlockedReason"] = "",
                                    ["effect"] = "Converts science into funds.",
                                },
                            },
                            ["all"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "OutsourceRnDStrategy",
                                    ["title"] = "Outsourced R&D",
                                    ["description"] = "Outsource research to third parties.",
                                    ["department"] = "Science",
                                    ["isActive"] = true,
                                    ["factor"] = 0.75,
                                    ["dateActivated"] = 5000.0,
                                    ["requiredReputation"] = 0.0,
                                    ["initialCostFunds"] = 0.0,
                                    ["initialCostScience"] = 0.0,
                                    ["initialCostReputation"] = 10.0,
                                    ["hasFactorSlider"] = true,
                                    ["factorSliderDefault"] = 0.5,
                                    ["factorSliderSteps"] = 10,
                                    ["canActivate"] = false,
                                    ["activateBlockedReason"] = "Already active",
                                    ["canDeactivate"] = true,
                                    ["deactivateBlockedReason"] = "",
                                    ["effect"] = "Converts science into funds.",
                                },
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "BureaucracyStrategy",
                                    ["title"] = "Bureaucracy",
                                    ["description"] = "Bureaucratic overhead.",
                                    ["department"] = "Admin",
                                    ["isActive"] = false,
                                    ["factor"] = 0.0,
                                    ["dateActivated"] = 0.0,
                                    ["requiredReputation"] = 0.0,
                                    ["initialCostFunds"] = 1000.0,
                                    ["initialCostScience"] = 0.0,
                                    ["initialCostReputation"] = 0.0,
                                    ["hasFactorSlider"] = false,
                                    ["factorSliderDefault"] = 0.0,
                                    ["factorSliderSteps"] = 1,
                                    ["canActivate"] = true,
                                    ["activateBlockedReason"] = "",
                                    ["canDeactivate"] = false,
                                    ["deactivateBlockedReason"] = "Not active",
                                    ["effect"] = "",
                                },
                            },
                            ["activeCount"] = 1,
                        },
                        ["tech"] = new Dictionary<string, object?>
                        {
                            ["unlockedCount"] = 2,
                            ["unlockedIds"] = new List<object?> { "start", "basicRocketry" },
                            ["nodes"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "start",
                                    ["title"] = "Start",
                                    ["scienceCost"] = 0.0,
                                    ["unlocked"] = true,
                                    ["parents"] = new List<object?>(),
                                },
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "basicRocketry",
                                    ["title"] = "Basic Rocketry",
                                    ["scienceCost"] = 5.0,
                                    ["unlocked"] = true,
                                    ["parents"] = new List<object?> { "start" },
                                },
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "generalRocketry",
                                    ["title"] = "General Rocketry",
                                    ["scienceCost"] = 15.0,
                                    ["unlocked"] = false,
                                    ["parents"] = new List<object?> { "basicRocketry" },
                                },
                            },
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
            Assert.Equal(1, launchPad["currentTier"]);
            Assert.Equal(2, launchPad["maxTier"]);
            Assert.Equal(74_000.0, launchPad["upgradeCost"]);
            var vab = Assert.IsType<Dictionary<string, object?>>(facilities["VehicleAssemblyBuilding"]);
            Assert.Null(vab["currentTier"]); // scene-gated field, genuinely unavailable
            Assert.Null(vab["maxTier"]);
            Assert.Null(vab["upgradeCost"]);

            var contracts = Assert.IsType<Dictionary<string, object?>>(root["contracts"]);
            var active = Assert.IsType<List<object?>>(contracts["active"]);
            var activeContract = Assert.IsType<Dictionary<string, object?>>(Assert.Single(active));
            Assert.Equal("123456789012345", activeContract["id"]);
            Assert.Equal("Rescue Jebediah Kerman", activeContract["title"]);
            Assert.Equal("Kerbin Rescue Corps", activeContract["agent"]);
            Assert.Equal("Active", activeContract["state"]);
            Assert.Equal(15000.0, activeContract["fundsCompletion"]);
            var activeContractParams = Assert.IsType<List<object?>>(activeContract["parameters"]);
            var activeContractParam = Assert.IsType<Dictionary<string, object?>>(Assert.Single(activeContractParams));
            Assert.Equal("Rescue Jebediah Kerman from orbit", activeContractParam["title"]);
            Assert.Equal("Incomplete", activeContractParam["state"]);
            var offered = Assert.IsType<List<object?>>(contracts["offered"]);
            var offeredContract = Assert.IsType<Dictionary<string, object?>>(Assert.Single(offered));
            Assert.Equal("987654321098765", offeredContract["id"]);
            Assert.Empty(Assert.IsType<List<object?>>(offeredContract["parameters"]));
            var completedRecent = Assert.IsType<List<object?>>(contracts["completedRecent"]);
            var completedContract = Assert.IsType<Dictionary<string, object?>>(Assert.Single(completedRecent));
            Assert.Equal("111111111111111", completedContract["id"]);
            Assert.Equal("Orbit Kerbin", completedContract["title"]);
            Assert.Equal("Completed", completedContract["state"]);
            Assert.Equal(12000.0, completedContract["fundsCompletion"]);
            var completedContractParam = Assert.IsType<Dictionary<string, object?>>(
                Assert.Single(Assert.IsType<List<object?>>(completedContract["parameters"])));
            Assert.Equal("Reach orbit", completedContractParam["title"]);

            var strategies = Assert.IsType<Dictionary<string, object?>>(root["strategies"]);
            var activeStrategies = Assert.IsType<List<object?>>(strategies["active"]);
            var strategy = Assert.IsType<Dictionary<string, object?>>(Assert.Single(activeStrategies));
            Assert.Equal("OutsourceRnDStrategy", strategy["id"]);
            Assert.Equal("Outsourced R&D", strategy["title"]);
            Assert.Equal("Science", strategy["department"]);
            Assert.Equal(0.75, strategy["factor"]);
            Assert.Equal(10.0, strategy["initialCostReputation"]);
            Assert.Equal(false, strategy["canActivate"]);
            Assert.Equal(true, strategy["canDeactivate"]);
            Assert.Equal(1, strategies["activeCount"]);
            var allStrategies = Assert.IsType<List<object?>>(strategies["all"]);
            Assert.Equal(2, allStrategies.Count);
            var inactiveStrategy = Assert.IsType<Dictionary<string, object?>>(allStrategies[1]);
            Assert.Equal("BureaucracyStrategy", inactiveStrategy["id"]);
            Assert.Equal(false, inactiveStrategy["isActive"]);
            Assert.Equal(true, inactiveStrategy["canActivate"]);

            var tech = Assert.IsType<Dictionary<string, object?>>(root["tech"]);
            Assert.Equal(2, tech["unlockedCount"]);
            var techNodes = Assert.IsType<List<object?>>(tech["nodes"]);
            Assert.Equal(3, techNodes.Count);
            var generalRocketry = Assert.IsType<Dictionary<string, object?>>(techNodes[2]);
            Assert.Equal("generalRocketry", generalRocketry["id"]);
            Assert.Equal("General Rocketry", generalRocketry["title"]);
            Assert.Equal(15.0, generalRocketry["scienceCost"]);
            Assert.Equal(false, generalRocketry["unlocked"]);
            var generalRocketryParents = Assert.IsType<List<object?>>(generalRocketry["parents"]);
            Assert.Equal("basicRocketry", Assert.Single(generalRocketryParents));
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

        [Fact]
        public void BuildCareerEmitsEmptyCompletedRecentWhenTheRawContractsGroupOmitsIt()
        {
            // A pre-completedRecent capture (or a tick before any contract has
            // finished) supplies a "contracts" group with only active/offered.
            // The provider must still emit an empty completedRecent list -
            // always-present, never-null, same discipline as active/offered -
            // so a widget can bind to it unconditionally.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["contracts"] = new Dictionary<string, object?>
                        {
                            ["active"] = new List<object?>(),
                            ["offered"] = new List<object?>(),
                            // completedRecent absent
                        },
                    },
                },
            };

            var payload = CareerViewProvider.BuildCareer(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var contracts = Assert.IsType<Dictionary<string, object?>>(root["contracts"]);
            Assert.Empty(Assert.IsType<List<object?>>(contracts["completedRecent"]));
        }

        [Theory]
        [InlineData("SANDBOX", GameMode.Sandbox)]
        [InlineData("CAREER", GameMode.Career)]
        [InlineData("SCIENCE_SANDBOX", GameMode.Science)]
        // Unrecognized KSP modes (SCENARIO/MISSION/... and any future
        // addition) fold to Unknown rather than the mapper throwing.
        [InlineData("SCENARIO", GameMode.Unknown)]
        [InlineData("MISSION_BUILDER", GameMode.Unknown)]
        [InlineData("something-new-in-a-future-ksp", GameMode.Unknown)]
        public void BuildCareerModeMapsRawGameModeStringToTheEnumOrdinal(string raw, GameMode expected)
        {
            var snapshot = new KspSnapshot
            {
                Ut = 100.0,
                Values = new Dictionary<string, object?> { ["gameMode"] = raw },
            };

            var payload = CareerViewProvider.BuildCareerMode(snapshot);

            var wire = Assert.IsType<Dictionary<string, object?>>(payload);
            // Enums serialize as their integer ordinal on the wire (same as
            // every other enum in this codec - see JsonWriter / VesselViewProvider.ToWire).
            Assert.Equal((int)expected, wire["mode"]);
        }

        [Fact]
        public void BuildCareerModeReturnsNullWhenNoGameModeKey()
        {
            // No game loaded (main menu): KspHost omits the "gameMode" key
            // entirely - the provider maps that to a null payload, "no data
            // yet," never a fabricated mode.
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(CareerViewProvider.BuildCareerMode(snapshot));
        }

        [Fact]
        public void BuildCareerModeReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(CareerViewProvider.BuildCareerMode(null));
        }

        [Fact]
        public void BuildCareerModeSerializesCleanlyThroughTheRealProductionPath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 4242.0,
                Values = new Dictionary<string, object?> { ["gameMode"] = "CAREER" },
            };

            var payload = CareerViewProvider.BuildCareerMode(snapshot);

            var streamData = new StreamData<object?>
            {
                Topic = CareerViewProvider.ModeTopic,
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
            Assert.Equal(CareerViewProvider.ModeTopic, parsed.Topic);
            var parsedWire = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal((double)(int)GameMode.Career, parsedWire["mode"]);
        }
    }
}
