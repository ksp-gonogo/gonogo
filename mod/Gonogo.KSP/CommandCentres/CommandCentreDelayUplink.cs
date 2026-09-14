using System;
using System.Collections.Generic;
using System.Linq;
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

        /// <summary>
        /// Soft cap on separation PAIRS published per second. The matrix is
        /// centres squared, and a crewed-heavy career makes every controllable
        /// craft a centre, so this is the number that grows quadratically in
        /// something the operator controls. It is a publish-volume budget rather
        /// than a work budget: the rows are already built for the ledger, and
        /// what this watches is the wire.
        /// </summary>
        private static readonly PerfBudget SeparationPairsBudget = new PerfBudget(
            "CommandCentreDelayUplink separation pairs", threshold: 4000, windowSec: 1.0, unit: "pairs");

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
        private IChannelPublisher? _rosterPublisher;
        private IChannelPublisher? _separationPublisher;

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
                new ChannelDeclaration
                {
                    Topic = SeparationTopic,
                    Delivery = Delivery.LossyLatest,
                    // DELAYED on the same reasoning as comms.delay, and the
                    // circularity this used to claim does not exist. What gates
                    // one vantage's traffic to another is the LEDGER: the rows
                    // CaptureLedgerOnMain writes go straight into the engine
                    // through SetCentreDelay/SetAuthorityDelay, which never read
                    // a topic. This channel is a READOUT built from the same
                    // rows, so delaying it changes what an operator is shown and
                    // nothing about what carries it. The number they are shown is
                    // then the separation as OBSERVED, which is the only one
                    // anybody at a vantage could have.
                    Delay = DelayRole.Delayed,
                    // Never aboard anything: the matrix is solved on the ground
                    // over the whole node list, so there is no craft that could
                    // have written it down and nothing to replay on
                    // reacquisition. The gap is stated instead.
                    Recordable = false,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        /// <summary>
        /// Registers the delay matrix and the roster as SEPARATE sampled
        /// sources, because only one of the two is a published channel.
        ///
        /// <para>The matrix pass is UNGATED. Its output is not a topic: it is
        /// the (vantage, node) delay ledger the engine consults when it
        /// schedules a command, and centre-to-centre rows now price currency
        /// spends. Riding it on a topic-prefix gate, as it used to, made every
        /// one of those numbers depend on whether some browser tab happened to
        /// be subscribed to a <c>fleet.*</c> topic, i.e. a career outcome
        /// decided by an operator's dashboard layout. <see cref="FleetChannels"/>'s
        /// silence capture is ungated for exactly this reason.</para>
        ///
        /// <para>The cost is real and accepted: the routed solves counted by
        /// <see cref="PathSolveBudget"/> now run every tick rather than only
        /// while someone is watching the fleet. That budget is the place to
        /// watch it; re-gating the ledger to save the solves would trade
        /// correctness for frame time.</para>
        ///
        /// <para>The roster stays gated, on its OWN topic rather than on the
        /// fleet namespace it used to borrow: it is published as
        /// <see cref="RosterTopic"/> and read by nothing else, so "nobody is
        /// subscribed to the roster" is the precise condition under which
        /// building it is wasted work. Gating it on <c>fleet.</c> was a
        /// coincidence of the two jobs having shared one source.</para>
        /// </summary>
        public void Register(IUplinkHost host)
        {
            _host = host;
            _rosterPublisher = host.Publisher(RosterTopic);
            _separationPublisher = host.Publisher(SeparationTopic);
            host.AddSampledSource(CaptureLedgerOnMain, ApplyLedgerOnCourier);
            host.AddSampledSource(CaptureRosterOnMain, PublishRosterOnCourier, RosterTopic);
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

            var homeId = _home().CentreId;
            var rows = new List<AuthorityRow>();
            var solves = new SolveCounter();
            void Row(string vantage, string node, double seconds) =>
                rows.Add(new AuthorityRow { Vantage = vantage, Node = node, Seconds = seconds });

            // The active craft's row is the same route as its fleet row, so a pair already
            // solved for the fleet is read back rather than solved a second time.
            var routed = new Dictionary<(string CentreId, string Guid), double?>();
            double? Routed(ICommandCentre centre, string guid)
            {
                if (!routed.TryGetValue((centre.Id, guid), out var seconds))
                {
                    seconds = RouteDelay(backend, centre, homeId, guid, config, vessels, solves);
                    routed[(centre.Id, guid)] = seconds;
                }
                return seconds;
            }

            var pass = new AuthorityMatrixPass();
            pass.Populate(
                centres,
                vessels.Where(v => v != null).Select(v => v.id.ToString()).ToList(),
                Routed,
                Row);
            pass.PopulateActiveVessel(
                centres,
                ActiveVesselGuid(snapshot),
                homeId,
                Routed,
                (vantage, seconds) => Row(vantage, ChannelEngine.NodeId, seconds));
            pass.PopulateCentrePairs(
                centres,
                (from, to) => RouteCentreDelay(backend, from, to, config, solves),
                Row);
            pass.PopulateHomeCommand(
                centres,
                HomeCentreId(centres, _home()),
                centre => SecondsToHome(centre, config),
                (vantage, seconds) => Row(vantage, ChannelEngine.HomeCommandNode, seconds));

            PathSolveBudget.Record(solves.Count, snapshot != null ? snapshot.Ut : 0.0);

            return new LedgerCapture { Rows = rows, Ut = snapshot != null ? snapshot.Ut : 0.0 };
        }

        /// <summary>COURIER-THREAD handle: write the explicit-pair delays into the engine's ledger.</summary>
        internal void ApplyLedgerOnCourier(object? captured)
        {
            if (captured is not LedgerCapture cap)
            {
                return;
            }

            // Handed over as one set on every pass, empty included, so a centre that
            // stopped being the active craft or lost its route to it loses its row.
            var activeVesselRows = new Dictionary<string, double>();
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

            _host?.SetActiveVesselDelays(activeVesselRows);

            PublishSeparation(cap);
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

        /// <summary>
        /// Publishes the centre-to-centre half of the ledger as
        /// <see cref="SeparationTopic"/>.
        ///
        /// <para>It rides the ledger's capture rather than a source of its own
        /// because the rows are ALREADY BUILT here: re-deriving them under a
        /// subscription gate would run the whole centres-squared graph solve a
        /// second time to publish numbers the first pass had in hand. The cost
        /// of that choice is that this channel emits whether or not anyone is
        /// subscribed, which the emission policy keeps small (nothing goes out
        /// while the matrix is unchanged).</para>
        ///
        /// <para>Only the <c>centre.</c> namespace: the <c>fleet.</c> rows in the
        /// same list are a centre's delay to a SUBJECT craft it observes, which
        /// is a different question from how far two vantages are apart, and a
        /// craft that is a vantage appears here under its own centre id.</para>
        /// </summary>
        private void PublishSeparation(LedgerCapture cap)
        {
            if (_separationPublisher == null)
            {
                return;
            }

            var pairs = new List<CentreSeparationEntry>();
            foreach (var row in cap.Rows)
            {
                if (!row.Node.StartsWith(ChannelEngine.CentreNodePrefix))
                {
                    continue;
                }

                pairs.Add(new CentreSeparationEntry
                {
                    From = row.Vantage,
                    To = row.Node.Substring(ChannelEngine.CentreNodePrefix.Length),
                    OneWaySeconds = row.Seconds,
                });
            }

            SeparationPairsBudget.Record(pairs.Count, cap.Ut);
            _separationPublisher.Publish(new CommandCentreSeparation { Pairs = pairs }, cap.Ut);
        }

        /// <summary>MAIN-THREAD capture: the active centres as roster entries.</summary>
        internal object? CaptureRosterOnMain(KspSnapshot? snapshot) =>
            new RosterCapture
            {
                Roster = ToRoster(_registry.EnumerateActive(), _home()),
                Ut = snapshot != null ? snapshot.Ut : 0.0,
            };

        /// <summary>COURIER-THREAD handle: publish the roster.</summary>
        internal void PublishRosterOnCourier(object? captured)
        {
            if (captured is not RosterCapture cap)
            {
                return;
            }

            _rosterPublisher?.Publish(cap.Roster, cap.Ut);
        }

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
            string? homeId,
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

            if (homeId != null && centre.Id == homeId)
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
            return FleetCommsReader.ReadNodePath(backend, from, to, config);
        }

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
        /// The centre the roster marks home: the claimant's answer, or the ground
        /// station standing in for it. Null when neither exists.
        /// </summary>
        internal static string? HomeCentreId(IReadOnlyList<ICommandCentre> centres, HomeCommand home)
        {
            var id = FreshConnectionVantage.Choose(
                centres.Select(c => c.Id).ToList(),
                centres.Where(c => c.Kind == CommandCentreKind.GroundStation).Select(c => c.Id),
                home);
            return id == FreshConnectionVantage.None ? null : id;
        }

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
            public double Ut;
        }

        private sealed class RosterCapture
        {
            public List<CommandCentreEntry> Roster = new List<CommandCentreEntry>();

            /// <summary>
            /// The capture's own universe time, carried across to the courier
            /// thread so the publish is stamped with when the roster was READ
            /// rather than with whatever the courier thread can reach. This
            /// used to be absent and the publish passed the roster's entry
            /// COUNT: a number far below any real UT, which the engine's
            /// forward-only clamp lets through untouched, so the sample landed
            /// stamped in the deep past with <c>validAt</c> equal to a
            /// command-centre count.
            /// </summary>
            public double Ut;
        }
    }
}
