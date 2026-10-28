using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Populates the per-(authority, subject) delay matrix: for every active
    /// command centre x every fleet subject, the explicit (vantage = centre.Id,
    /// node = fleet.&lt;guid&gt;) delay pair. This is the EXPLICIT-PAIR tier of
    /// <c>StubNetwork.DelayTo</c>'s 3-tier lookup, so it overrides the
    /// <c>SetNodeDelay</c> node-default for the selected vantage while leaving
    /// the KSC-uniform node-default underneath for any unselected vantage.
    ///
    /// <para>Four subject namespaces, same tier. <see cref="Populate"/> writes the
    /// centre-to-VESSEL rows a command to a named craft is timed by,
    /// <see cref="PopulateActiveVessel"/> the rows against the active craft every
    /// ordinary channel and command rides, and <see cref="PopulateHomeCommand"/>
    /// the rows against the career ledger. <see cref="PopulateCentrePairs"/> writes
    /// the centre-to-CENTRE rows, which no command is addressed to: they time the
    /// addressed streams one centre sends another.</para>
    ///
    /// <para>A pair with no route writes no row, so a row being on file is not
    /// evidence of a route. <see cref="Unroutable"/> names those pairs, and a
    /// command from a centre to a subject it cannot reach is refused rather than
    /// quoted a delay.</para>
    ///
    /// <para>KSP-free by construction: the routing (a centre's CommNet
    /// <c>ControlPath</c> to a subject) is injected as <c>routeDelay</c> by the
    /// KSP layer, which owns the KSP types. The two policy rules this class
    /// enforces are both KSP-free:</para>
    /// <list type="bullet">
    /// <item>No min-over-authorities: each authority writes its own row; the
    /// dispatched delay is the selected vantage's row, never a min collapse</item>
    /// <item>Self-at-zero: a <see cref="CommandCentreKind.CrewedVessel"/> centre is
    /// authoritative about its own subject row, written as an explicit zero exactly as
    /// <see cref="PopulateCentrePairs"/> writes a centre's row against itself. A vantage
    /// is where the operator is standing, and signal delay is the distance to somewhere
    /// else, so zero is the honest number for a craft observing itself. The row is
    /// reachable only from that craft's own vantage, because the no-min rule above is
    /// what keeps it there</item>
    /// </list>
    /// </summary>
    public sealed class AuthorityMatrixPass
    {
        /// <summary>The per-subject node id for a vessel guid, matching the fleet namespace.</summary>
        public static string FleetNode(string guid) => ChannelEngine.FleetNodePrefix + guid;

        /// <summary>The per-subject node id for a command centre addressed as a destination.</summary>
        public static string CentreNode(string centreId) => ChannelEngine.CentreNodePrefix + centreId;

        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="subjectGuids">The fleet subject vessel guids (same set the fleet pass walks).</param>
        /// <param name="routeDelay">
        /// KSP-layer routing: one-way seconds from a centre to a subject guid, or null when
        /// unreachable (the pair then gets no row, and <see cref="Unroutable"/> names it).
        /// Provided by the caller so this class needs no KSP reference.
        /// </param>
        /// <param name="setDelay">
        /// Writes an explicit (vantage, node, seconds) pair (in production, <c>StubNetwork.SetDelay</c>).
        /// </param>
        public void Populate(
            IReadOnlyList<ICommandCentre> activeCentres,
            IReadOnlyList<string> subjectGuids,
            Func<ICommandCentre, string, double?> routeDelay,
            Action<string, string, double> setDelay)
        {
            foreach (var centre in activeCentres)
            {
                foreach (var guid in subjectGuids)
                {
                    if (centre.Kind == CommandCentreKind.CrewedVessel && centre.Id == "vessel:" + guid)
                    {
                        /*
                         * A craft is no distance from itself, and this pass has to say
                         * so itself: the routing callback reports null for a self-path
                         * (a node-to-node solve where both ends are the same node is
                         * not a route), so leaving it to routeDelay would write no row
                         * and drop the pair through to the node-default, which is the
                         * ground's light-time to that craft.
                         */
                        setDelay(centre.Id, FleetNode(guid), 0.0);
                        continue;
                    }

                    var seconds = routeDelay(centre, guid);
                    if (seconds == null)
                    {
                        continue;
                    }

                    setDelay(centre.Id, FleetNode(guid), seconds.Value);
                }
            }
        }

        /// <summary>
        /// Populates each active centre's delay to the active craft, the row every ordinary
        /// channel is delivered on (<see cref="ChannelEngine.NodeId"/>): those channels have
        /// no per-vessel node because they always describe whichever craft is active.
        ///
        /// <para>The crewed centre that is the active craft is written as zero, by the same
        /// self-at-zero rule <see cref="Populate"/> applies to its fleet row. Any other centre
        /// is written at its route to the active craft, and a centre with no route gets no
        /// row.</para>
        ///
        /// <para>The home centre gets no row either, because it already has the right one.
        /// With no row a vantage reads the whole-network default, which is the active craft's
        /// own solved path home: the same path <see cref="Populate"/>'s routing reads for the
        /// home centre's fleet row. That default also carries the hold the engine puts on it
        /// while the craft is out of contact, which a row written from the path would not,
        /// since a craft with no link measures an empty path at zero.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="activeGuid">The active craft's guid, or null when nothing is active (no row is written).</param>
        /// <param name="homeCentreId">The home centre as the routing callback identifies it, or null.</param>
        /// <param name="routeDelay">
        /// KSP-layer routing, the same callback <see cref="Populate"/> takes: one-way seconds
        /// from a centre to a subject guid, or null when unreachable.
        /// </param>
        /// <param name="setDelay">Writes the (centre, active craft) row.</param>
        public void PopulateActiveVessel(
            IReadOnlyList<ICommandCentre> activeCentres,
            string? activeGuid,
            string? homeCentreId,
            Func<ICommandCentre, string, double?> routeDelay,
            Action<string, double> setDelay)
        {
            if (activeGuid == null)
            {
                return;
            }

            foreach (var centre in activeCentres)
            {
                if (centre.Kind == CommandCentreKind.CrewedVessel && centre.Id == "vessel:" + activeGuid)
                {
                    setDelay(centre.Id, 0.0);
                    continue;
                }

                if (centre.Id == homeCentreId)
                {
                    continue;
                }

                var seconds = routeDelay(centre, activeGuid);
                if (seconds == null)
                {
                    continue;
                }

                setDelay(centre.Id, seconds.Value);
            }
        }

        /// <summary>
        /// Populates each active centre's delay to the home command's ledger, the row
        /// every <see cref="ChannelDeclaration.HeldAtHome"/> channel is delivered on.
        ///
        /// <para>The ledger is reached over the ground network, so the home centre and
        /// every ground station are written as zero, and any other centre as its own
        /// path home, whichever station that path ends at. A route to the one station
        /// the claimant named is deliberately not what is asked: a vessel talking to a
        /// different station reaches the ledger there, and would otherwise be told the
        /// ledger is unreachable or quoted a delay to a station it is not using.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="homeCentreId">
        /// The centre the roster marks home, the claimant's answer or the ground station
        /// standing in for it, or null when there is none.
        /// </param>
        /// <param name="secondsToHome">
        /// KSP-layer measurement of a non-ground centre's path home, or null when the
        /// centre has no measurable path at all, in which case no row is written.
        /// </param>
        /// <param name="setDelay">Writes the (centre, home ledger) row.</param>
        public void PopulateHomeCommand(
            IReadOnlyList<ICommandCentre> activeCentres,
            string? homeCentreId,
            Func<ICommandCentre, double?> secondsToHome,
            Action<string, double> setDelay)
        {
            foreach (var centre in activeCentres)
            {
                if (centre.Id == homeCentreId || centre.Kind == CommandCentreKind.GroundStation)
                {
                    setDelay(centre.Id, 0.0);
                    continue;
                }

                var seconds = secondsToHome(centre);
                if (seconds == null)
                {
                    continue;
                }

                setDelay(centre.Id, seconds.Value);
            }
        }

        /// <summary>
        /// The active centres that cannot reach the home command's ledger at all,
        /// so a command addressed to it from one of them is dropped like any other
        /// command sent into a link that is down.
        ///
        /// <para>The home centre and every ground station stand on the ground
        /// network and always reach it. Any other centre reaches it only over a
        /// route that ends at a ground station, and it does not matter which one:
        /// every station carries the ledger. A centre whose reach cannot be read is
        /// not listed, the same way an unreadable connectivity source leaves a
        /// link up.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="homeCentreId">The centre the roster marks home, or null.</param>
        /// <param name="reachesGround">
        /// KSP-layer read of whether a non-ground centre's route ends at a ground
        /// station, or null when it cannot be read.
        /// </param>
        public IReadOnlyList<string> OffTheGroundNetwork(
            IReadOnlyList<ICommandCentre> activeCentres,
            string? homeCentreId,
            Func<ICommandCentre, bool?> reachesGround)
        {
            var off = new List<string>();
            foreach (var centre in activeCentres)
            {
                if (centre.Id == homeCentreId || centre.Kind == CommandCentreKind.GroundStation)
                {
                    continue;
                }

                if (reachesGround(centre) == false)
                {
                    off.Add(centre.Id);
                }
            }
            return off;
        }

        /// <summary>
        /// Every subject node whose route from an active centre does not carry both
        /// ways, with the directions it does carry, the complete set for this pass:
        /// a command from a centre that cannot send to a node is refused at dispatch
        /// rather than quoted a delay, and a centre that cannot hear one is sent
        /// nothing from it.
        ///
        /// <para>Every centre but home is listed against a craft it has no route
        /// of its own to, carrying neither way. The home centre's reach to a craft is
        /// that craft's own link home, which the engine already holds, so it is listed
        /// only for a direction that link does not carry. A ground station that is not
        /// home hears a craft only over its own route: left unlisted it read the node
        /// default, which is the home centre's signal delay, and was sent a craft it
        /// could not hear on home's clock. The home centre with no route to a craft
        /// that another centre does reach is listed against it too, carrying neither
        /// way, since it would otherwise read the whole-network default. A crewed
        /// centre always reaches its own craft. The home command's ledger is listed, carrying neither way, for a
        /// centre <see cref="OffTheGroundNetwork"/> names, and every ground station
        /// stands on that network.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="homeCentreId">The centre the roster marks home, or null.</param>
        /// <param name="subjectGuids">The fleet subject vessel guids <see cref="Populate"/> walks.</param>
        /// <param name="activeGuid">The active craft's guid, or null when nothing is active.</param>
        /// <param name="routeDelay">The same routing callback <see cref="Populate"/> takes.</param>
        /// <param name="routeCarries">The directions the route to a subject carries, from a centre toward it, or both where the route has nothing to say.</param>
        /// <param name="reachesGround">The same reach callback <see cref="OffTheGroundNetwork"/> takes.</param>
        public IReadOnlyDictionary<string, IReadOnlyDictionary<string, CommsDirection>> Carried(
            IReadOnlyList<ICommandCentre> activeCentres,
            string? homeCentreId,
            IReadOnlyList<string> subjectGuids,
            string? activeGuid,
            Func<ICommandCentre, string, double?> routeDelay,
            Func<ICommandCentre, string, CommsDirection> routeCarries,
            Func<ICommandCentre, bool?> reachesGround)
        {
            var carried = new Dictionary<string, Dictionary<string, CommsDirection>>();
            void Add(string centreId, string node, CommsDirection direction)
            {
                if (!carried.TryGetValue(centreId, out var nodes))
                {
                    nodes = new Dictionary<string, CommsDirection>();
                    carried[centreId] = nodes;
                }
                nodes[node] = direction;
            }

            CommsDirection Judge(ICommandCentre centre, string guid)
            {
                if (centre.Id == homeCentreId)
                {
                    return routeCarries(centre, guid);
                }
                return routeDelay(centre, guid) == null ? CommsDirection.None : routeCarries(centre, guid);
            }

            foreach (var centre in activeCentres)
            {
                foreach (var guid in subjectGuids)
                {
                    if (IsOwnCraft(centre, guid))
                    {
                        continue;
                    }
                    var direction = Judge(centre, guid);
                    if (centre.Id == homeCentreId && routeDelay(centre, guid) == null && AnotherCentreRoutes(activeCentres, centre, guid, routeDelay))
                    {
                        direction = CommsDirection.None;
                    }
                    if (direction != CommsDirection.Both)
                    {
                        Add(centre.Id, FleetNode(guid), direction);
                    }
                }

                if (activeGuid != null && !IsOwnCraft(centre, activeGuid))
                {
                    var direction = Judge(centre, activeGuid);
                    if (direction != CommsDirection.Both)
                    {
                        Add(centre.Id, ChannelEngine.NodeId, direction);
                    }
                }
            }

            foreach (var centreId in OffTheGroundNetwork(activeCentres, homeCentreId, reachesGround))
            {
                Add(centreId, ChannelEngine.HomeCommandNode, CommsDirection.None);
            }

            var result = new Dictionary<string, IReadOnlyDictionary<string, CommsDirection>>();
            foreach (var row in carried)
            {
                result[row.Key] = row.Value;
            }
            return result;
        }

        /*
         * A home centre with no route to a craft that another centre does reach has no
         * row of its own and no node default to read, so it would be timed by the
         * whole-network default, the active craft's delay. When no centre reaches the
         * craft the reveal gate already holds its readings, so it is left alone.
         */
        private static bool AnotherCentreRoutes(
            IReadOnlyList<ICommandCentre> activeCentres,
            ICommandCentre except,
            string guid,
            Func<ICommandCentre, string, double?> routeDelay)
        {
            foreach (var other in activeCentres)
            {
                if (other.Id != except.Id && !IsOwnCraft(other, guid) && routeDelay(other, guid) != null)
                {
                    return true;
                }
            }
            return false;
        }

        private static bool IsOwnCraft(ICommandCentre centre, string guid) =>
            centre.Kind == CommandCentreKind.CrewedVessel && centre.Id == "vessel:" + guid;

        /// <summary>
        /// Populates the CENTRE-to-CENTRE half of the same matrix: for every
        /// ordered pair of active centres, the delay from the first (as a
        /// vantage) to the second (as a destination <see cref="CentreNode"/>).
        /// These time the addressed streams one centre sends another; no command
        /// is addressed to a centre.
        ///
        /// <para>A centre's row against itself is written as an explicit zero,
        /// and it is the one zero in this file that is not a guess: a node is
        /// exactly no distance from itself. Without it the pair would fall
        /// through to the whole-network default delay, so a centre hearing its
        /// own stream would inherit whatever signal delay the active craft happens
        /// to be at, which is the wrong number and silently so. The routing callback still reports
        /// <c>null</c> for a self-path, because "route from a node to itself" is
        /// not a route; the zero is this pass's own statement, not a measurement.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="routeDelay">
        /// KSP-layer routing: one-way seconds between two centres, or null when they are
        /// not routable to each other (the pair is then left unset, so nothing quotes a
        /// delay for a command that could not be delivered).
        /// </param>
        /// <param name="setDelay">Writes an explicit (vantage, node, seconds) pair.</param>
        public void PopulateCentrePairs(
            IReadOnlyList<ICommandCentre> activeCentres,
            Func<ICommandCentre, ICommandCentre, double?> routeDelay,
            Action<string, string, double> setDelay)
        {
            foreach (var from in activeCentres)
            {
                foreach (var to in activeCentres)
                {
                    if (from.Id == to.Id)
                    {
                        setDelay(from.Id, CentreNode(to.Id), 0.0);
                        continue;
                    }

                    var seconds = routeDelay(from, to);
                    if (seconds == null)
                    {
                        continue;
                    }

                    setDelay(from.Id, CentreNode(to.Id), seconds.Value);
                }
            }
        }
    }
}
