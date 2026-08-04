using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using UnityEngine;

namespace Gonogo.KSP.CommandCentres
{
    // NOTE (agent-6, Plan 3, T7 KSP glue): NOT locally compilable (no KspManaged
    // refs). Verify at the full-sln fold. The KSC routeDelay reproduces Plan 2's
    // node-default so T13's KSC-parity gate holds. The NON-KSC routeDelay (routed
    // delay from a crewed-vessel / KK centre to a subject) and the
    // FindClosestControlSource multi-source tie-break are the Deck live-confirm
    // items: written straight-line-from-Position here, to be validated in-scene
    // before multi-authority selection is trusted (per main's steer).

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

        /// <summary>MAIN-THREAD capture: enumerate active centres x fleet subjects, compute each row's delay, and build the roster.</summary>
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
            new AuthorityMatrixPass().Populate(
                centres,
                vessels.Where(v => v != null).Select(v => v.id.ToString()).ToList(),
                (centre, guid) => RouteDelay(centre, guid, config, vessels),
                (vantage, node, seconds) => rows.Add(new AuthorityRow { Vantage = vantage, Node = node, Seconds = seconds }));

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
                // node is already "fleet.<guid>"; SetAuthorityDelay re-derives it
                // from the vessel guid, so pass the guid back out of the node.
                var guid = row.Node.StartsWith(ChannelEngine.FleetNodePrefix)
                    ? row.Node.Substring(ChannelEngine.FleetNodePrefix.Length)
                    : row.Node;
                _host?.SetAuthorityDelay(row.Vantage, guid, row.Seconds);
            }

            _rosterPublisher?.Publish(cap.Roster, cap.Roster.Count);
        }

        /// <summary>
        /// One-way seconds from a centre to a subject vessel. KSC reuses the
        /// subject's OWN routed (vessel↔KSC) light-time via <see cref="FleetCommsReader"/>,
        /// so the explicit (ksc, fleet.&lt;guid&gt;) row equals Plan 2's node-default
        /// (KSC parity, T13). A non-KSC CommNode-backed centre would route via its
        /// ControlPath; the Deck-confirm first cut is straight-line from Position.
        /// </summary>
        private static double? RouteDelay(ICommandCentre centre, string guid, SignalDelayConfig? config, IList<Vessel> vessels)
        {
            if (centre.Id == "ksc")
            {
                var vessel = vessels.FirstOrDefault(v => v != null && v.id.ToString() == guid);
                if (vessel == null)
                {
                    return null;
                }
                var (oneWay, _) = FleetCommsReader.ReadVessel(vessel, config);
                return oneWay;
            }

            // NON-KSC (Deck live-confirm): straight-line from the centre's position
            // to the subject; a routed ControlPath walk from centre.Node is the
            // in-scene refinement (with the FindClosestControlSource tie-break).
            if (centre is KspCommandCentre ksp && config != null && config.LightSpeedScale > 0.0)
            {
                var vessel = vessels.FirstOrDefault(v => v != null && v.id.ToString() == guid);
                if (vessel == null)
                {
                    return null;
                }
                var distance = (ksp.Position - vessel.GetWorldPos3D()).magnitude;
                return distance / (299792458.0 * config.LightSpeedScale);
            }

            return null;
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
                DelayQuality = ksp?.Node != null ? "routed" : "straight-line",
            };
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
