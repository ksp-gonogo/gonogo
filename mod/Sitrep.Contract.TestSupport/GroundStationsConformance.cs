using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ICommsGroundStations"/> promises, for an implementer to run
    /// against their own backend.
    /// </summary>
    public static class GroundStationsConformance
    {
        /// <summary>
        /// Asserts the contract for one backend: the list is never null, every
        /// station has a non-blank id and name, ids are unique, a latitude is
        /// within 90 degrees of the equator and a longitude within 180 degrees of
        /// the prime meridian, a place is given whole or not at all, and two reads
        /// in a row name the same stations in the same order.
        /// </summary>
        /// <param name="backend">The backend under test.</param>
        public static void AssertGroundStationsContract(ICommsGroundStations backend)
        {
            Assert.NotNull(backend);
            var name = backend.GetType().Name;

            var first = backend.GroundStations();
            Assert.True(first != null, name + ".GroundStations() must return a list, never null.");

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var station in first!)
            {
                Assert.True(
                    !string.IsNullOrWhiteSpace(station.Id) && !string.IsNullOrWhiteSpace(station.Name),
                    name + ": a station has a non-blank id and name.");
                Assert.True(seen.Add(station.Id), name + ": the station id '" + station.Id + "' appears twice.");

                if (station.Latitude.HasValue)
                {
                    Assert.True(
                        Math.Abs(station.Latitude.Value) <= 90.0,
                        name + ": '" + station.Id + "' has latitude " + station.Latitude + ", outside 90 degrees.");
                }
                if (station.Longitude.HasValue)
                {
                    Assert.True(
                        Math.Abs(station.Longitude.Value) <= 180.0,
                        name + ": '" + station.Id + "' has longitude " + station.Longitude + ", outside 180 degrees.");
                }
                Assert.True(
                    station.Latitude.HasValue == station.Longitude.HasValue
                    && (station.BodyName != null) == station.Latitude.HasValue,
                    name + ": '" + station.Id + "' gives its body, latitude and longitude together or none of them.");
            }

            var second = backend.GroundStations();
            Assert.Equal(first.Count, second.Count);
            for (var i = 0; i < first.Count; i++)
            {
                Assert.Equal(first[i].Id, second[i].Id);
            }
        }
    }
}
