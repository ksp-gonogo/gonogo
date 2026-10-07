using System;
using System.Collections.Generic;
using System.Linq;
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
    /// <para>Ids come from <see cref="HomeCentreIds"/>, and every home is
    /// <c>ground:&lt;name&gt;</c>. Which one is home is not this source's
    /// question: <see cref="HomeFacts"/> hands the game's flags to the stock
    /// home-command claimant, the one reader of them.</para>
    /// </summary>
    public sealed class StockHomeNodeSource : ICommandCentreSource
    {
        private readonly Func<IEnumerable<HomeReading>> _homes;

        internal StockHomeNodeSource(Func<IEnumerable<HomeReading>> homes) => _homes = homes;

        public StockHomeNodeSource()
            : this(ReadSceneHomes)
        {
        }

        public string ProviderId => "stock-home";

        /// <summary>
        /// Every home that is a place to command from, under an id minted across
        /// ALL homes at once by <see cref="HomeCentreIds.Mint"/>, so the suffix a
        /// shared name earns does not shift while a sibling station is still being
        /// built.
        ///
        /// <para>A home is a centre once its CommNet node exists, and the space
        /// centre is one whether or not it has a node. Stock builds a home's node
        /// only while CommNet is enabled for the save, so a save with CommNet off
        /// has no node anywhere, and the space centre is still where that save is
        /// commanded from. A space centre with no node is routed to nothing, which
        /// the roster reports as unroutable.</para>
        /// </summary>
        public IEnumerable<ICommandCentre> Enumerate()
        {
            var homes = _homes().ToList();
            var ids = HomeCentreIds.Mint(homes.Select(FactsOf).ToList());
            for (var i = 0; i < homes.Count; i++)
            {
                var home = homes[i];
                if (home.Comm == null && !home.IsKsc)
                {
                    continue;
                }

                var facts = FactsOf(home);
                yield return new KspCommandCentre(
                    ids[i],
                    DisplayNameOf(home, ids[i]),
                    CommandCentreKind.GroundStation,
                    BodyIndexOf(home.Body),
                    home.Comm,
                    home.Position,
                    active: true,
                    latitude: facts.Latitude,
                    longitude: facts.Longitude);
            }
        }

        /// <summary>
        /// A station's name as the player reads it in game. Stock stores the
        /// space centre's as a localisation tag (<c>#autoLOC_6002159</c>) and
        /// resolves it wherever it draws it, so the stored text is put through
        /// the game's own table here. A tag the table does not hold, and a home
        /// with no display name at all, fall back to the node's own name.
        /// </summary>
        private static string DisplayNameOf(HomeReading home, string id)
        {
            var plain = string.IsNullOrEmpty(home.NodeName) ? id : home.NodeName!;
            return string.IsNullOrEmpty(home.DisplayName) ? plain : GameWords.Name(home.DisplayName!, plain);
        }

        /// <summary>
        /// The facts of every home, read the same way <see cref="Enumerate"/> reads
        /// them and in the same order, so a mint over this list gives each home the
        /// id its command centre carries. This is what the stock home-command
        /// claimant decides from. Main thread only.
        /// </summary>
        public IReadOnlyList<HomeNodeFacts> HomeFacts() => _homes().Select(FactsOf).ToList();

        /// <summary>
        /// A ground station is surface-anchored by definition, so its coordinates
        /// are always reported. They can only be absent when the body itself is
        /// unreadable, and then BodyIndex is null too: the entry says "I do not
        /// know what this sits on" rather than leaving a bare coordinate hole
        /// beside a known body.
        /// </summary>
        private static HomeNodeFacts FactsOf(HomeReading home)
        {
            double? latitude = null;
            double? longitude = null;
            if (SurfaceCoordinates.TryFrom(home.Body, home.Position, out var lat, out var lon))
            {
                latitude = lat;
                longitude = lon;
            }

            return new HomeNodeFacts(home.IsKsc, home.NodeName, latitude, longitude);
        }

        private static IEnumerable<HomeReading> ReadSceneHomes()
        {
            foreach (var home in UnityEngine.Object.FindObjectsOfType<CommNetHome>())
            {
                if (home == null)
                {
                    continue;
                }

                var comm = CommNetHomeAccess.Comm(home);
                var anchor = home.nodeTransform != null ? home.nodeTransform : home.transform;
                yield return new HomeReading(
                    home.isKSC,
                    home.nodeName,
                    home.displaynodeName,
                    comm,
                    CommNetHomeAccess.Body(home),
                    comm != null ? comm.precisePosition : (Vector3d)anchor.position);
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

    /// <summary>
    /// One <see cref="CommNetHome"/> as the source reads it: its flags and names,
    /// its CommNet node (null while CommNet has not built one), the body it sits
    /// on, and its world position, the node's own while it has one.
    /// </summary>
    internal readonly struct HomeReading
    {
        public HomeReading(bool isKsc, string? nodeName, string? displayName, CommNode? comm, CelestialBody? body, Vector3d position)
        {
            IsKsc = isKsc;
            NodeName = nodeName;
            DisplayName = displayName;
            Comm = comm;
            Body = body;
            Position = position;
        }

        public bool IsKsc { get; }
        public string? NodeName { get; }
        public string? DisplayName { get; }
        public CommNode? Comm { get; }
        public CelestialBody? Body { get; }
        public Vector3d Position { get; }
    }
}
