using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for <see cref="SpaceCenterViewProvider"/>: fake
    /// <see cref="KspSnapshot"/>s carrying the raw <c>"spaceCenter"</c>/
    /// <c>"scene"</c> encodings are mapped and asserted against the class doc's
    /// rules: the launch-site roster keyed and distinguishable (stock pad +
    /// runway + a synthetic MH/KK site), <c>isStock</c> honored, body NAME
    /// resolved to a <c>system.bodies</c> index, the scene enum folded to the
    /// six output strings (incl. the <c>"Other"</c> fallback), and null-not-
    /// empty when the snapshot has no data yet, plus a clean round-trip
    /// through the REAL production wire path
    /// (<see cref="EnvelopeCodec.WriteStreamData"/>/<c>ParseStreamData</c>).
    /// </summary>
    public class SpaceCenterViewProviderTests
    {
        // ----------------------------------------------------------------
        // spaceCenter.launchSites
        // ----------------------------------------------------------------

        [Fact]
        public void BuildLaunchSitesMapsEveryKeyedSiteAndHonorsIsStockAndResolvesBodyIndex()
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
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["launchSites"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "LaunchPad",
                                ["displayName"] = "Launch Pad",
                                ["editorFacility"] = "VAB",
                                ["body"] = "Kerbin",
                                ["latitude"] = -0.0972,
                                ["longitude"] = 285.42,
                                ["isStock"] = true,
                                ["padOccupied"] = true,
                                ["padVesselTitle"] = "Kerbal X",
                            },
                            // No spawn-point keys: a site whose coordinate is unset
                            // must carry lat/lon null (never a fabricated 0), and
                            // must still be LISTED (unlike a POI, which BuildPois
                            // skips).
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Runway",
                                ["displayName"] = "Runway",
                                ["editorFacility"] = "SPH",
                                ["body"] = "Kerbin",
                                ["isStock"] = true,
                                ["padOccupied"] = null,
                                ["padVesselTitle"] = null,
                            },
                            // Synthetic MH / KK site: not stock, on the Mun.
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Woomerang",
                                ["displayName"] = "Woomerang Launch Site",
                                ["editorFacility"] = "VAB",
                                ["body"] = "Mun",
                                ["isStock"] = false,
                                ["padOccupied"] = null,
                                ["padVesselTitle"] = null,
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildLaunchSites(snapshot));
            Assert.Equal(3, list.Count);

            var pad = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("LaunchPad", pad["name"]);
            Assert.Equal("Launch Pad", pad["displayName"]);
            Assert.Equal("VAB", pad["editorFacility"]);
            Assert.Equal(1, pad["bodyIndex"]); // "Kerbin" -> index 1
            Assert.Equal(-0.0972, pad["latitude"]); // spawn-point coordinate copied through
            Assert.Equal(285.42, pad["longitude"]);
            Assert.Equal(true, pad["isStock"]);
            Assert.Equal(true, pad["padOccupied"]);
            Assert.Equal("Kerbal X", pad["padVesselTitle"]);

            var runway = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal("Runway", runway["name"]);
            Assert.Equal("SPH", runway["editorFacility"]);
            Assert.Null(runway["latitude"]); // no spawn-point keys -> null, but still listed
            Assert.Null(runway["longitude"]);
            Assert.Equal(true, runway["isStock"]);
            Assert.Null(runway["padOccupied"]); // only the stock pad carries occupancy
            Assert.Null(runway["padVesselTitle"]);

            var mh = Assert.IsType<Dictionary<string, object?>>(list[2]);
            Assert.Equal("Woomerang", mh["name"]);
            Assert.Equal(2, mh["bodyIndex"]); // "Mun" -> index 2
            Assert.Equal(false, mh["isStock"]);
        }

        [Fact]
        public void BuildLaunchSitesLeavesBodyIndexNullWhenBodyIsAbsentOrUnresolved()
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
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["launchSites"] = new List<object?>
                        {
                            new Dictionary<string, object?> { ["name"] = "NoBody", ["isStock"] = true }, // body absent
                            new Dictionary<string, object?> { ["name"] = "Unknown", ["body"] = "Eeloo", ["isStock"] = false },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildLaunchSites(snapshot));
            var first = Assert.IsType<Dictionary<string, object?>>(list[0]);
            var second = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Null(first["bodyIndex"]);
            Assert.Null(second["bodyIndex"]);
        }

        [Fact]
        public void BuildLaunchSitesReturnsEmptyListNotNullWhenTheUnionIsEmpty()
        {
            // Distinguishes "no data yet" (no key -> null) from "PSystemSetup
            // genuinely reports zero sites" (key present, empty list -> []).
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?> { ["launchSites"] = new List<object?>() },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildLaunchSites(snapshot));
            Assert.Empty(list);
        }

        [Fact]
        public void BuildLaunchSitesReturnsNullWhenSnapshotHasNoSpaceCenterKeyAtAll()
        {
            Assert.Null(SpaceCenterViewProvider.BuildLaunchSites(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
            Assert.Null(SpaceCenterViewProvider.BuildLaunchSites(null));
            // spaceCenter present but no launchSites sub-key -> still null.
            Assert.Null(SpaceCenterViewProvider.BuildLaunchSites(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["spaceCenter"] = new Dictionary<string, object?>() },
            }));
        }

        [Fact]
        public void BuildLaunchSitesSerializesCleanlyThroughTheRealWirePath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?> { new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 } },
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["launchSites"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "LaunchPad",
                                ["displayName"] = "Launch Pad",
                                ["editorFacility"] = "VAB",
                                ["body"] = "Kerbin",
                                ["isStock"] = true,
                                ["padOccupied"] = false,
                                ["padVesselTitle"] = null,
                            },
                        },
                    },
                },
            };

            var payload = SpaceCenterViewProvider.BuildLaunchSites(snapshot);

            var streamData = new StreamData<object?>
            {
                Topic = SpaceCenterViewProvider.LaunchSitesTopic,
                Payload = payload,
                Meta = new Meta { Source = "spaceCenter", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };

            var json = EnvelopeCodec.WriteStreamData(streamData);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            Assert.Equal(SpaceCenterViewProvider.LaunchSitesTopic, parsed.Topic);
            var parsedList = Assert.IsType<List<object?>>(parsed.Payload);
            var parsedPad = Assert.IsType<Dictionary<string, object?>>(Assert.Single(parsedList));
            Assert.Equal("LaunchPad", parsedPad["name"]);
            Assert.Equal(1, System.Convert.ToInt32(parsedPad["bodyIndex"]));
        }

        // ----------------------------------------------------------------
        // spaceCenter.scene
        // ----------------------------------------------------------------

        [Theory]
        [InlineData("FLIGHT", "Flight")]
        [InlineData("SPACECENTER", "SpaceCenter")]
        [InlineData("EDITOR", "Editor")]
        [InlineData("TRACKSTATION", "TrackingStation")]
        [InlineData("MAINMENU", "MainMenu")]
        // Everything outside the five named scenes folds to "Other", the real
        // GameScenes enum also has LOADING/LOADINGBUFFER/SETTINGS/CREDITS/
        // PSYSTEM/MISSIONBUILDER (decompile-verified), all of which map here.
        [InlineData("LOADING", "Other")]
        [InlineData("PSYSTEM", "Other")]
        [InlineData("MISSIONBUILDER", "Other")]
        [InlineData("SETTINGS", "Other")]
        [InlineData("SomethingUnenumerated", "Other")]
        public void BuildSceneFoldsEveryGameSceneNameToItsOutputString(string rawScene, string expected)
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["scene"] = rawScene },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildScene(snapshot));
            Assert.Equal(expected, root["scene"]);
        }

        [Fact]
        public void BuildSceneReturnsNullWhenSnapshotHasNoSceneKeyAtAll()
        {
            Assert.Null(SpaceCenterViewProvider.BuildScene(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
            Assert.Null(SpaceCenterViewProvider.BuildScene(null));
        }

        [Fact]
        public void BuildSceneSerializesCleanlyThroughTheRealWirePath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["scene"] = "SPACECENTER" },
            };

            var payload = SpaceCenterViewProvider.BuildScene(snapshot);

            var streamData = new StreamData<object?>
            {
                Topic = SpaceCenterViewProvider.SceneTopic,
                Payload = payload,
                Meta = new Meta { Source = "spaceCenter", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };

            var json = EnvelopeCodec.WriteStreamData(streamData);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal("SpaceCenter", parsedRoot["scene"]);
        }

        // ----------------------------------------------------------------
        // spaceCenter.crewRoster
        // ----------------------------------------------------------------

        [Fact]
        public void BuildCrewRosterMapsEveryKerbalAndFoldsRosterStatus()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["crewRoster"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Jebediah Kerman",
                                ["trait"] = "Pilot",
                                ["experienceLevel"] = 5,
                                ["rosterStatus"] = "Available",
                                ["rosterStatusOrdinal"] = 0,
                                ["courage"] = 0.9,
                                ["stupidity"] = 0.1,
                                ["experience"] = 64.0,
                                ["experienceLevelDelta"] = 1.0,
                                ["roleDescription"] = "Pilots are skilled at flying spacecraft.",
                                ["descriptionEffects"] = "Full control of the vessel.",
                            },
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Bill Kerman",
                                ["trait"] = "Engineer",
                                ["experienceLevel"] = 3,
                                ["rosterStatus"] = "Assigned",
                                ["rosterStatusOrdinal"] = 1,
                            },
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Bob Kerman",
                                ["trait"] = "Scientist",
                                ["experienceLevel"] = 2,
                                ["rosterStatus"] = "Missing",
                                ["rosterStatusOrdinal"] = 3,
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildCrewRoster(snapshot));
            Assert.Equal(3, list.Count);

            var jeb = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("Jebediah Kerman", jeb["name"]);
            Assert.Equal("Pilot", jeb["trait"]);
            Assert.Equal(5, jeb["experienceLevel"]);
            Assert.Equal(true, jeb["available"]);
            Assert.Equal("", jeb["unavailableReason"]);
            Assert.Equal("Available", jeb["situation"]);
            Assert.Equal(0.9, jeb["courage"]);
            Assert.Equal(0.1, jeb["stupidity"]);
            Assert.Equal(64.0, jeb["experience"]);
            Assert.Equal(1.0, jeb["experienceLevelDelta"]);
            Assert.Equal("Pilots are skilled at flying spacecraft.", jeb["roleDescription"]);
            Assert.Equal("Full control of the vessel.", jeb["descriptionEffects"]);

            var bill = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal(false, bill["available"]);
            Assert.Equal("On mission", bill["unavailableReason"]);
            Assert.Equal("Assigned", bill["situation"]);

            var bob = Assert.IsType<Dictionary<string, object?>>(list[2]);
            Assert.Equal(false, bob["available"]);
            Assert.Equal("Missing", bob["unavailableReason"]);
            // Situation is RAW, not folded: Dead and Missing stay distinct so a
            // client can auto-derive one tab per situation present.
            Assert.Equal("Missing", bob["situation"]);

            // The ordinal rides beside the name, and it is what the client
            // branches on.
            Assert.Equal(0, jeb["situationOrdinal"]);
            Assert.Equal(1, bill["situationOrdinal"]);
            Assert.Equal(3, bob["situationOrdinal"]);
            Assert.Equal(false, jeb["isApplicant"]);
        }

        /// <summary>
        /// The defect this channel's ordinal exists to end. Whether a kerbal is
        /// AVAILABLE - which decides whether the client offers to fire them, and
        /// which crew a mission can draw on - was decided by
        /// <c>rosterStatus == "Available"</c>. KSP owns that spelling. Rename the
        /// member and every kerbal in the game reads as unavailable, with the
        /// reason "whatever KSP now calls being free to fly", and nothing throws.
        ///
        /// <para>Here the ordinal says <c>Available</c> and the name is a
        /// spelling this build has never seen. The kerbal is available.</para>
        /// </summary>
        [Fact]
        public void BuildCrewRosterReadsAvailabilityFromTheOrdinalNotTheName()
        {
            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildCrewRoster(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["crewRoster"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Valentina Kerman",
                                ["rosterStatus"] = "Ready",
                                ["rosterStatusOrdinal"] = 0,
                            },
                        },
                    },
                },
            }));

            var val = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal(true, val["available"]);
            Assert.Equal("", val["unavailableReason"]);
            Assert.Equal(0, val["situationOrdinal"]);
            // The label is still the game's own word for it, because a label is
            // all it is.
            Assert.Equal("Ready", val["situation"]);
        }

        /// <summary>
        /// A status this build has never heard of - a mod appending to
        /// <c>RosterStatus</c>, RP-1's "Retired" being the standing example - is
        /// an UNKNOWN state. Unknown is not available, because we cannot promise
        /// the kerbal can fly; it is also not folded onto Dead or Missing, because
        /// we do not know that either. The ordinal reaches the client intact so
        /// the client can say so.
        /// </summary>
        [Fact]
        public void BuildCrewRosterCarriesAnUnrecognisedStatusThroughRatherThanGuessing()
        {
            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildCrewRoster(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["crewRoster"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Gene Kerman",
                                ["rosterStatus"] = "Retired",
                                ["rosterStatusOrdinal"] = 4,
                            },
                        },
                    },
                },
            }));

            var gene = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal(false, gene["available"]);
            Assert.Equal(4, gene["situationOrdinal"]);
            Assert.Equal("Retired", gene["situation"]);
            Assert.Equal("Retired", gene["unavailableReason"]);
        }

        /// <summary>
        /// An applicant has no <c>RosterStatus</c> at all: it is not in the
        /// roster. So the ordinal is null, which is a fact rather than an
        /// absence, and <c>isApplicant</c> carries the distinction so no client
        /// has to recognise the <c>"Applicant"</c> spelling to find it.
        /// </summary>
        [Fact]
        public void BuildApplicantsCarriesNoRosterOrdinalAndSaysWhy()
        {
            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildCrewRoster(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["crewRoster"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Dilsby Kerman",
                                ["rosterStatus"] = "Available",
                                ["rosterStatusOrdinal"] = 0,
                                ["isApplicant"] = true,
                            },
                        },
                    },
                },
            }));

            var dilsby = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("Applicant", dilsby["situation"]);
            Assert.Null(dilsby["situationOrdinal"]);
            Assert.Equal(true, dilsby["isApplicant"]);
            Assert.Equal(true, dilsby["available"]);
        }

        [Fact]
        public void BuildCrewRosterReturnsNullWhenNoCrewRosterKeyButEmptyListWhenPresentAndEmpty()
        {
            Assert.Null(SpaceCenterViewProvider.BuildCrewRoster(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
            Assert.Null(SpaceCenterViewProvider.BuildCrewRoster(null));
            Assert.Null(SpaceCenterViewProvider.BuildCrewRoster(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["spaceCenter"] = new Dictionary<string, object?>() },
            }));

            var empty = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildCrewRoster(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["spaceCenter"] = new Dictionary<string, object?> { ["crewRoster"] = new List<object?>() } },
            }));
            Assert.Empty(empty);
        }

        [Fact]
        public void BuildCrewRosterSerializesCleanlyThroughTheRealWirePath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["crewRoster"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Valentina Kerman",
                                ["trait"] = "Pilot",
                                ["experienceLevel"] = 4,
                                ["rosterStatus"] = "Available",
                                ["rosterStatusOrdinal"] = 0,
                            },
                        },
                    },
                },
            };

            var streamData = new StreamData<object?>
            {
                Topic = SpaceCenterViewProvider.CrewRosterTopic,
                Payload = SpaceCenterViewProvider.BuildCrewRoster(snapshot),
                Meta = new Meta { Source = "spaceCenter", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };

            var parsed = EnvelopeCodec.ParseStreamData(EnvelopeCodec.WriteStreamData(streamData));
            var parsedList = Assert.IsType<List<object?>>(parsed.Payload);
            var val = Assert.IsType<Dictionary<string, object?>>(Assert.Single(parsedList));
            Assert.Equal("Valentina Kerman", val["name"]);
            Assert.Equal(true, val["available"]);
        }

        // ----------------------------------------------------------------
        // spaceCenter.savedShips
        // ----------------------------------------------------------------

        [Fact]
        public void BuildSavedShipsMapsEveryCraftFieldForField()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["savedShips"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Kerbal X",
                                ["partCount"] = 42,
                                ["totalMass"] = 18.5,
                                ["facility"] = "VAB",
                                ["requiresFunds"] = 12345.0,
                                ["missingParts"] = new List<object?> { "partA", "partB" },
                            },
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Spaceplane",
                                ["partCount"] = 30,
                                ["totalMass"] = 12.0,
                                ["facility"] = "SPH",
                                ["requiresFunds"] = 6000.0,
                                ["missingParts"] = new List<object?>(),
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildSavedShips(snapshot));
            Assert.Equal(2, list.Count);

            var kx = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("Kerbal X", kx["name"]);
            Assert.Equal(42, kx["partCount"]);
            Assert.Equal(18.5, kx["totalMass"]);
            Assert.Equal("VAB", kx["facility"]);
            Assert.Equal(12345.0, kx["requiresFunds"]);
            var missing = Assert.IsType<List<object?>>(kx["missingParts"]);
            Assert.Equal(new object?[] { "partA", "partB" }, missing);

            var plane = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal("SPH", plane["facility"]);
            Assert.Empty(Assert.IsType<List<object?>>(plane["missingParts"]));
        }

        [Fact]
        public void BuildSavedShipsReturnsNullWhenNoSavedShipsKey()
        {
            Assert.Null(SpaceCenterViewProvider.BuildSavedShips(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
            Assert.Null(SpaceCenterViewProvider.BuildSavedShips(null));
            Assert.Null(SpaceCenterViewProvider.BuildSavedShips(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["spaceCenter"] = new Dictionary<string, object?>() },
            }));
        }

        [Fact]
        public void BuildSavedShipsSerializesCleanlyThroughTheRealWirePath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["savedShips"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Kerbal X",
                                ["partCount"] = 42,
                                ["totalMass"] = 18.5,
                                ["facility"] = "VAB",
                                ["requiresFunds"] = 12345.0,
                                ["missingParts"] = new List<object?> { "partA" },
                            },
                        },
                    },
                },
            };

            var streamData = new StreamData<object?>
            {
                Topic = SpaceCenterViewProvider.SavedShipsTopic,
                Payload = SpaceCenterViewProvider.BuildSavedShips(snapshot),
                Meta = new Meta { Source = "spaceCenter", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };

            var parsed = EnvelopeCodec.ParseStreamData(EnvelopeCodec.WriteStreamData(streamData));
            var parsedList = Assert.IsType<List<object?>>(parsed.Payload);
            var craft = Assert.IsType<Dictionary<string, object?>>(Assert.Single(parsedList));
            Assert.Equal("Kerbal X", craft["name"]);
            Assert.Equal(42, System.Convert.ToInt32(craft["partCount"]));
            Assert.Equal(new object?[] { "partA" }, Assert.IsType<List<object?>>(craft["missingParts"]));
        }

        // ----------------------------------------------------------------
        // spaceCenter.partsAvailable
        // ----------------------------------------------------------------

        [Fact]
        public void BuildPartsAvailableWrapsTheRawCount()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?> { ["partsAvailable"] = 137 },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildPartsAvailable(snapshot));
            Assert.Equal(137, root["count"]);
        }

        [Fact]
        public void BuildPartsAvailableTreatsZeroAsAValueNotAbsence()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?> { ["partsAvailable"] = 0 },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildPartsAvailable(snapshot));
            Assert.Equal(0, root["count"]);
        }

        [Fact]
        public void BuildPartsAvailableReturnsNullWhenNoPartsAvailableKey()
        {
            Assert.Null(SpaceCenterViewProvider.BuildPartsAvailable(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
            Assert.Null(SpaceCenterViewProvider.BuildPartsAvailable(null));
            Assert.Null(SpaceCenterViewProvider.BuildPartsAvailable(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["spaceCenter"] = new Dictionary<string, object?>() },
            }));
        }

        [Fact]
        public void BuildPartsAvailableSerializesCleanlyThroughTheRealWirePath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?> { ["partsAvailable"] = 88 },
                },
            };

            var streamData = new StreamData<object?>
            {
                Topic = SpaceCenterViewProvider.PartsAvailableTopic,
                Payload = SpaceCenterViewProvider.BuildPartsAvailable(snapshot),
                Meta = new Meta { Source = "spaceCenter", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };

            var parsed = EnvelopeCodec.ParseStreamData(EnvelopeCodec.WriteStreamData(streamData));
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal(88, System.Convert.ToInt32(parsedRoot["count"]));
        }

        // ----------------------------------------------------------------
        // spaceCenter.pois
        // ----------------------------------------------------------------

        /// <summary>
        /// Regression for the review fix: stock KSP uses <c>0.0</c> as
        /// <c>Contract.DateDeadline</c>'s "no deadline set" sentinel
        /// (confirmed via decompile: <c>Contract</c>'s own UI code gates on
        /// <c>DateDeadline != 0.0</c> before showing a deadline). Before this
        /// fix, a no-deadline contract's raw <c>0</c> rode straight onto the
        /// wire and read as "overdue since epoch"; this asserts it now folds
        /// to <c>null</c>, the same "no data" signal every other optional
        /// field in this payload uses.
        /// </summary>
        [Fact]
        public void BuildPoisFoldsAZeroContractDateDeadlineToNull()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["contractTargets"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["navigationId"] = "wp-1",
                                ["celestialName"] = "Kerbin",
                                ["latitude"] = 12.3,
                                ["longitude"] = 45.6,
                                ["isOnSurface"] = true,
                                ["contractState"] = "Active",
                                ["contractTitle"] = "Survey the flats",
                                ["contractDateDeadline"] = 0.0,
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildPois(snapshot));
            var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));
            Assert.Null(entry["contractDateDeadline"]);
        }

        /// <summary>A genuinely-set (non-zero) deadline passes through unfolded.</summary>
        [Fact]
        public void BuildPoisPassesThroughANonZeroContractDateDeadline()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["contractTargets"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["navigationId"] = "wp-1",
                                ["celestialName"] = "Kerbin",
                                ["latitude"] = 12.3,
                                ["longitude"] = 45.6,
                                ["isOnSurface"] = true,
                                ["contractState"] = "Active",
                                ["contractTitle"] = "Survey the flats",
                                ["contractDateDeadline"] = 98765.0,
                            },
                        },
                    },
                },
            };

            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildPois(snapshot));
            var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));
            Assert.Equal(98765.0, entry["contractDateDeadline"]);
        }

        // ----------------------------------------------------------------
        // spaceCenter.astronautComplex
        // ----------------------------------------------------------------

        [Fact]
        public void BuildAstronautComplexMapsEveryApplicantAndTheCapContext()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["astronautComplex"] = new Dictionary<string, object?>
                        {
                            ["applicants"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["name"] = "Desdin Kerman",
                                    ["trait"] = "Scientist",
                                    ["experienceLevel"] = 0,
                                    ["rosterStatus"] = "Available",
                                    ["rosterStatusOrdinal"] = 0,
                                    ["isApplicant"] = true,
                                },
                                new Dictionary<string, object?>
                                {
                                    ["name"] = "Limmy Kerman",
                                    ["trait"] = "Pilot",
                                    ["experienceLevel"] = 0,
                                    ["rosterStatus"] = "Available",
                                    ["rosterStatusOrdinal"] = 0,
                                    ["isApplicant"] = true,
                                },
                            },
                            ["activeCrew"] = 4,
                            ["crewCapacity"] = 13,
                            ["nextHireCost"] = 24000.0,
                        },
                    },
                },
            };

            var info = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildAstronautComplex(snapshot));
            Assert.Equal(4, info["activeCrew"]);
            Assert.Equal(13, info["crewCapacity"]);
            Assert.Equal(24000.0, info["nextHireCost"]);

            var applicants = Assert.IsType<List<object?>>(info["applicants"]);
            Assert.Equal(2, applicants.Count);

            var first = Assert.IsType<Dictionary<string, object?>>(applicants[0]);
            Assert.Equal("Desdin Kerman", first["name"]);
            Assert.Equal("Scientist", first["trait"]);
            Assert.Equal(0, first["experienceLevel"]);
            Assert.Equal("Applicant", first["situation"]);
            Assert.Equal(true, first["available"]);

            var second = Assert.IsType<Dictionary<string, object?>>(applicants[1]);
            Assert.Equal("Limmy Kerman", second["name"]);
            Assert.Equal("Pilot", second["trait"]);
            Assert.Equal("Applicant", second["situation"]);
        }

        [Fact]
        public void BuildAstronautComplexReturnsNullOffCareerButANonNullEmptyPoolInCareer()
        {
            // No astronautComplex key at all: "not in career" -> whole payload null.
            Assert.Null(SpaceCenterViewProvider.BuildAstronautComplex(new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));
            Assert.Null(SpaceCenterViewProvider.BuildAstronautComplex(null));
            Assert.Null(SpaceCenterViewProvider.BuildAstronautComplex(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["spaceCenter"] = new Dictionary<string, object?>() },
            }));

            // Career with an empty pool: non-null payload, empty applicants list.
            var info = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildAstronautComplex(new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["astronautComplex"] = new Dictionary<string, object?>
                        {
                            ["applicants"] = new List<object?>(),
                            ["activeCrew"] = 0,
                            ["crewCapacity"] = 5,
                        },
                    },
                },
            }));
            Assert.Empty(Assert.IsType<List<object?>>(info["applicants"]));
            Assert.Equal(0, info["activeCrew"]);
            Assert.Equal(5, info["crewCapacity"]);
        }

        [Fact]
        public void BuildAstronautComplexSerializesCleanlyThroughTheRealWirePath()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["astronautComplex"] = new Dictionary<string, object?>
                        {
                            ["applicants"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["name"] = "Valentina Kerman",
                                    ["trait"] = "Pilot",
                                    ["experienceLevel"] = 0,
                                    ["rosterStatus"] = "Available",
                                    ["rosterStatusOrdinal"] = 0,
                                    ["isApplicant"] = true,
                                },
                            },
                            ["activeCrew"] = 4,
                            ["crewCapacity"] = 13,
                            ["nextHireCost"] = 24000.0,
                        },
                    },
                },
            };

            var streamData = new StreamData<object?>
            {
                Topic = SpaceCenterViewProvider.AstronautComplexTopic,
                Payload = SpaceCenterViewProvider.BuildAstronautComplex(snapshot),
                Meta = new Meta { Source = "spaceCenter", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };

            var parsed = EnvelopeCodec.ParseStreamData(EnvelopeCodec.WriteStreamData(streamData));
            var info = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            // Numbers arrive from the JSON round-trip widened (long/double), so
            // compare via Convert rather than an exact CLR-type Assert.Equal.
            Assert.Equal(13, Convert.ToInt32(info["crewCapacity"]));
            Assert.Equal(24000.0, Convert.ToDouble(info["nextHireCost"]));
            var applicants = Assert.IsType<List<object?>>(info["applicants"]);
            var val = Assert.IsType<Dictionary<string, object?>>(Assert.Single(applicants));
            Assert.Equal("Valentina Kerman", val["name"]);
            Assert.Equal("Applicant", val["situation"]);
        }

        [Fact]
        public void BuildAstronautComplexRoundTripsAnUncappedCrewCapacityWithoutClampingOrTruncation()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["spaceCenter"] = new Dictionary<string, object?>
                    {
                        ["astronautComplex"] = new Dictionary<string, object?>
                        {
                            ["applicants"] = new List<object?>(),
                            ["activeCrew"] = 4,
                            ["crewCapacity"] = int.MaxValue,
                            ["nextHireCost"] = 24000.0,
                        },
                    },
                },
            };

            var info = Assert.IsType<Dictionary<string, object?>>(SpaceCenterViewProvider.BuildAstronautComplex(snapshot));
            Assert.IsType<int>(info["crewCapacity"]);
            Assert.Equal(int.MaxValue, info["crewCapacity"]);

            var streamData = new StreamData<object?>
            {
                Topic = SpaceCenterViewProvider.AstronautComplexTopic,
                Payload = info,
                Meta = new Meta { Source = "spaceCenter", ValidAt = 0, Vantage = "host", Quality = Quality.Loaded, Active = true, Staleness = Staleness.Fresh },
            };

            var parsed = EnvelopeCodec.ParseStreamData(EnvelopeCodec.WriteStreamData(streamData));
            var replayed = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            // Numbers arrive from the JSON round-trip widened (long/double), so
            // compare via Convert rather than an exact CLR-type Assert.Equal.
            Assert.Equal(2147483647, Convert.ToInt32(replayed["crewCapacity"]));
        }
    }
}
