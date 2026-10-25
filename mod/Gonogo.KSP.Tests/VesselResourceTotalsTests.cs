using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class VesselResourceTotalsTests
    {
        private static Dictionary<string, object?> Row(Dictionary<string, object?> totals, string name) =>
            Assert.IsType<Dictionary<string, object?>>(totals[name]);

        private static VesselResourceTotals.Reading R(string n, double a, double m, bool flows = true) =>
            new VesselResourceTotals.Reading(n, a, m, flows);

        private static readonly VesselResourceTotals.Reading[] None = new VesselResourceTotals.Reading[0];

        [Fact]
        public void ANoFlowResourceOnOnePartIsCounted()
        {
            var totals = VesselResourceTotals.Sum(
                new[] { R("LiquidFuel", 100.0, 400.0) },
                new[] { R("Food", 12.5, 30.0, flows: false) });

            var food = Row(totals, "Food");
            Assert.Equal(12.5, food["current"]);
            Assert.Equal(30.0, food["max"]);
        }

        [Fact]
        public void AFlowingResourceOnAPartIsNotCountedBeyondTheConnectedTotal()
        {
            var totals = VesselResourceTotals.Sum(
                new[] { R("LiquidFuel", 100.0, 400.0) },
                new[] { R("LiquidFuel", 100.0, 400.0), R("LiquidFuel", 50.0, 200.0) });

            var fuel = Row(totals, "LiquidFuel");
            Assert.Equal(100.0, fuel["current"]);
            Assert.Equal(400.0, fuel["max"]);
        }

        [Fact]
        public void ANoFlowResourceIsSummedAcrossParts()
        {
            var totals = VesselResourceTotals.Sum(
                None,
                new[] { R("Water", 10.0, 20.0, false), R("Water", 5.0, 40.0, false) });

            var water = Row(totals, "Water");
            Assert.Equal(15.0, water["current"]);
            Assert.Equal(60.0, water["max"]);
        }

        [Fact]
        public void AResourceWithNoCapacityIsLeftOut()
        {
            var totals = VesselResourceTotals.Sum(new[] { R("Ore", 0.0, 0.0) }, None);

            Assert.Empty(totals);
        }

        [Fact]
        public void StockFuelsComeFirstThenTheRestAlphabetically()
        {
            var totals = VesselResourceTotals.Sum(
                new[] { R("Oxidizer", 1.0, 2.0), R("LiquidFuel", 1.0, 2.0) },
                new[] { R("Oxygen", 1.0, 2.0, false), R("Food", 1.0, 2.0, false) });

            Assert.Equal(new[] { "LiquidFuel", "Oxidizer", "Food", "Oxygen" }, new List<string>(totals.Keys));
        }
    }
}
