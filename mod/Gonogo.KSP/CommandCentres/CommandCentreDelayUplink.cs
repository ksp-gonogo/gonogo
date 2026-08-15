using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP.CommandCentres
{
    // NOTE (agent-6, Plan 3, T7 KSP glue): NOT locally compilable (no KspManaged
    // refs). Verify at the full-sln fold. The KSC routeDelay reproduces Plan 2's
    // node-default so T13's KSC-parity gate holds. The FindClosestControlSource
    // multi-source tie-break is still a Deck live-confirm item, to be validated
    // in-scene before multi-authority selection is trusted (per main's steer).

    /// <summary>
    /// Populates the per-(authority, subject) command-delay matrix each fleet
    /// tick and publishes <c>commandCentre.roster</c> (Plan 3). Owns the command-
    /// centre sources + registry; the same registry instance is registered on the
    /// ChannelEngine (by the addon) so set-vantage validation and this delay pass
    /// see the SAME centres. Subscription-gated on the fleet namespace, riding the
    /// same capture cadence as <see cref="FleetDelayUplink"/>.
    /// </summary>
    public sealed class CommandCentreDelayUplink : ISitrepUplink
    {
        public const string RosterTopic = "commandCentre.roster";

        /// <summary>
        /// Soft cap on graph SOLVES per pass. Every non-KSC row and every
        /// centre-to-centre row runs a Dijkstra over the whole CommNet node list
        /// (stock <c>CommNetwork.FindPath</c>), unlike the KSC rows, which only
        /// read a path the game has already solved. The count is centres x
        /// (vessels + centres), so it grows with the fleet as well as with the
        /// number of authorities: this is the number worth watching if the
        /// capture ever starts costing frame time.
        /// </summary>
        private static readonly PerfBudget PathSolveBudget = new PerfBudget(
            "CommandCentreDelayUplink routed path solves", threshold: 2000, windowSec: 1.0, unit: "solves");

        private readonly CommandCentreRegistry _registry;
        private IUplinkHost? _host;
        private IChannelPublisher? _rosterPublisher;

        public CommandCentreDelayUplink(CommandCentreRegistry registry) => _registry = registry;

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "command-centre-delay",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = RosterTopic,
                    Delivery = Delivery.LossyLatest,
                    // Ground-side facts about who can command; instant, same class
                    // as spaceCenter.launchSites / spaceCenter.pois.
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            _host = host;
            _rosterPublisher = host.Publisher(RosterTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, ChannelEngine.FleetNodePrefix);
        }

        /// <summary>
        /// MAIN-THREAD capture: enumerate the active centres, compute a delay row
        /// for each against every fleet subject AND against every other centre,
        /// and build the roster. Both subject namespaces are captured here because
        /// both are KSP reads (a graph solve), and KSP reads only happen on this
        /// thread.
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            var centres = _registry.EnumerateActive();
            var config = CommsCoreUplink.SignalDelayConfig;

            var rows = new List<AuthorityRow>();
            var solves = new SolveCounter();
            void Row(string vantage, string node, double seconds) =>
                rows.Add(new AuthorityRow { Vantage = vantage, Node = node, Seconds = seconds });

            var pass = new AuthorityMatrixPass();
            pass.Populate(
                centres,
                vessels.Where(v => v != null).Select(v => v.id.ToString()).ToList(),
                (centre, guid) => RouteDelay(centre, guid, config, vessels, solves),
                Row);
            pass.PopulateCentrePairs(
                centres,
                (from, to) => RouteCentreDelay(from, to, config, solves),
                Row);

            PathSolveBudget.Record(solves.Count, snapshot != null ? snapshot.Ut : 0.0);

            var roster = centres.Select(ToRosterEntry).ToList();
            return new CommandCentreCapture { Rows = rows, Roster = roster };
        }

        /// <summary>COURIER-THREAD handle: apply the explicit-pair delays + publish the roster.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not CommandCentreCapture cap)
            {
                return;
            }

            foreach (var row in cap.Rows)
            {
                // The row's node is already namespaced ("fleet.<guid>" or
                // "centre.<id>") and both host hooks re-derive it from the bare
                // subject id, so strip the prefix back off to pick the hook.
                if (row.Node.StartsWith(ChannelEngine.CentreNodePrefix))
                {
                    _host?.SetCentreDelay(
                        row.Vantage,
                        row.Node.Substring(ChannelEngine.CentreNodePrefix.Length),
                        row.Seconds);
                    continue;
                }

                var guid = row.Node.StartsWith(ChannelEngine.FleetNodePrefix)
                    ? row.Node.Substring(ChannelEngine.FleetNodePrefix.Length)
                    : row.Node;
                _host?.SetAuthorityDelay(row.Vantage, guid, row.Seconds);
            }

            _rosterPublisher?.Publish(cap.Roster, cap.Roster.Count);
        }

        /// <summary>
        /// One-way seconds from a centre to a subject vessel. KSC reuses the
        /// subject's OWN routed (vessel↔KSC) light-time via <see cref="FleetCommsReader.ReadVessel"/>,
        /// so the explicit (ksc, fleet.&lt;guid&gt;) row equals Plan 2's node-default
        /// (KSC parity, T13) -- the vessel's solved path home IS the path to KSC, and
        /// re-solving it here could only introduce a discrepancy. Any other centre
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
            ICommandCentre centre,
            string guid,
            SignalDelayConfig? config,
            IList<Vessel> vessels,
            SolveCounter solves)
        {
            var vessel = vessels.FirstOrDefault(v => v != null && v.id.ToString() == guid);
            if (vessel == null)
            {
                return null;
            }

            if (centre.Id == "ksc")
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
            return FleetCommsReader.ReadNodePath(from, to, config);
        }

        /// <summary>
        /// One-way seconds between two command centres, walking the relay graph
        /// between their CommNet nodes. A centre with no node cannot be routed to
        /// or from at all, which is the same "unroutable" the roster already
        /// publishes for it.
        /// </summary>
        private static double? RouteCentreDelay(
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
            return FleetCommsReader.ReadNodePath(fromNode, toNode, config);
        }

        private static CommandCentreEntry ToRosterEntry(ICommandCentre centre)
        {
            var ksp = centre as KspCommandCentre;
            return new CommandCentreEntry
            {
                Id = centre.Id,
                DisplayName = centre.DisplayName,
                Kind = centre.Kind.ToString(),
                BodyIndex = centre.BodyIndex,
                Active = centre.IsActiveNow(),
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

        private sealed class AuthorityRow
        {
            public string Vantage = "";
            public string Node = "";
            public double Seconds;
        }

        private sealed class CommandCentreCapture
        {
            public List<AuthorityRow> Rows = new List<AuthorityRow>();
            public List<CommandCentreEntry> Roster = new List<CommandCentreEntry>();
        }
    }
}
