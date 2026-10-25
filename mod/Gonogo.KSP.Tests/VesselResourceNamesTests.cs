using System.Linq;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class VesselResourceNamesTests
    {
        [Fact]
        public void EveryResourceTheGameDefinesIsReportedNotOnlyTheStockFuels()
        {
            var names = VesselResourceNames.Order(new[] { "Food", "ElectricCharge", "Oxygen", "Water" });

            Assert.Contains("Food", names);
            Assert.Contains("Oxygen", names);
            Assert.Contains("Water", names);
        }

        [Fact]
        public void StockResourcesComeFirstInTheirFixedOrderAndTheRestFollowAlphabetically()
        {
            var names = VesselResourceNames.Order(new[] { "Water", "Ablator", "LiquidFuel", "Food" });

            Assert.Equal(new[] { "LiquidFuel", "Ablator", "Food", "Water" }, names.ToArray());
        }

        [Fact]
        public void ADuplicateDefinitionIsReportedOnce()
        {
            var names = VesselResourceNames.Order(new[] { "Food", "Food", "Ore" });

            Assert.Equal(new[] { "Ore", "Food" }, names.ToArray());
        }
    }
}
