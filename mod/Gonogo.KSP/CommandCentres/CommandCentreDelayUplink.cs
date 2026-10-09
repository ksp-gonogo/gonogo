using System;
using System.Collections.Generic;
using System.Linq;
using CommNet;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP.CommandCentres
{
    // The FindClosestControlSource multi-source tie-break is still a Deck
    // live-confirm item, to be validated in-scene before multi-authority
    // selection is trusted.

    /// <summary>
    /// Populates the per-(authority, subject) command-delay matrix each tick and
    /// publishes <c>commandCentre.roster</c> (Plan 3). Owns the command-centre
    /// sources + registry; the same registry instance is registered on the
    /// ChannelEngine (by the addon) so set-vantage validation and this delay pass
    /// see the SAME centres.
    ///
    /// <para>Two sampled sources, deliberately: the matrix pass writes ENGINE
    /// STATE that command dispatch and currency spends read, so it runs
    /// UNGATED; the roster is an ordinary published channel and stays
    /// subscription-gated. See <see cref="Register"/>.</para>
    /// </summary>
    public sealed class CommandCentreDelayUplink : ISitrepUplink
    {
        public const string RosterTopic = "commandCentre.roster";
        public const string SeparationTopic = "commandCentre.separation";
        public const string UnreachableTopic = "commandCentre.unreachable";

        public const string ActiveVesselDelayTopic = "commandCentre.activeVesselDelay";

        /// <summary>
        /// Soft cap on graph SOLVES per pass. Every row but home's and every
        /// centre-to-centre row runs a Dijkstra over the whole node list, in the
        /// elected backend's own router, unlike the home rows, which only read a
        /// path the game has already solved. The count is centres x
        /// (vessels + centres), so it grows with the fleet as well as with the
        /// number of authorities: this is the number worth watching if the
        /// capture ever starts costing frame time.
        /// </summary>
        private static readonly PerfBudget PathSolveBudget = new PerfBudget(
            "CommandCentreDelayUplink routed path solves", threshold: 2000, windowSec: 1.0, unit: "solves");

        private readonly CommandCentreRegistry _registry;
        private readonly Func<HomeCommand> _home;
        private IUplinkHost? _host;

        /// <param name="registry">The same registry the engine enumerates for set-vantage validation.</param>
        /// <param name="home">
        /// The elected home-command claimant's answer as the engine captured it this tick.
        /// Null answers not identified, which is what a test that models no claimant wants.
        /// </param>
        public CommandCentreDelayUplink(CommandCentreRegistry registry, Func<HomeCommand>? home = null)
        {
            _registry = registry;
            _home = home ?? (() => HomeCommand.NotIdentified);
        }

        /// <summary>
        /// Degraded while the registry is dropping a centre for an id another centre
        /// already claimed, with one fact per collision naming the id and both
        /// sources. Every roster entry and delay row this uplink builds comes off
        /// that enumeration, so a dropped centre is a hole in both.
        /// </summary>
        public UplinkHealth Health()
        {
            var collisions = _registry.Collisions;
            if (collisions.Count == 0)
            {
                return UplinkHealth.Healthy;
            }

            return UplinkHealth.Degraded(
                collisions.Count == 1
                    ? "1 command centre dropped: its id is already claimed"
                    : collisions.Count + " command centres dropped: their ids are already claimed",
                collisions
                    .Select(c => new UplinkHealthFact(
                        c.Id,
                        "kept from " + c.KeptProviderId + ", dropped from " + c.DroppedProviderId))
                    .ToList());
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "command-centre-delay",
            Version = "1.0.0",
            // No channels. The roster, what has left it, the separations and
            // each centre's delay to the active craft are each centre's own,
            // sent by the contact plan source from what that centre has heard.
            // This Uplink writes the delay ledger the engine times traffic by.
            Channels = new List<ChannelDeclaration>(),
        };

        /// <summary>
        /// Registers the delay matrix pass, UNGATED. Its output is not a topic:
        /// it is the (vantage, node) delay ledger the engine consults when it
        /// schedules a command, and centre-to-centre rows price currency
        /// spends. Riding it on a topic-prefix gate, as it used to, made every
        /// one of those numbers depend on whether some browser tab happened to
        /// be subscribed to a <c>fleet.*</c> topic.
        ///
        /// <para>The cost is real and accepted: the routed solves counted by
        /// <see cref="PathSolveBudget"/> run every tick.</para>
        /// </summary>
        public void Register(IUplinkHost host)
        {
            _host = host;
            host.AddSampledSource(CaptureLedgerOnMain, ApplyLedgerOnCourier);
        }

        /// <summary>
        /// MAIN-THREAD capture: enumerate the active centres and compute a delay
        /// row for each against every fleet subject AND against every other
        /// centre. Both subject namespaces are captured here because both are KSP
        /// reads (a graph solve), and KSP reads only happen on this thread.
        /// </summary>
        internal object? CaptureLedgerOnMain(KspSnapshot? snapshot)
        {
            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            var centres = _registry.EnumerateActive();
            var config = CommsCoreUplink.SignalDelayConfig;
            // Resolved ONCE per pass, not per row: the election does not change
            // mid-capture, and every routed row below is solved by this backend's
            // own router rather than by stock's (see FleetCommsReader.ReadNodePath).
            var kernel = _host?.Kernel;
            var backend = kernel != null ? CommsElection.Elected(kernel) : null;

            var solves = new SolveCounter();
            var activeGuid = ActiveVesselGuid(snapshot);
            var activeRoutes = new Dictionary<string, IReadOnlyList<CommsHop>>();
            var capture = BuildLedger(
                centres,
                _home(),
                vessels.Where(v => v != null).Select(v => v.id.ToString()).ToList(),
                activeGuid,
                (centre, guid, isHome) => RouteDelay(
                    backend, centre, isHome, guid, config, vessels, solves,
                    guid == activeGuid ? activeRoutes : null),
                (from, to) => RouteCentreDelay(backend, from, to, config, solves),
                centre => SecondsToHome(centre, config),
                centre => ReachesGround(centre, vessels, config));
            capture.Ut = snapshot != null ? snapshot.Ut : 0.0;
            capture.ActiveRoutes = activeRoutes;

            PathSolveBudget.Record(solves.Count, capture.Ut);
            return capture;
        }

        /// <summary>
        /// Every row of the ledger for one pass, from the centres, the home
        /// claimant's answer and the routes the game measures.
        ///
        /// <para>The home centre here is the one the roster marks home: the
        /// claimant's answer, or the ground station standing in for it when
        /// the claimant cannot say. Either way it is timed by the craft's own
        /// path to the ground, whichever station that path ends at, because
        /// every ground station is the home centre's own antenna. A stand-in
        /// timed as an ordinary station was quoted the route to that one
        /// station's own dish, by way of a far relay whenever the craft was
        /// talking to a different station.</para>
        /// </summary>
        /// <param name="routeToCraft">One-way seconds from a centre to a craft's guid, told whether the centre is home, or null when nothing routes.</param>
        /// <param name="routeBetweenCentres">One-way seconds between two centres, or null when nothing routes.</param>
        /// <param name="secondsToHome">A non-ground centre's path home, or null when it has none to measure.</param>
        /// <param name="reachesGround">Whether a crewed centre's route ends at a ground station, or null for any other kind.</param>
        internal static LedgerCapture BuildLedger(
            IReadOnlyList<ICommandCentre> centres,
            HomeCommand home,
            IReadOnlyList<string> subjectGuids,
            string? activeGuid,
            Func<ICommandCentre, string, bool, double?> routeToCraft,
            Func<ICommandCentre, ICommandCentre, double?> routeBetweenCentres,
            Func<ICommandCentre, double?> secondsToHome,
            Func<ICommandCentre, bool?> reachesGround)
        {
            var homeId = HomeCentreId(centres, home);
            var rows = new List<AuthorityRow>();
            void Row(string vantage, string node, double seconds) =>
                rows.Add(new AuthorityRow { Vantage = vantage, Node = node, Seconds = seconds });

            // The active craft's row is the same route as its fleet row, so a pair already
            // solved for the fleet is read back rather than solved a second time.
            var routed = new Dictionary<(string CentreId, string Guid), double?>();
            double? Routed(ICommandCentre centre, string guid)
            {
                if (!routed.TryGetValue((centre.Id, guid), out var seconds))
                {
                    seconds = routeToCraft(centre, guid, homeId != null && centre.Id == homeId);
                    routed[(centre.Id, guid)] = seconds;
                }
                return seconds;
            }

            var pass = new AuthorityMatrixPass();
            pass.Populate(centres, subjectGuids, Routed, Row);
            pass.PopulateActiveVessel(
                centres,
                activeGuid,
                homeId,
                Routed,
                (vantage, seconds) => Row(vantage, ChannelEngine.NodeId, seconds));
            pass.PopulateCentrePairs(centres, routeBetweenCentres, Row);
            pass.PopulateHomeCommand(
                centres,
                homeId,
                secondsToHome,
                (vantage, seconds) => Row(vantage, ChannelEngine.HomeCommandNode, seconds));

            return new LedgerCapture
            {
                Rows = rows,
                Unroutable = pass.Unroutable(centres, homeId, subjectGuids, activeGuid, Routed, reachesGround),
            };
        }

        /// <summary>COURIER-THREAD handle: write the explicit-pair delays into the engine's ledger.</summary>
        internal void ApplyLedgerOnCourier(object? captured)
        {
            if (captured is not LedgerCapture cap)
            {
                return;
            }

            // Handed over as sets on every pass, empty included, so a centre that
            // stopped being the active craft or lost its route to a craft loses its row.
            var activeVesselRows = new Dictionary<string, double>();
            var fleetRows = new List<(string CentreId, string VesselId, double OneWaySeconds)>();
            var centreRoutes = new Dictionary<string, List<string>>();
            foreach (var row in cap.Rows)
            {
                if (row.Node == ChannelEngine.HomeCommandNode)
                {
                    _host?.SetHomeCommandDelay(row.Vantage, row.Seconds);
                    continue;
                }

                if (row.Node == ChannelEngine.NodeId)
                {
                    activeVesselRows[row.Vantage] = row.Seconds;
                    continue;
                }

                // The row's node is already namespaced ("fleet.<guid>" or
                // "centre.<id>") and both host hooks re-derive it from the bare
                // subject id, so strip the prefix back off to pick the hook.
                if (row.Node.StartsWith(ChannelEngine.CentreNodePrefix))
                {
                    var destination = row.Node.Substring(ChannelEngine.CentreNodePrefix.Length);
                    _host?.SetCentreDelay(row.Vantage, destination, row.Seconds);
                    if (!centreRoutes.TryGetValue(row.Vantage, out var reached))
                    {
                        reached = new List<string>();
                        centreRoutes[row.Vantage] = reached;
                    }
                    reached.Add(destination);
                    continue;
                }

                var guid = row.Node.StartsWith(ChannelEngine.FleetNodePrefix)
                    ? row.Node.Substring(ChannelEngine.FleetNodePrefix.Length)
                    : row.Node;
                fleetRows.Add((row.Vantage, guid, row.Seconds));
            }

            _host?.SetActiveVesselDelays(activeVesselRows);
            (_host as IActiveRouteHost)?.SetActiveVesselRoutes(cap.ActiveRoutes);
            var reach = _host as ICommandReachWriter;
            reach?.SetAuthorityDelays(fleetRows);
            reach?.SetUnroutable(cap.Unroutable);
            (_host as ICentreRouteWriter)?.SetCentreRoutes(
                centreRoutes.ToDictionary(r => r.Key, r => (IReadOnlyCollection<string>)r.Value));
        }

        /// <summary>
        /// The craft this tick's ordinary channels describe: the snapshot's own active
        /// vessel, the subject <see cref="VesselEpochSampler"/> watches for a switch. Read
        /// live from <see cref="ActiveVesselScope"/> only when the tick carries no snapshot.
        /// </summary>
        private static string? ActiveVesselGuid(KspSnapshot? snapshot) =>
            snapshot != null
                ? VesselViewProvider.TryGetActiveVesselId(snapshot)
                : ActiveVesselScope.Current?.id.ToString();

        /// <summary>MAIN THREAD: every active centre as a roster entry, home marked. What the contact plan source makes each centre's own roster from.</summary>
        internal List<CommandCentreEntry> RosterNow() => ToRoster(_registry.EnumerateActive(), _home());

        /// <summary>
        /// One-way seconds from a centre to a subject vessel. The home command, as the
        /// elected claimant names it, reuses the subject's OWN routed light-time via
        /// <see cref="FleetCommsReader.ReadVessel"/>, so the explicit (home, fleet.&lt;guid&gt;)
        /// row equals Plan 2's node-default (home parity, T13): the vessel's solved path
        /// home IS the path to that centre, and re-solving it here could only introduce a
        /// discrepancy. Any other centre, and every centre when no home is identified,
        /// solves the graph between its own node and the subject's.
        ///
        /// <para>Still null-not-zero when nothing routes. The straight-line
        /// distance this branch used to fall back to was wrong in a way that
        /// mattered: commands ride the relay network, so a pair with no route has
        /// no delay to quote, and the chord invented one anyway, which made an
        /// unroutable subject look reachable and timed. Nothing is lost by
        /// refusing to guess, because off the network there is no way to send or
        /// receive the command at all. The matrix pass reads null as "write no
        /// row for this pair".</para>
        /// </summary>
        private static double? RouteDelay(
            ICommsBackend? backend,
            ICommandCentre centre,
            bool centreIsHome,
            string guid,
            SignalDelayConfig? config,
            IList<Vessel> vessels,
            SolveCounter solves,
            Dictionary<string, IReadOnlyList<CommsHop>>? routesOut = null)
        {
            var vessel = vessels.FirstOrDefault(v => v != null && v.id.ToString() == guid);
            if (vessel == null)
            {
                return null;
            }

            if (centreIsHome)
            {
                var (oneWay, _) = FleetCommsReader.ReadVessel(vessel, config);
                return oneWay;
            }

            var from = (centre as KspCommandCentre)?.Node;
            var to = vessel.connection?.Comm;
            if (from == null || to == null)
            {
                return null;
            }

            solves.Count++;
            var (seconds, route) = FleetCommsReader.ReadNodeRoute(backend, from, to, config);
            if (routesOut != null && seconds != null)
            {
                var hops = ActiveRoute.Hops(route, NodeNamed);
                if (hops != null)
                {
                    routesOut[centre.Id] = hops;
                }
            }
            return seconds;
        }

        private static (string Id, bool IsHome)? NodeNamed(CommsNodeHandle? handle) =>
            handle?.As<CommNode>() is CommNode node ? (CommNetBackend.NodeId(node), node.isHome) : ((string, bool)?)null;

        /// <summary>
        /// A non-ground centre's path home, for the home-command ledger row. A crewed
        /// vessel is measured by <see cref="CurrencyDelay.KscLightTime.SecondsToHome"/>,
        /// the definition a currency award from that vessel is timed by, so the award
        /// reaching the ledger and the new total coming back are the same seconds.
        /// Any other kind has no path home to measure and gets no row.
        /// </summary>
        private static double? SecondsToHome(ICommandCentre centre, SignalDelayConfig? config)
        {
            if (centre.Kind != CommandCentreKind.CrewedVessel
                || !centre.Id.StartsWith(CrewedVesselIdPrefix, StringComparison.Ordinal))
            {
                return null;
            }

            return CurrencyDelay.KscLightTime.SecondsToHome(centre.Id.Substring(CrewedVesselIdPrefix.Length), config);
        }

        private const string CrewedVesselIdPrefix = "vessel:";

        /// <summary>
        /// Whether a crewed-vessel centre's route ends at a ground station. Null for
        /// any other kind, and for a craft the roster does not hold, neither of
        /// which has a route of its own to read.
        /// </summary>
        private static bool? ReachesGround(ICommandCentre centre, IList<Vessel> vessels, SignalDelayConfig? config)
        {
            if (centre.Kind != CommandCentreKind.CrewedVessel
                || !centre.Id.StartsWith(CrewedVesselIdPrefix, StringComparison.Ordinal))
            {
                return null;
            }

            var guid = centre.Id.Substring(CrewedVesselIdPrefix.Length);
            var vessel = vessels.FirstOrDefault(v => v != null && v.id.ToString() == guid);
            return vessel == null ? null : FleetCommsReader.ReachesGround(vessel, config);
        }

        /// <summary>
        /// The centre the roster marks home: the claimant's answer, or the ground
        /// station standing in for it. Null when neither exists.
        /// </summary>
        internal static string? HomeCentreId(IReadOnlyList<ICommandCentre> centres, HomeCommand home)
        {
            var id = FreshConnectionVantage.Choose(
                centres.Select(c => c.Id).ToList(),
                centres.Where(c => c.Kind == CommandCentreKind.GroundStation).Select(GroundSiteOf),
                home,
                SpaceCentreSite.Current());
            return id == FreshConnectionVantage.None ? null : id;
        }

        internal static GroundSite GroundSiteOf(ICommandCentre centre) =>
            new GroundSite(
                centre.Id,
                centre.Latitude.HasValue && centre.Longitude.HasValue
                    ? new SurfaceSite(centre.Latitude.Value, centre.Longitude.Value)
                    : (SurfaceSite?)null);

        /// <summary>
        /// One-way seconds between two command centres, over the route the
        /// ELECTED BACKEND finds between their nodes. A centre with no node
        /// cannot be routed to or from at all, which is the same "unroutable" the
        /// roster already publishes for it.
        /// </summary>
        private static double? RouteCentreDelay(
            ICommsBackend? backend,
            ICommandCentre from,
            ICommandCentre to,
            SignalDelayConfig? config,
            SolveCounter solves)
        {
            var fromNode = (from as KspCommandCentre)?.Node;
            var toNode = (to as KspCommandCentre)?.Node;
            if (fromNode == null || toNode == null)
            {
                return null;
            }

            solves.Count++;
            return FleetCommsReader.ReadNodePath(backend, fromNode, toNode, config);
        }

        /// <summary>
        /// The active centres as roster entries, with <see cref="CommandCentreEntry.IsHome"/>
        /// set on the centre <see cref="FreshConnectionVantage.Choose"/> answers: the one the
        /// claimant named, or, when it named no active centre, the ground station standing in
        /// for it, which also carries <see cref="CommandCentreEntry.IsHomeFallback"/>.
        /// </summary>
        internal static List<CommandCentreEntry> ToRoster(IEnumerable<ICommandCentre> centres, HomeCommand home)
        {
            var list = centres.ToList();
            var homeId = HomeCentreId(list, home);
            var isFallback = homeId != null
                && !(home.IsIdentified && homeId == home.CentreId);
            return list.Select(c => ToRosterEntry(c, homeId, isFallback)).ToList();
        }

        private static CommandCentreEntry ToRosterEntry(ICommandCentre centre, string? homeId, bool homeIsFallback)
        {
            var ksp = centre as KspCommandCentre;
            var isHome = homeId != null && centre.Id == homeId;
            return new CommandCentreEntry
            {
                Id = centre.Id,
                DisplayName = centre.DisplayName,
                Kind = centre.Kind.ToString(),
                BodyIndex = centre.BodyIndex,
                Active = centre.IsActiveNow(),
                IsHome = isHome,
                IsHomeFallback = isHome && homeIsFallback,
                // Copied, never derived here. Whether a centre is surface-anchored is
                // known only to the source that produced it, and a null is the
                // contract's "not applicable" rather than "not computed": see
                // SurfaceCoordinates and CommandCentreEntry.Latitude.
                Latitude = centre.Latitude,
                Longitude = centre.Longitude,
                // Only one honest value now. A centre with no CommNode cannot be
                // routed to, so it reports that rather than a quality of estimate.
                DelayQuality = ksp?.Node != null ? "routed" : "unroutable",
            };
        }

        /// <summary>Counts the Dijkstra solves a capture pass ran, for <see cref="PathSolveBudget"/>.</summary>
        private sealed class SolveCounter
        {
            public int Count;
        }

        internal sealed class AuthorityRow
        {
            public string Vantage = "";
            public string Node = "";
            public double Seconds;
        }

        internal sealed class LedgerCapture
        {
            public List<AuthorityRow> Rows = new List<AuthorityRow>();
            public IReadOnlyDictionary<string, IReadOnlyCollection<string>> Unroutable =
                new Dictionary<string, IReadOnlyCollection<string>>();
            public IReadOnlyDictionary<string, IReadOnlyList<CommsHop>> ActiveRoutes =
                new Dictionary<string, IReadOnlyList<CommsHop>>();
            public double Ut;
        }

    }
}
