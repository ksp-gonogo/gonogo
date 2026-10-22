using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The <c>surface.sites</c> channel: every flag planted in the save, from the capture's
    /// <c>surfaceSites</c> list.
    ///
    /// <para>An empty list is a real answer and is published as one: no flag is planted. Null
    /// is returned only when the capture produced no list at all.</para>
    /// </summary>
    public static class SurfaceSitesViewProvider
    {
        public const string Topic = "surface.sites";

        public static object? BuildWire(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null
                || !snapshot.Values.TryGetValue("surfaceSites", out var rawList)
                || rawList is not IEnumerable<object?> entries)
            {
                return null;
            }

            var sites = new List<object?>();
            foreach (var entry in entries)
            {
                if (entry is IDictionary<string, object?> raw && !string.IsNullOrEmpty(SnapshotDict.GetString(raw, "siteId")))
                {
                    sites.Add(ToWire(Build(raw)));
                }
            }

            return sites;
        }

        private static PlantedFlag Build(IDictionary<string, object?> raw) => new PlantedFlag
        {
            SiteId = SnapshotDict.GetString(raw, "siteId"),
            Name = SnapshotDict.GetString(raw, "name"),
            Body = SnapshotDict.GetString(raw, "body"),
            Latitude = SnapshotDict.GetDouble(raw, "latitude"),
            Longitude = SnapshotDict.GetDouble(raw, "longitude"),
            PlantedAt = SnapshotDict.GetDouble(raw, "plantedAt"),
            PlantedBy = SnapshotDict.GetString(raw, "plantedBy"),
            Plaque = SnapshotDict.GetString(raw, "plaque"),
        };

        private static Dictionary<string, object?> ToWire(PlantedFlag site) => new Dictionary<string, object?>
        {
            ["siteId"] = site.SiteId,
            ["name"] = site.Name,
            ["body"] = site.Body,
            ["latitude"] = site.Latitude,
            ["longitude"] = site.Longitude,
            ["plantedAt"] = site.PlantedAt,
            ["plantedBy"] = site.PlantedBy,
            ["plaque"] = site.Plaque,
        };
    }
}
