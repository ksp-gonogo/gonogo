using System.Collections;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Compares two ground station lists by what they say, so an unchanged list
    /// can keep the instance already published and the emitter's change-gate,
    /// which compares by reference, sends nothing.
    /// </summary>
    public static class GroundStationLists
    {
        /// <summary>Whether both lists name the same stations, in the same order, with the same places and extension facts.</summary>
        public static bool Same(CommsGroundStations a, CommsGroundStations b)
        {
            if (a.Stations.Count != b.Stations.Count)
            {
                return false;
            }

            for (var i = 0; i < a.Stations.Count; i++)
            {
                var x = a.Stations[i];
                var y = b.Stations[i];
                if (x.Id != y.Id || x.Name != y.Name || x.BodyName != y.BodyName
                    || x.Latitude != y.Latitude || x.Longitude != y.Longitude
                    || !SameValue(x.Extensions, y.Extensions))
                {
                    return false;
                }
            }

            return true;
        }

        private static bool SameValue(object? a, object? b)
        {
            if (a is IDictionary<string, object?> da && b is IDictionary<string, object?> db)
            {
                if (da.Count != db.Count)
                {
                    return false;
                }
                foreach (var pair in da)
                {
                    if (!db.TryGetValue(pair.Key, out var other) || !SameValue(pair.Value, other))
                    {
                        return false;
                    }
                }
                return true;
            }

            if (a is IEnumerable ea && b is IEnumerable eb && a is not string)
            {
                var ia = ea.GetEnumerator();
                var ib = eb.GetEnumerator();
                while (true)
                {
                    var moreA = ia.MoveNext();
                    var moreB = ib.MoveNext();
                    if (moreA != moreB)
                    {
                        return false;
                    }
                    if (!moreA)
                    {
                        return true;
                    }
                    if (!SameValue(ia.Current, ib.Current))
                    {
                        return false;
                    }
                }
            }

            return Equals(a, b);
        }
    }
}
