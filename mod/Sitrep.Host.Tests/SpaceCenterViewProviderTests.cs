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
            // Dead and Missing stay distinct: the standing is not folded onto a
            // single "cannot fly".
            Assert.Equal("Missing", bob["situation"]);

            // The standing is what the client branches on, and with no backend
            // wired it is the contract's own map of KSP's roster status.
            Assert.Equal((int)CrewStanding.Available, jeb["standing"]);
            Assert.Equal((int)CrewStanding.Assigned, bill["standing"]);
            Assert.Equal((int)CrewStanding.Missing, bob["standing"]);

            // KSP's own ordinal rides beside it, unfolded.
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
        /// spelling this build has never seen. The kerbal is available, and the
        /// LABEL is this contract's word rather than KSP's, so a Squad rename
        /// cannot reach an operator's screen either.</para>
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
            Assert.Equal((int)CrewStanding.Available, val["standing"]);
            Assert.Equal("Available", val["situation"]);
        }

        /// <summary>
        /// A roster ordinal this build has never heard of is an UNKNOWN standing.
        /// Unknown is not available, because we cannot promise the kerbal can
        /// fly; it is also not folded onto Dead or Missing, because we do not
        /// know that either, and it does not become the WORD "Unknown" in the
        /// reason field, because that reads as a diagnosis where the truth is
        /// silence. The raw ordinal reaches the client intact.
        ///
        /// <para>This case is NOT how RP-1's retirement arrives, and the comment
        /// here used to say it was. RP-1 appends no member to
        /// <c>RosterStatus</c>: it writes stock's <c>Dead</c>, ordinal 2, and a
        /// retiree therefore arrives at the recognised-status path above looking
        /// exactly like a fatality. That is what the crew-standing capability is
        /// for; see <see cref="CrewStandingElectionTests"/>.</para>
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
                                ["rosterStatus"] = "Furloughed",
                                ["rosterStatusOrdinal"] = 9,
                            },
                        },
                    },
                },
            }));

            var gene = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal(false, gene["available"]);
            Assert.Equal(9, gene["situationOrdinal"]);
            Assert.Equal((int)CrewStanding.Unknown, gene["standing"]);
            Assert.Equal("Unknown", gene["situation"]);
            Assert.Equal("", gene["unavailableReason"]);
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
            Assert.Equal((int)CrewStanding.Applicant, dilsby["standing"]);
            Assert.Null(dilsby["situationOrdinal"]);
            Assert.Equal(true, dilsby["isApplicant"]);
            Assert.Equal(true, dilsby["available"]);
        }

        /// <summary>
        /// THE defect, at the provider. An RP-1 retiree arrives with stock's
        /// <c>Dead</c> in the roster ordinal, because that is literally what RP-1
        /// wrote there, and the elected backend's corrected standing is what the
        /// provider must derive every operator-facing field from.
        ///
        /// <para>The three fields that mattered: <c>situation</c>, which the
        /// Astronaut Complex groups by, and <c>unavailableReason</c>, which
        /// LaunchDirector shows in the tooltip of a greyed-out crew chip. Before
        /// the capability both read "Dead" about a kerbal drawing a pension.</para>
        /// </summary>
        [Fact]
        public void BuildCrewRosterPrefersTheStampedStandingOverKspsOwnDeadOrdinal()
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
                                ["name"] = "Wernher Kerman",
                                ["rosterStatus"] = "Dead",
                                ["rosterStatusOrdinal"] = (int)KspRosterStatus.Dead,
                                ["standing"] = (int)CrewStanding.Retired,
                                ["standingSource"] = "rp1",
                            },
                        },
                    },
                },
            }));

            var wernher = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal((int)CrewStanding.Retired, wernher["standing"]);
            Assert.Equal("Retired", wernher["situation"]);
            Assert.Equal("Retired", wernher["unavailableReason"]);
            Assert.Equal(false, wernher["available"]);
            Assert.Equal("rp1", wernher["standingSource"]);

            // And KSP's own answer is still on the wire, unfolded, because what
            // the game holds is worth knowing even when it is not the answer.
            Assert.Equal((int)KspRosterStatus.Dead, wernher["situationOrdinal"]);
        }

        /// <summary>
        /// A backend may override the availability wording in its own words, and
        /// a null override leaves the derivation from the standing standing. Both
        /// halves matter: the second is the ordinary case for a backend that only
        /// corrects a handful of names.
        /// </summary>
        [Fact]
        public void BuildCrewRosterHonoursABackendsOwnAvailabilityWording()
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
                                ["name"] = "Gus Kerman",
                                ["rosterStatusOrdinal"] = (int)KspRosterStatus.Available,
                                ["standing"] = (int)CrewStanding.Available,
                                ["standingAvailable"] = false,
                                ["standingUnavailableReason"] = "Grounded pending training",
                            },
                        },
                    },
                },
            }));

            var gus = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal(false, gus["available"]);
            Assert.Equal("Grounded pending training", gus["unavailableReason"]);
            // The standing is untouched: the override is about flying today, not
            // about where the kerbal sits on the books.
            Assert.Equal((int)CrewStanding.Available, gus["standing"]);
            Assert.Equal("Available", gus["situation"]);
        }

        /// <summary>
        /// The stand-down pair. <c>inactive</c> is a STOCK field on a separate
        /// axis from the standing, so a resting kerbal is still
        /// <c>Available</c>; and the end time is withheld once the rest is over,
        /// because KSP leaves the field at whatever the last rest period set and
        /// quoting it would date a rest that has already finished.
        /// </summary>
        /// <summary>
        /// A kerbal standing down is <see cref="CrewStanding.Resting"/>,
        /// unavailable, and dated, and one who has finished resting is neither.
        /// </summary>
        /// <remarks>
        /// This case used to assert the opposite, and it is worth saying so
        /// plainly: it pinned <c>available: true</c> and <c>standing: Available</c>
        /// for a kerbal mid-stand-down, because <c>inactive</c> reached the wire
        /// with nothing deriving from it and the test recorded what the code did.
        /// The premise had a comment on the payload agreeing with it, so a reader
        /// found two things saying a resting kerbal was free to fly and nothing
        /// saying otherwise.
        ///
        /// <para>The stand-down's END is still quoted only while the stand-down is
        /// live, which is the part the original case was right about: KSP leaves
        /// <c>inactiveTimeEnd</c> at whatever the last rest period wrote, so
        /// quoting it for a kerbal back on duty would date a rest already over.
        /// It is now asserted on <c>standingEndsAtUt</c> as well, which is the
        /// field a client reads it from.</para>
        /// </remarks>
        [Fact]
        public void BuildCrewRosterMakesAStandDownAStandingAndDatesItOnlyWhileItLasts()
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
                                ["name"] = "Resting Kerman",
                                ["rosterStatusOrdinal"] = (int)KspRosterStatus.Available,
                                ["inactive"] = true,
                                ["inactiveUntilUt"] = 12345.0,
                            },
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Rested Kerman",
                                ["rosterStatusOrdinal"] = (int)KspRosterStatus.Available,
                                ["inactive"] = false,
                                ["inactiveUntilUt"] = 999.0,
                            },
                        },
                    },
                },
            }));

            var resting = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal(true, resting["inactive"]);
            Assert.Equal(12345.0, resting["inactiveUntilUt"]);
            Assert.Equal((int)CrewStanding.Resting, resting["standing"]);
            Assert.Equal(false, resting["available"]);
            Assert.Equal("Standing down", resting["unavailableReason"]);
            Assert.Equal(12345.0, resting["standingEndsAtUt"]);

            var rested = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal(false, rested["inactive"]);
            Assert.Null(rested["inactiveUntilUt"]);
            Assert.Equal((int)CrewStanding.Available, rested["standing"]);
            Assert.Equal(true, rested["available"]);
            Assert.Null(rested["standingEndsAtUt"]);
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
                                ["facilityOrdinal"] = 1,
                                ["requiresFunds"] = 12345.0,
                                ["missingParts"] = new List<object?> { "partA", "partB" },
                            },
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Spaceplane",
                                ["partCount"] = 30,
                                ["totalMass"] = 12.0,
                                ["facility"] = "SPH",
                                ["facilityOrdinal"] = 2,
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

            // The ordinal rides beside the name. It is what the client resolves
            // the launch's editor from, so the name is a row label only.
            Assert.Equal(1, kx["facilityOrdinal"]);
            Assert.Equal(2, plane["facilityOrdinal"]);
        }

        /// <summary>
        /// A saved craft the capture reported with no facility ordinal carries
        /// <c>null</c>, not a guessed editor. The client passes the raw name
        /// through in that case so the mod can refuse it, which is the whole
        /// point: the substitution this replaced turned a refusal into a launch
        /// from the wrong editor.
        /// </summary>
        [Fact]
        public void BuildSavedShipsCarriesNoFacilityOrdinalRatherThanGuessingOne()
        {
            var list = Assert.IsType<List<object?>>(SpaceCenterViewProvider.BuildSavedShips(new KspSnapshot
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
                                ["name"] = "Mystery Craft",
                                ["facility"] = "Foundry",
                            },
                        },
                    },
                },
            }));

            var craft = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("Foundry", craft["facility"]);
            Assert.Null(craft["facilityOrdinal"]);
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
                                ["facilityOrdinal"] = 1,
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
