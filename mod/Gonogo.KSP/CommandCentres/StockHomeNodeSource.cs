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
    ///
    /// <para>Ids come from <see cref="HomeCentreIds"/>. A comms mod that
    /// configures its own stations can set <c>isKSC</c> on every one of them, and
    /// then none of them is minted <c>"ksc"</c>: which station is home on such a
    /// save is not something this flag can say.</para>
    /// </summary>
    public sealed class StockHomeNodeSource : ICommandCentreSource
    {
        private readonly Func<IEnumerable<CommNetHome>> _homes;

        public StockHomeNodeSource(Func<IEnumerable<CommNetHome>> homes) => _homes = homes;

        public StockHomeNodeSource()
            : this(() => UnityEngine.Object.FindObjectsOfType<CommNetHome>())
        {
        }

        public string ProviderId => "stock-home";

        /// <summary>
        /// Every home with a readable node, under an id minted across ALL homes at
        /// once by <see cref="HomeCentreIds.Mint"/>. A home whose node is not up yet
        /// still counts towards the mint, because <c>isKSC</c> is a fact about the
        /// home rather than its node: counting only the homes with a node would let
        /// one flagged station briefly look like the sole KSC while its siblings
        /// were still being built.
        /// </summary>
        public IEnumerable<ICommandCentre> Enumerate()
        {
            var homes = new List<CommNetHome>();
            var nodes = new List<CommNode?>();
            var bodies = new List<CelestialBody?>();
            var facts = new List<HomeNodeFacts>();
            ReadHomes(homes, nodes, bodies, facts);

            var ids = HomeCentreIds.Mint(facts);
            for (var i = 0; i < homes.Count; i++)
            {
                var comm = nodes[i];
                if (comm == null)
                {
                    continue;
                }

                var home = homes[i];
                yield return new KspCommandCentre(
                    ids[i],
                    home.displaynodeName ?? home.nodeName ?? ids[i],
                    CommandCentreKind.GroundStation,
                    BodyIndexOf(bodies[i]),
                    comm,
                    comm.precisePosition,
                    active: true,
                    latitude: facts[i].Latitude,
                    longitude: facts[i].Longitude);
            }
        }

        /// <summary>
        /// The facts of every home, read the same way <see cref="Enumerate"/> reads
        /// them and in the same order, so a mint over this list gives each home the
        /// id its command centre carries. This is what the stock home-command
        /// claimant decides from. Main thread only.
        /// </summary>
        public IReadOnlyList<HomeNodeFacts> HomeFacts()
        {
            var facts = new List<HomeNodeFacts>();
            ReadHomes(new List<CommNetHome>(), new List<CommNode?>(), new List<CelestialBody?>(), facts);
            return facts;
        }

        private void ReadHomes(
            List<CommNetHome> homes,
            List<CommNode?> nodes,
            List<CelestialBody?> bodies,
            List<HomeNodeFacts> facts)
        {
            foreach (var home in _homes())
            {
                if (home == null)
                {
                    continue;
                }

                var comm = CommNetHomeAccess.Comm(home);
                var body = CommNetHomeAccess.Body(home);
                double? latitude = null;
                double? longitude = null;

                // A ground station is surface-anchored by definition, so its
                // coordinates are always reported. They can only be absent when the
                // body itself is unreadable, and then BodyIndex is null too: the
                // entry says "I do not know what this sits on" rather than leaving a
                // bare coordinate hole beside a known body.
                if (comm != null
                    && SurfaceCoordinates.TryFrom(body, comm.precisePosition, out var lat, out var lon))
                {
                    latitude = lat;
                    longitude = lon;
                }

                homes.Add(home);
                nodes.Add(comm);
                bodies.Add(body);
                facts.Add(new HomeNodeFacts(home.isKSC, home.nodeName, latitude, longitude));
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
