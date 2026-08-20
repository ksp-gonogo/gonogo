using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Host.CommandCentres;
using Sitrep.Contract;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Enumerates the stock CommNet home nodes as ground-station command centres:
    /// KSC, the stock Extra Ground Stations, and Kerbal Konstructs sites (KK
    /// subclasses stock <see cref="CommNetHome"/>, so a single
    /// <c>FindObjectsOfType&lt;CommNetHome&gt;()</c> pass covers all three with no KK
    /// API dependency). Static membership, but the node list is re-read each pass.
    /// The enumerator is injectable so the source is unit-testable without a live
    /// scene. The node and body come through <see cref="CommNetHomeAccess"/> because
    /// stock keeps both protected.
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
                if (home == null)
                {
                    continue;
                }

                var comm = CommNetHomeAccess.Comm(home);
                if (comm == null)
                {
                    continue;
                }

                var id = home.isKSC ? "ksc" : "ground:" + (home.nodeName ?? "unknown");
                var name = home.displaynodeName ?? home.nodeName ?? id;

                // A ground station is surface-anchored by definition, so its
                // coordinates are always reported. They can only be absent when the
                // body itself is unreadable, and then BodyIndex is null too: the
                // entry says "I do not know what this sits on" rather than leaving a
                // bare coordinate hole beside a known body.
                var body = CommNetHomeAccess.Body(home);
                var anchored = SurfaceCoordinates.TryFrom(body, comm.precisePosition, out var latitude, out var longitude);

                yield return new KspCommandCentre(
                    id,
                    name,
                    CommandCentreKind.GroundStation,
                    BodyIndexOf(body),
                    comm,
                    comm.precisePosition,
                    active: true,
                    latitude: anchored ? latitude : (double?)null,
                    longitude: anchored ? longitude : (double?)null);
            }
        }

        private static int? BodyIndexOf(CelestialBody? body)
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
