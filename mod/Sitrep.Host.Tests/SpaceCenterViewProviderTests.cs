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
    /// rules — the launch-site roster keyed and distinguishable (stock pad +
    /// runway + a synthetic MH/KK site), <c>isStock</c> honored, body NAME
    /// resolved to a <c>system.bodies</c> index, the scene enum folded to the
    /// six output strings (incl. the <c>"Other"</c> fallback), and null-not-
    /// empty when the snapshot has no data yet — plus a clean round-trip
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
                                ["isStock"] = true,
                                ["padOccupied"] = true,
                                ["padVesselTitle"] = "Kerbal X",
                            },
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
            Assert.Equal(true, pad["isStock"]);
            Assert.Equal(true, pad["padOccupied"]);
            Assert.Equal("Kerbal X", pad["padVesselTitle"]);

            var runway = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal("Runway", runway["name"]);
            Assert.Equal("SPH", runway["editorFacility"]);
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
        // Everything outside the five named scenes folds to "Other" — the real
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
    }
}
