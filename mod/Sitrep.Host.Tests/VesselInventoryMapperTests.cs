using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// An empty <c>vessel.inventory</c> says nothing aboard carries cargo, so it may only
    /// come from holds that were read. Holds that could not be read are absent.
    /// </summary>
    public class VesselInventoryMapperTests
    {
        private static KspSnapshot Snapshot(Dictionary<string, object?> vessel) => new KspSnapshot
        {
            Ut = 100.0,
            Values = new Dictionary<string, object?> { ["vessel"] = vessel },
        };

        private static Dictionary<string, object?> Identity() =>
            new Dictionary<string, object?> { ["id"] = "11111111-2222-3333-4444-555555555555" };

        [Fact]
        public void unread_holds_are_absent_not_empty()
        {
            var snapshot = Snapshot(new Dictionary<string, object?> { ["identity"] = Identity() });

            Assert.Null(VesselViewProvider.BuildInventory(snapshot));
        }

        [Fact]
        public void a_vessel_with_no_id_has_no_inventory()
        {
            var snapshot = Snapshot(new Dictionary<string, object?>
            {
                ["inventories"] = new Dictionary<string, object?> { ["stores"] = new List<object?>() },
            });

            Assert.Null(VesselViewProvider.BuildInventory(snapshot));
        }

        [Fact]
        public void holds_read_and_empty_are_an_empty_list()
        {
            var snapshot = Snapshot(new Dictionary<string, object?>
            {
                ["identity"] = Identity(),
                ["inventories"] = new Dictionary<string, object?> { ["stores"] = new List<object?>() },
            });

            var inventory = VesselViewProvider.BuildInventory(snapshot);

            Assert.NotNull(inventory);
            Assert.Empty(inventory!.Stores);
        }
    }
}
