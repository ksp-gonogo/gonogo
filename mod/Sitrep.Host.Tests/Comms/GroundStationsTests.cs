using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// <c>comms.groundStations</c> through the real wire codec, and the equality
    /// that lets an unchanged list keep the instance already published. The
    /// coordinates are the space centre's own: 28.5083 N, 80.6477 W on Kerbin,
    /// wrapped the way stock reports them.
    /// </summary>
    public class GroundStationsTests
    {
        private static CommsGroundStation Ksc() => new CommsGroundStation
        {
            Id = "Kerbal Space Center",
            Name = "Kerbal Space Center",
            BodyName = "Kerbin",
            Latitude = -0.0972,
            Longitude = -74.5577,
        };

        [Fact]
        public void AStationCarriesItsPlaceOnItsBodyThroughTheWire()
        {
            var el = WirePayload.Of(new CommsGroundStations { Stations = new[] { Ksc() } }, "comms.groundStations");

            var station = el.GetProperty("stations")[0];
            Assert.Equal("Kerbal Space Center", station.GetProperty("id").GetString());
            Assert.Equal("Kerbin", station.GetProperty("bodyName").GetString());
            Assert.Equal(-0.0972, station.GetProperty("latitude").GetDouble(), 6);
            Assert.Equal(-74.5577, station.GetProperty("longitude").GetDouble(), 6);
            Assert.False(station.TryGetProperty("extensions", out _));
        }

        [Fact]
        public void AStationWhoseBodyCannotBeReadSendsNullPlaceNotZero()
        {
            var el = WirePayload.Of(
                new CommsGroundStations { Stations = new[] { new CommsGroundStation { Id = "x", Name = "x" } } },
                "comms.groundStations");

            var station = el.GetProperty("stations")[0];
            Assert.Equal(JsonValueKind.Null, station.GetProperty("bodyName").ValueKind);
            Assert.Equal(JsonValueKind.Null, station.GetProperty("latitude").ValueKind);
            Assert.Equal(JsonValueKind.Null, station.GetProperty("longitude").ValueKind);
        }

        [Fact]
        public void AProvidersBagRidesUnderItsOwnName()
        {
            var station = Ksc();
            station.Extensions = new Dictionary<string, object?>
            {
                ["someprovider"] = new Dictionary<string, object?> { ["techLevel"] = 3, ["antennaCount"] = 2 },
            };

            var el = WirePayload.Of(new CommsGroundStations { Stations = new[] { station } }, "comms.groundStations");

            var bag = el.GetProperty("stations")[0].GetProperty("extensions").GetProperty("someprovider");
            Assert.Equal(3, bag.GetProperty("techLevel").GetInt32());
            Assert.Equal(2, bag.GetProperty("antennaCount").GetInt32());
        }

        [Fact]
        public void TheSameStationsInTheSameOrderAreTheSameList()
        {
            Assert.True(GroundStationLists.Same(
                new CommsGroundStations { Stations = new[] { Ksc() } },
                new CommsGroundStations { Stations = new[] { Ksc() } }));
        }

        [Fact]
        public void AMovedOrRetunedStationIsADifferentList()
        {
            var moved = Ksc();
            moved.Longitude = -74.0;
            var tuned = Ksc();
            tuned.Extensions = new Dictionary<string, object?> { ["someprovider"] = new Dictionary<string, object?> { ["techLevel"] = 4 } };
            var tunedBefore = Ksc();
            tunedBefore.Extensions = new Dictionary<string, object?> { ["someprovider"] = new Dictionary<string, object?> { ["techLevel"] = 3 } };

            var original = new CommsGroundStations { Stations = new[] { Ksc() } };
            Assert.False(GroundStationLists.Same(original, new CommsGroundStations { Stations = new[] { moved } }));
            Assert.False(GroundStationLists.Same(original, new CommsGroundStations()));
            Assert.False(GroundStationLists.Same(
                new CommsGroundStations { Stations = new[] { tunedBefore } },
                new CommsGroundStations { Stations = new[] { tuned } }));
        }

        [Fact]
        public void AnEdgeCarriesItsStrengthAndQuantityOnTheWireAndNullWhenNoneIsStated()
        {
            var el = WirePayload.Of(
                new CommsNetwork
                {
                    Edges = new[]
                    {
                        new CommsNetworkEdge { A = "a", B = "b", Active = true, Strength = 0.5, Quantity = SignalQuantity.RangeFraction },
                        new CommsNetworkEdge { A = "b", B = "c", Active = true },
                    },
                },
                "comms.network");

            var stated = el.GetProperty("edges")[0];
            Assert.Equal(0.5, stated.GetProperty("strength").GetDouble(), 9);
            Assert.Equal((int)SignalQuantity.RangeFraction, stated.GetProperty("quantity").GetInt32());
            var unstated = el.GetProperty("edges")[1];
            Assert.Equal(JsonValueKind.Null, unstated.GetProperty("strength").ValueKind);
            Assert.Equal(JsonValueKind.Null, unstated.GetProperty("quantity").ValueKind);
        }

        private sealed class ListedStations : ICommsGroundStations
        {
            public IReadOnlyList<CommsGroundStation> Stations = new List<CommsGroundStation>();
            public IReadOnlyList<CommsGroundStation> GroundStations() => Stations;
        }

        [Fact]
        public void AStationListThatKeepsTheContractPassesTheConformanceAssertion()
        {
            GroundStationsConformance.AssertGroundStationsContract(new ListedStations { Stations = new[] { Ksc() } });
            GroundStationsConformance.AssertGroundStationsContract(new ListedStations());
        }

        [Fact]
        public void ADuplicateIdOrAnOutOfRangeLatitudeOrAHalfPlaceFailsTheConformanceAssertion()
        {
            var twice = new ListedStations { Stations = new[] { Ksc(), Ksc() } };
            var tooFar = Ksc();
            tooFar.Latitude = 91;
            var half = Ksc();
            half.Longitude = null;

            Assert.ThrowsAny<Xunit.Sdk.XunitException>(() => GroundStationsConformance.AssertGroundStationsContract(twice));
            Assert.ThrowsAny<Xunit.Sdk.XunitException>(() =>
                GroundStationsConformance.AssertGroundStationsContract(new ListedStations { Stations = new[] { tooFar } }));
            Assert.ThrowsAny<Xunit.Sdk.XunitException>(() =>
                GroundStationsConformance.AssertGroundStationsContract(new ListedStations { Stations = new[] { half } }));
        }
    }
}
