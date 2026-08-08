using System.Collections.Generic;
using Sitrep.Host;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the <c>parts.power</c> capture-add's
    /// <see cref="PartsViewProvider"/>: fake <see cref="KspSnapshot"/>s
    /// carrying the raw <c>"parts"</c> encoding <c>Gonogo.KSP.KspHost.
    /// BuildParts</c> produces are mapped to <c>parts.power</c> and asserted
    /// against the class doc's rules, no-vessel/no-data -&gt; null,
    /// primitives-only shape. The sibling Breaking Ground robotics tests that
    /// used to live here moved to <c>BreakingGroundViewProviderTests</c>
    /// alongside the split-out <see cref="BreakingGroundViewProvider"/>.
    /// </summary>
    public class PartsViewProviderTests
    {
        [Fact]
        public void BuildPowerReturnsNullWhenSnapshotHasNoPartsKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(PartsViewProvider.BuildPower(snapshot));
        }

        [Fact]
        public void BuildPowerReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(PartsViewProvider.BuildPower(null));
        }

        [Fact]
        public void BuildPowerMapsSolarBatteryFuelCellAndAlternatorEntries()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["power"] = new Dictionary<string, object?>
                        {
                            ["solarPanels"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["partName"] = "OX-STAT Photovoltaic Panels",
                                    ["deployState"] = "EXTENDED",
                                    ["flowRate"] = 1.6,
                                    ["chargeRate"] = 2.0,
                                    ["sunAOA"] = 0.95,
                                },
                            },
                            ["batteries"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["partName"] = "Z-200 Battery Pack",
                                    ["current"] = 150.0,
                                    ["max"] = 200.0,
                                },
                            },
                            ["fuelCells"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["partName"] = "Fuel Cell",
                                    ["active"] = true,
                                    ["status"] = "Nominal",
                                },
                            },
                            ["alternators"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["partName"] = "LV-909 \"Terrier\" Liquid Fuel Engine",
                                    ["outputRate"] = 4.0,
                                },
                            },
                            ["totalProductionEc"] = 5.6,
                        },
                    },
                },
            };

            var payload = PartsViewProvider.BuildPower(snapshot);
            var root = Assert.IsType<Dictionary<string, object?>>(payload);

            var solar = Assert.IsType<List<object?>>(root["solarPanels"]);
            var panel = Assert.IsType<Dictionary<string, object?>>(Assert.Single(solar));
            Assert.Equal("OX-STAT Photovoltaic Panels", panel["partName"]);
            Assert.Equal("EXTENDED", panel["deployState"]);
            Assert.Equal(1.6, panel["flowRate"]);

            var batteries = Assert.IsType<List<object?>>(root["batteries"]);
            var battery = Assert.IsType<Dictionary<string, object?>>(Assert.Single(batteries));
            Assert.Equal(150.0, battery["current"]);
            Assert.Equal(200.0, battery["max"]);

            var fuelCells = Assert.IsType<List<object?>>(root["fuelCells"]);
            var fuelCell = Assert.IsType<Dictionary<string, object?>>(Assert.Single(fuelCells));
            Assert.Equal(true, fuelCell["active"]);
            Assert.Equal("Nominal", fuelCell["status"]);

            var alternators = Assert.IsType<List<object?>>(root["alternators"]);
            Assert.Single(alternators);

            Assert.Equal(5.6, root["totalProductionEc"]);
        }

        /// <summary>
        /// The bug this field exists to fix: a multirotor's symmetric arms
        /// (or any two same-named parts) are indistinguishable by
        /// <c>partName</c> alone, which is exactly why join-by-name
        /// mis-attributed readouts across parts. Two raw entries sharing a
        /// <c>partName</c> but carrying distinct <c>partId</c>s (as
        /// <c>Gonogo.KSP.KspHost.BuildParts</c> now stamps from each part's
        /// <c>flightID</c>) must come out the other side of
        /// <see cref="PartsViewProvider.BuildPower"/> still distinguishable.
        /// The robotics half of this same fixture is asserted in
        /// <c>BreakingGroundViewProviderTests</c>.
        /// </summary>
        [Fact]
        public void SameNamedPartsGetDistinctPartIdsThroughBuildPower()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["power"] = new Dictionary<string, object?>
                        {
                            ["solarPanels"] = new List<object?>(),
                            ["batteries"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["partName"] = "Z-200 Battery Pack",
                                    ["partId"] = "1001",
                                    ["current"] = 150.0,
                                    ["max"] = 200.0,
                                },
                                new Dictionary<string, object?>
                                {
                                    ["partName"] = "Z-200 Battery Pack",
                                    ["partId"] = "1002",
                                    ["current"] = 175.0,
                                    ["max"] = 200.0,
                                },
                            },
                            ["fuelCells"] = new List<object?>(),
                            ["alternators"] = new List<object?>(),
                            ["totalProductionEc"] = 0.0,
                        },
                    },
                },
            };

            var power = Assert.IsType<Dictionary<string, object?>>(PartsViewProvider.BuildPower(snapshot));
            var batteries = Assert.IsType<List<object?>>(power["batteries"]);
            Assert.Equal(2, batteries.Count);
            var battery1 = Assert.IsType<Dictionary<string, object?>>(batteries[0]);
            var battery2 = Assert.IsType<Dictionary<string, object?>>(batteries[1]);
            Assert.Equal("Z-200 Battery Pack", battery1["partName"]);
            Assert.Equal("Z-200 Battery Pack", battery2["partName"]);
            Assert.Equal("1001", battery1["partId"]);
            Assert.Equal("1002", battery2["partId"]);
            Assert.NotEqual(battery1["partId"], battery2["partId"]);
        }
    }
}
