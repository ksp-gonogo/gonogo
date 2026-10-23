using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class LaunchAffordabilityTests
    {
        [Fact]
        public void ACraftCostingMoreThanTheFundsWithItsModulesIsRefusedWithTheRealCost()
        {
            var refusal = LaunchRule.Unaffordable(costWithModules: 400713, funds: 41200);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.InsufficientFunds, refusal!.ErrorCode);
            Assert.Contains("400,713", refusal.Detail);
            Assert.Contains("41,200", refusal.Detail);
        }

        [Fact]
        public void AffordableOrUnpricedCraftAreNotRefused()
        {
            Assert.Null(LaunchRule.Unaffordable(8202, 41200));
            Assert.Null(LaunchRule.Unaffordable(41200, 41200));
            Assert.Null(LaunchRule.Unaffordable(null, 41200));
            Assert.Null(LaunchRule.Unaffordable(400713, null));
        }

        [Fact]
        public void TheLaunchPricesTheCraftWithItsModulesBeforeItIsPlaced()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs");
            var launch = CurrencyDelaySourceText.MethodBody(source, "public CommandResult Launch(string shipName, EditorFacilityKind facility, string site, IReadOnlyList<string> crew)");

            var priced = launch.IndexOf("CraftCatalogueBackend.CostWithModules(", StringComparison.Ordinal);
            var placed = launch.IndexOf("LaunchRule.Place(", StringComparison.Ordinal);

            Assert.True(priced >= 0 && priced < placed, "the launch must be priced with its modules before FlightDriver is called");
        }

        [Fact]
        public void TheCraftListPriceIsTheOneWithModulesWhereTheCraftHasBeenPriced()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");
            var price = CurrencyDelaySourceText.MethodBody(source, "private static void ApplyModulePrice(string file, long stamp, Dictionary<string, object?> entry, ref int budget)");
            var scan = CurrencyDelaySourceText.MethodBody(source, "private static List<object?>? ScanSavedShips(double ut, bool wanted)");

            Assert.Contains("CraftCatalogueBackend.CostWithModules(", price, StringComparison.Ordinal);
            Assert.Contains("entry[\"requiresFunds\"] = cost.Value", price, StringComparison.Ordinal);
            Assert.Contains("ApplyModulePrice(file, stamp, entry,", scan, StringComparison.Ordinal);
        }
    }
}
