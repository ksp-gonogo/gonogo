using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the <c>career.status</c> capture-add's
    /// <see cref="CareerViewProvider"/>: a fake <see cref="KspSnapshot"/>
    /// carrying the raw <c>"career"</c> encoding <c>Gonogo.KSP.KspHost.
    /// BuildCareer</c> produces is mapped to the <c>career.status</c>
    /// payload and asserted against the class doc's rules, the Sandbox
    /// (no "career" key at all) -&gt; null guard, primitives-only shape,
    /// missing fields -&gt; null never a sentinel, and the payload
    /// serializing cleanly through the REAL production path.
    /// </summary>
    [Collection("SystemViewProviderStatics")]
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
                        ["balances"] = new Dictionary<string, object?>
                        {
                            ["funds"] = 125_000.5,
                            ["reputation"] = 42.0,
                            ["science"] = 310.25,
                        },
                        ["facilities"] = new Dictionary<string, object?>
                        {
                            ["LaunchPad"] = new Dictionary<string, object?>
                            {
                                ["facilityOrdinal"] = 2,
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
                                ["facilityOrdinal"] = 8,
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
                            ["activationPatched"] = true,
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
                                    ["description"] = "Rocketry, but more general.",
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

            var balances = Assert.IsType<Dictionary<string, object?>>(root["balances"]);
            Assert.Equal(125_000.5, balances["funds"]);
            Assert.Equal(42.0, balances["reputation"]);
            Assert.Equal(310.25, balances["science"]);

            // The facilities are their OWN channel now, so they are not on this
            // payload at all. See CareerFacilities' doc for why a tier that
            // cannot be read has to be able to go silent rather than ride a
            // channel that keeps arriving.
            Assert.False(root.ContainsKey("facilities"));

            var facilitiesPayload = Assert.IsType<Dictionary<string, object?>>(
                CareerViewProvider.BuildFacilities(snapshot));
            var facilities = Assert.IsType<Dictionary<string, object?>>(facilitiesPayload["facilities"]);
            var launchPad = Assert.IsType<Dictionary<string, object?>>(facilities["LaunchPad"]);
            Assert.Equal(1, launchPad["currentTier"]);
            Assert.Equal(2, launchPad["maxTier"]);
            Assert.Equal(74_000.0, launchPad["upgradeCost"]);
            // The VAB answered no tier, so it gets no entry rather than a row of
            // nulls: an unanswered facility and a facility at tier zero are two
            // different readings, and leaving it out is what keeps them apart.
            Assert.False(facilities.ContainsKey("VehicleAssemblyBuilding"));
            // The facility's identity rides INSIDE the entry, so a client never
            // has to recognise the key it arrived under.
            Assert.Equal(2, launchPad["facilityOrdinal"]);

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
            Assert.Equal(true, strategies["activationPatched"]);
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
            Assert.Equal("Rocketry, but more general.", generalRocketry["description"]);
            Assert.Equal(15.0, generalRocketry["scienceCost"]);
            // A tree that carries no description for a node says nothing rather
            // than an empty string: the widget's detail panel is meant to leave
            // the line out, not draw a blank one.
            var start = Assert.IsType<Dictionary<string, object?>>(techNodes[0]);
            Assert.Null(start["description"]);
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
            var parsedBalances = Assert.IsType<Dictionary<string, object?>>(parsedRoot["balances"]);
            Assert.Equal(125_000.5, parsedBalances["funds"]);
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
                        ["balances"] = new Dictionary<string, object?>
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
            var balances = Assert.IsType<Dictionary<string, object?>>(root["balances"]);
            Assert.Null(balances["funds"]);
            Assert.Null(balances["science"]);
            Assert.Null(balances["reputation"]);

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
                        ["balances"] = new Dictionary<string, object?> { ["funds"] = 100.0 },
                        // facilities/contracts/strategies/tech all absent
                    },
                },
            };

            var payload = CareerViewProvider.BuildCareer(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            Assert.NotNull(root["balances"]);
            Assert.Null(root["contracts"]);
            Assert.Null(root["strategies"]);
            Assert.Null(root["tech"]);
            // The facilities' own channel says the same thing by not answering:
            // its null is UNREADABLE rather than empty, so the engine emits
            // nothing at all and the client's last reading stands.
            Assert.Null(CareerViewProvider.BuildFacilities(snapshot));
        }

        /// <summary>
        /// The off-scene capture: a career is running, the facilities group is
        /// present, and not one facility could be read, because KSP only puts
        /// the space centre's buildings in the scene at the space centre, in the
        /// editor and in flight near the KSC.
        ///
        /// <para>An empty map would be a claim that the career has no
        /// facilities. <c>null</c> is the honest answer, and paired with the
        /// channel's <c>NullIsUnreadable</c> declaration it puts the topic to
        /// silence, so what the operator keeps seeing is the last real reading
        /// with the UT it was taken at.</para>
        /// </summary>
        [Fact]
        public void FacilitiesThatNoneOfWhichCouldBeReadAnswerNullRatherThanAnEmptyMap()
        {
            var snapshot = new KspSnapshot
            {
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["balances"] = new Dictionary<string, object?> { ["funds"] = 100.0 },
                        ["facilities"] = new Dictionary<string, object?>
                        {
                            ["LaunchPad"] = new Dictionary<string, object?>
                            {
                                ["facilityOrdinal"] = 2,
                                ["currentTier"] = null,
                                ["maxTier"] = null,
                                ["upgradeCost"] = null,
                            },
                        },
                    },
                },
            };

            Assert.Null(CareerViewProvider.BuildFacilities(snapshot));
            // The balances on the sibling channel are unaffected: they are readable
            // everywhere, which is exactly why the two cannot share a channel.
            var root = Assert.IsType<Dictionary<string, object?>>(
                CareerViewProvider.BuildCareer(snapshot));
            Assert.NotNull(root["balances"]);
        }

        /// <summary>
        /// The balances group carries the three readings and nothing else,
        /// whatever else the capture held: a key the capture grew is not a key
        /// on the wire until the contract names it.
        /// </summary>
        [Fact]
        public void BuildCareerCarriesOnlyTheThreeBalances()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["balances"] = new Dictionary<string, object?>
                        {
                            ["funds"] = 100.0,
                            ["reputation"] = 250.0,
                            ["science"] = 12.0,
                            ["upkeepPerDay"] = 750.0,
                        },
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(CareerViewProvider.BuildCareer(snapshot));
            var balances = Assert.IsType<Dictionary<string, object?>>(root["balances"]);

            Assert.Equal(
                new[] { "funds", "reputation", "science" },
                balances.Keys);
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
        [InlineData(70000.0, 100000.0, 70000.0, 100000.0)]
        [InlineData(70000.0, null, null, null)]
        [InlineData(double.NaN, 100000.0, null, null)]
        [InlineData(null, null, null, null)]
        public void BuildCareerCarriesAContractParametersAltitudeBandOnlyWhenBothBoundsAreReal(
            double? rawMin, double? rawMax, double? expectedMin, double? expectedMax)
        {
            var raw = new Dictionary<string, object?>
            {
                ["title"] = "Test the barometer at altitude",
                ["state"] = "Incomplete",
                ["stateOrdinal"] = 0,
                ["minAltitude"] = rawMin,
                ["maxAltitude"] = rawMax,
            };
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["contracts"] = new Dictionary<string, object?>
                        {
                            ["active"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "1",
                                    ["parameters"] = new List<object?> { raw },
                                },
                            },
                            ["offered"] = new List<object?>(),
                        },
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(CareerViewProvider.BuildCareer(snapshot));
            var contracts = Assert.IsType<Dictionary<string, object?>>(root["contracts"]);
            var contract = Assert.IsType<Dictionary<string, object?>>(
                Assert.Single(Assert.IsType<List<object?>>(contracts["active"])));
            var parameter = Assert.IsType<Dictionary<string, object?>>(
                Assert.Single(Assert.IsType<List<object?>>(contract["parameters"])));
            Assert.Equal(expectedMin, parameter["minAltitude"]);
            Assert.Equal(expectedMax, parameter["maxAltitude"]);
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
