using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="SystemViewProvider.BuildSwitchableVessels"/> maps the raw
    /// <c>"switchable"</c> group to <c>ksp.switchableVessels</c>: identity only,
    /// so a vessel the active one has no link to is on the list, and nothing
    /// that is live state of a vessel can be on an entry.
    /// </summary>
    [Collection("SystemViewProviderStatics")]
    public class SwitchableVesselsProviderTests
    {
        private static KspSnapshot SnapshotWith(params Dictionary<string, object?>[] vessels) =>
            new KspSnapshot
            {
                Ut = 100.0,
                Values = new Dictionary<string, object?>
                {
                    ["switchable"] = vessels.Cast<object?>().ToList(),
                },
            };

        [Fact]
        public void ReturnsNullOutsideTheFlightScene()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(SystemViewProvider.BuildSwitchableVessels(snapshot));
            Assert.Null(SystemViewProvider.BuildSwitchableVessels(null));
        }

        [Fact]
        public void ListsAVesselWithNoLinkAndCarriesOnlyItsIdentity()
        {
            // The capture reads no link, position or state, so an unlinked craft
            // arrives exactly as a linked one does.
            var snapshot = SnapshotWith(
                new Dictionary<string, object?>
                {
                    ["vesselId"] = "mun-probe-guid",
                    ["name"] = "Mun Probe",
                    ["vesselType"] = "Probe",
                    ["distance"] = 123456.0,
                    ["situation"] = "ORBITING",
                });

            var payload = SystemViewProvider.BuildSwitchableVessels(snapshot);

            var root = Assert.IsType<Dictionary<string, object?>>(payload);
            var entry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(Assert.IsAssignableFrom<IEnumerable<object?>>(root["entries"])));
            Assert.Equal("mun-probe-guid", entry["vesselId"]);
            Assert.Equal("Mun Probe", entry["name"]);
            Assert.Equal((int)VesselType.Probe, entry["vesselType"]);
            Assert.Equal(new[] { "name", "vesselId", "vesselType" }, entry.Keys.OrderBy(k => k).ToArray());
        }

        [Fact]
        public void DropsAnEntryWithNoId()
        {
            var snapshot = SnapshotWith(
                new Dictionary<string, object?> { ["name"] = "Ghost", ["vesselType"] = "Probe" });

            var root = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildSwitchableVessels(snapshot));

            Assert.Empty(Assert.IsAssignableFrom<IEnumerable<object?>>(root["entries"]));
        }
    }
}
