using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.SilenceTracking
{
    /// <summary>
    /// A fleet vessel's tank levels. The cases worth having are the ones where
    /// a number would be misleading rather than merely wrong: a tank the craft
    /// does not carry, and a tank it carries but has emptied.
    /// </summary>
    public class FleetVesselResourcesBuilderTests
    {
        private static Dictionary<string, object?> Row(
            Dictionary<string, object?> resources,
            string name) =>
            Assert.IsType<Dictionary<string, object?>>(resources[name]);

        [Fact]
        public void RecordsAResourceAsCurrentAndMax()
        {
            var resources = new Dictionary<string, object?>();

            Assert.True(FleetVesselResourcesBuilder.Add(resources, "LiquidFuel", 120.0, 400.0));

            var row = Row(resources, "LiquidFuel");
            Assert.Equal(120.0, row["current"]);
            Assert.Equal(400.0, row["max"]);
            Assert.Equal(true, row["active"]);
        }

        [Fact]
        public void SumsTheSameResourceAcrossParts()
        {
            var resources = new Dictionary<string, object?>();

            FleetVesselResourcesBuilder.Add(resources, "LiquidFuel", 120.0, 400.0);
            FleetVesselResourcesBuilder.Add(resources, "LiquidFuel", 80.0, 200.0);

            var row = Row(resources, "LiquidFuel");
            Assert.Equal(200.0, row["current"]);
            Assert.Equal(600.0, row["max"]);
        }

        /// <summary>
        /// An emptied tank is a real, meaningful reading and has to survive. It
        /// is the one an operator most wants to see, and dropping it would make
        /// "ran out" indistinguishable from "never carried it".
        /// </summary>
        [Fact]
        public void KeepsAResourceTheCraftCarriesButHasEmptied()
        {
            var resources = new Dictionary<string, object?>();

            Assert.True(FleetVesselResourcesBuilder.Add(resources, "Oxidizer", 0.0, 500.0));

            var row = Row(resources, "Oxidizer");
            Assert.Equal(0.0, row["current"]);
            Assert.Equal(500.0, row["max"]);
        }

        /// <summary>
        /// A resource with no capacity is STRUCTURAL absence: the craft does not
        /// carry it. Emitting `0 / 0` would turn that into a reading, which is
        /// the exact ambiguity the three-way absence contract exists to stop.
        /// </summary>
        [Fact]
        public void DropsAResourceTheCraftDoesNotCarry()
        {
            var resources = new Dictionary<string, object?>();

            Assert.False(FleetVesselResourcesBuilder.Add(resources, "Ore", 0.0, 0.0));

            Assert.Empty(resources);
        }

        [Fact]
        public void DropsAResourceWithNoName()
        {
            var resources = new Dictionary<string, object?>();

            Assert.False(FleetVesselResourcesBuilder.Add(resources, null, 10.0, 10.0));
            Assert.False(FleetVesselResourcesBuilder.Add(resources, "", 10.0, 10.0));

            Assert.Empty(resources);
        }

        [Fact]
        public void WrapsTheMapAsTheContractShapeDeclaresIt()
        {
            var resources = new Dictionary<string, object?>();
            FleetVesselResourcesBuilder.Add(resources, "ElectricCharge", 40.0, 100.0);

            var payload = FleetVesselResourcesBuilder.Build(resources);

            var map = Assert.IsType<Dictionary<string, object?>>(payload["resources"]);
            Assert.True(map.ContainsKey("ElectricCharge"));
        }

        /// <summary>
        /// A craft carrying nothing is an empty map, not an absent key: absent
        /// means the topic has not delivered, and those are different states.
        /// </summary>
        [Fact]
        public void ACraftWithNoTanksIsAnEmptyMapRatherThanAnAbsentKey()
        {
            var payload = FleetVesselResourcesBuilder.Build(new Dictionary<string, object?>());

            Assert.True(payload.ContainsKey("resources"));
            Assert.Empty(Assert.IsType<Dictionary<string, object?>>(payload["resources"]));
        }
    }
}
