using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Host.CommandCentres;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Enumerates the stock CommNet home nodes as ground-station command centres:
    /// KSC, the stock Extra Ground Stations, and Kerbal Konstructs sites (KK
    /// subclasses stock <see cref="CommNetHome"/>, so a single
    /// <c>FindObjectsOfType&lt;CommNetHome&gt;()</c> pass covers all three with no KK
    /// API dependency). Static membership, but the node list is re-read each pass.
    /// The enumerator is injectable so the source is unit-testable without a live
    /// scene (run at the full-sln fold; this worktree has no KSP refs).
    /// </summary>
    public sealed class StockHomeNodeSource : ICommandCentreSource
    {
        private readonly Func<IEnumerable<CommNetHome>> _homes;

        public StockHomeNodeSource(Func<IEnumerable<CommNetHome>> homes) => _homes = homes;

        public StockHomeNodeSource()
            : this(() => UnityEngine.Object.FindObjectsOfType<CommNetHome>())
        {
        }

        public string SourceId => "stock-home";

        public IEnumerable<ICommandCentre> Enumerate()
        {
            foreach (var home in _homes())
            {
                if (home == null || home.comm == null)
                {
                    continue;
                }

                var id = home.isKSC ? "ksc" : "ground:" + (home.nodeName ?? "unknown");
                var name = home.displaynodeName ?? home.nodeName ?? id;

                yield return new KspCommandCentre(
                    id,
                    name,
                    CommandCentreKind.GroundStation,
                    BodyIndexOf(home.body),
                    home.comm,
                    home.comm.precisePosition,
                    active: true);
            }
        }

        private static int? BodyIndexOf(CelestialBody body)
        {
            if (body == null)
            {
                return null;
            }

            var index = FlightGlobals.Bodies.IndexOf(body);
            return index >= 0 ? index : (int?)null;
        }
    }
}
