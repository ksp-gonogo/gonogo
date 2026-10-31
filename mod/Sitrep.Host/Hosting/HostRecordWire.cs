using System.Collections.Generic;

namespace Sitrep.Host.Hosting
{
    /// <summary>
    /// <c>host.record</c> as the wire carries it: one flattener per contract
    /// type, named for the type it stands for, so the producer parity scan holds
    /// each to every field. Neither the holder's token nor a station's
    /// credential is written, only the ids <see cref="HostRecord.PublicId"/> makes.
    /// </summary>
    internal static class HostRecordWire
    {
        internal static Dictionary<string, object?> BuildHostRecordModel(HostRecord record)
        {
            var stations = new List<object?>();
            foreach (var station in record.Stations)
            {
                stations.Add(BuildApprovedStationState(
                    HostRecord.PublicId(station.Credential), station.Name, station.ApprovedAtUnixMs));
            }

            return new Dictionary<string, object?>
            {
                ["held"] = record.Held,
                ["holderAway"] = record.HolderAway,
                ["holderId"] = record.HolderId ?? string.Empty,
                ["code"] = record.Code,
                ["stations"] = stations,
            };
        }

        internal static Dictionary<string, object?> BuildApprovedStationState(string id, string name, long approvedAt) =>
            new Dictionary<string, object?>
            {
                ["id"] = id,
                ["name"] = name,
                ["approvedAt"] = approvedAt,
            };
    }
}
