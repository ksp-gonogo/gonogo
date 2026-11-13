using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="SystemViewProvider.BuildActiveVessel"/> maps the raw
    /// <c>"activeVessel"</c> group to <c>ksp.activeVessel</c>: identity only, so
    /// nothing that is live state of the vessel can cross without a link.
    /// </summary>
    [Collection("SystemViewProviderStatics")]
    public class ActiveVesselProviderTests
    {
        private static KspSnapshot SnapshotWith(Dictionary<string, object?> group) =>
            new KspSnapshot
            {
                Ut = 100.0,
                Values = new Dictionary<string, object?> { ["activeVessel"] = group },
            };

        [Fact]
        public void ReturnsNullOutsideTheFlightScene()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(SystemViewProvider.BuildActiveVessel(snapshot));
            Assert.Null(SystemViewProvider.BuildActiveVessel(null));
        }

        [Fact]
        public void CarriesOnlyTheIdentityOfTheVessel()
        {
            var snapshot = SnapshotWith(new Dictionary<string, object?>
            {
                ["vesselId"] = "mun-probe-guid",
                ["name"] = "Mun Probe",
                ["vesselType"] = "Probe",
                ["altitude"] = 123456.0,
                ["situation"] = "ORBITING",
            });

            var payload = Assert.IsType<Dictionary<string, object?>>(SystemViewProvider.BuildActiveVessel(snapshot));

            Assert.Equal("mun-probe-guid", payload["vesselId"]);
            Assert.Equal("Mun Probe", payload["name"]);
            Assert.Equal(new[] { "name", "vesselId" }, payload.Keys.OrderBy(k => k).ToArray());
        }

        [Fact]
        public void ReturnsNullWhenTheGroupHasNoId()
        {
            var snapshot = SnapshotWith(new Dictionary<string, object?> { ["name"] = "Ghost" });

            Assert.Null(SystemViewProvider.BuildActiveVessel(snapshot));
        }
    }
}
