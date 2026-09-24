using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>fleet.&lt;guid&gt;.*</c> dynamic namespace: each fleet-capture
    /// tick, reads every
    /// <c>FlightGlobals.Vessels</c> vessel's OWN routed light-time
    /// (<see cref="FleetCommsReader"/>) + orbit, sets the per-vessel node delay
    /// via <see cref="IUplinkHost.SetVesselDelay"/>, and emits the orbit on
    /// <c>fleet.&lt;guid&gt;.orbit</c> (delayed by that vessel's own light-time).
    ///
    /// <para>This is the KSP-facing hookup of the mechanism proven engine-side by
    /// <c>FleetDelayTestUplink</c> (which is snapshot-driven; this reads live
    /// <c>FlightGlobals</c> on the main thread, so it is validated at runtime on
    /// KSP, not in the KSP-free integration test project).</para>
    ///
    /// <para><b>Core, not comms-derived.</b> Everything here is ordinary KSP
    /// network-presence fact: with CommNet disabled, <c>connected</c> is simply
    /// always <c>true</c>. It registers unconditionally, independent of whether
    /// any comms backend has been elected, so it is registered directly by
    /// <see cref="GonogoAddon"/> alongside every other core Uplink rather than
    /// through a hook installed by <see cref="CommsCoreUplink"/>. The
    /// SilenceTracker's officially-lost RECKONING (state, deadlines,
    /// predicted reacquisition) is a comms-owned model's opinion, not a fact
    /// stock KSP hands you, and is registered separately by
    /// <see cref="SilenceTracking.FleetSilenceChannels"/> from inside
    /// <see cref="CommsCoreUplink.Register"/>. See
    /// <see cref="Sitrep.Contract.FleetVesselContact"/>'s doc comment for the
    /// full split.</para>
    ///
    /// <para>Subscription-gated on the <c>fleet.</c> prefix: the whole fleet
    /// read is skipped when no client subscribes to any fleet topic. Each
    /// vessel's LINK is the exception, read by a second, ungated capture
    /// (<see cref="CaptureLinksOnMain"/>) every tick. An outage that starts or
    /// ends with nobody watching has to be on record for the first client to
    /// subscribe, whose catch-up is graded by it; a gated read would hand that
    /// client a pre-outage sample marked fresh for a craft out of contact. It
    /// costs one connectivity flag per vessel per tick, no path walk and no
    /// orbit build, and the engine then keeps link state for every vessel
    /// rather than only while a fleet topic is subscribed.</para>
    ///
    /// <para><b>Not an Uplink discovered by attribute scan, deliberately.</b>
    /// It implements <see cref="ISitrepUplink"/> so <see cref="GonogoAddon"/>
    /// can register it directly (mirroring
    /// <c>CommandCentres.CommandCentreDelayUplink</c>), but carries no
    /// <c>[SitrepUplink]</c> attribute: an Uplink earns an Availability by
    /// being separately installable, and <c>fleet</c> is not, it is a SCOPE,
    /// the same vessel domain seen across every craft instead of the active
    /// one, and ships inside <c>Gonogo.dll</c> unconditionally.</para>
    /// </summary>
    public sealed class FleetChannels : ISitrepUplink
    {
        /// <summary>The per-vessel topic suffix, alongside the engine's own `.contact`.</summary>
        private const string ResourcesSuffix = ".resources";

        /// <summary>
        /// Resource rows read per second across the fleet. This is the one
        /// per-vessel read here that walks a craft's PARTS rather than a couple
        /// of scalars, so it is the one that would show a fleet outgrowing the
        /// per-vessel subscription gate: a runaway here means the gate stopped
        /// gating, not that the fleet got big.
        /// </summary>
        private static readonly PerfBudget FleetResourceBudget = new PerfBudget(
            "FleetChannels resource rows read", threshold: 2000, windowSec: 1.0, unit: "rows");

        private IDynamicChannelSource? _orbitSource;
        private IUplinkHost? _host;

        /// <summary>
        /// The same host, when it can also take a route's hops rather than only
        /// the scalar <see cref="IUplinkHost.SetVesselDelay"/> carries. Null
        /// leaves the ledger on its scalar tier, which is the correct reading
        /// for a host that has no journey ledger at all.
        /// </summary>
        private IVesselJourneyWriter? _journeyWriter;

        /// <summary>
        /// Every vessel's retained route, for its breaks. Main-thread only,
        /// written by the gated capture, so a route is compared only on the
        /// ticks the fleet read runs, which are the ticks it writes the delays
        /// those breaks act on.
        /// </summary>
        private readonly FleetPathBreaks _pathBreaks = new FleetPathBreaks();

        // Main-thread-only bookkeeping: the last UT each vessel was observed
        // connected. Trivial derived state (no hysteresis, no model), so it
        // lives here rather than needing anything like SilenceTracker. Written
        // by both main-thread captures: the ungated CaptureLinksOnMain keeps it
        // true while nobody is watching, and CaptureOnMain, which runs first in
        // a tick, writes it too so its own report is not a tick behind. The
        // cross-thread snapshot each FleetVesselCapture carries is what
        // HandleOnCourier (Courier thread) actually reads.
        private readonly Dictionary<string, double> _lastContactUt = new Dictionary<string, double>();

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "fleet",
            Version = "1.0.0",
            // No static channels: every topic is materialized per vessel guid
            // out of the dynamic namespace registered below.
            Channels = new List<ChannelDeclaration>(),
        };

        /// <summary>Mandatory health self-report: a plain channel uplink is Healthy once registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _host = host;
            _journeyWriter = host as IVesselJourneyWriter;
            _orbitSource = host.RegisterDynamicNamespace(ChannelEngine.FleetNodePrefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, ChannelEngine.FleetNodePrefix);
            // Registered after the gated source, whose handle has to report a
            // link after its delay and before its publishes on a tick it runs.
            host.AddSampledSource(CaptureLinksOnMain, HandleLinksOnCourier);
        }

        /// <summary>
        /// MAIN-THREAD, UNGATED: every vessel's connectivity, and the
        /// last-contact bookkeeping that follows from it, so both stay true
        /// while nobody subscribes to a fleet topic.
        /// </summary>
        internal object? CaptureLinksOnMain(KspSnapshot? snapshot)
        {
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }

            var ut = snapshot != null ? snapshot.Ut : 0.0;
            var config = CommsCoreUplink.SignalDelayConfig;
            var links = new List<VesselLinkCapture>(all.Count);
            foreach (var vessel in all)
            {
                if (vessel == null)
                {
                    continue;
                }
                var id = vessel.id.ToString();
                var connected = FleetCommsReader.ReadConnected(vessel, config);
                if (connected)
                {
                    _lastContactUt[id] = ut;
                }
                links.Add(new VesselLinkCapture { Id = id, Connected = connected });
            }
            return links;
        }

        /// <summary>
        /// COURIER-THREAD: report each vessel's link. On a tick the gated
        /// handle also ran this repeats what it already reported and changes
        /// nothing.
        /// </summary>
        internal void HandleLinksOnCourier(object? captured)
        {
            if (captured is not List<VesselLinkCapture> links)
            {
                return;
            }
            foreach (var link in links)
            {
                _host?.SetVesselConnectivity(link.Id, link.Connected);
            }
        }

        /// <summary>MAIN-THREAD capture: per vessel, its guid + routed delay + orbit-element dict + last-contact bookkeeping.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }

            var ut = snapshot != null ? snapshot.Ut : 0.0;
            var config = CommsCoreUplink.SignalDelayConfig;
            var captures = new List<FleetVesselCapture>(all.Count);
            var breaks = BreakObservation(all, config);
            var present = new HashSet<string>();
            foreach (var vessel in all)
            {
                if (vessel == null)
                {
                    continue;
                }
                var (oneWay, connected) = FleetCommsReader.ReadVessel(vessel, config);
                var journey = FleetCommsReader.ReadVesselJourney(vessel, config);
                var orbit = vessel.orbitDriver != null ? KspHost.BuildOrbit(vessel.orbitDriver.orbit) : null;
                var id = vessel.id.ToString();
                present.Add(id);
                if (connected)
                {
                    _lastContactUt[id] = ut;
                }
                PathBreak? pathBreak = null;
                if (breaks.Index != null)
                {
                    var index = breaks.Index;
                    pathBreak = _pathBreaks.Observe(
                        id,
                        vessel.connection?.Comm,
                        FleetCommsReader.ReadVesselRoute(vessel, config),
                        node => FleetCommsReader.NameNode(index, node),
                        config.LightSpeedScale,
                        ut,
                        breaks.RouteBetween);
                }
                captures.Add(new FleetVesselCapture
                {
                    Id = id,
                    OneWaySeconds = oneWay,
                    Journey = journey,
                    PathBreak = pathBreak,
                    Connected = connected,
                    Orbit = orbit,
                    LastContactUt = _lastContactUt.TryGetValue(id, out var last) ? (double?)last : null,
                    // Gated PER VESSEL, not with the rest of the fleet read.
                    // Walking one craft's parts is cheap; walking every craft's
                    // parts every tick because something subscribed to one
                    // craft's contact topic is not, and the whole-namespace gate
                    // on this source cannot tell those apart. A tracker watching
                    // one probe pays for one probe.
                    Resources = ReadResources(vessel, id, ut),
                });
            }
            _pathBreaks.Retain(present);
            return new FleetCapture { Ut = ut, Vessels = captures };
        }

        /// <summary>
        /// What this pass needs to observe breaks, or no index when it should
        /// not: delay off, no comms model, no host that can record a break, or
        /// no elected backend to tell a reroute from a destruction. Each of
        /// those forgets every retained route, because the next comparison
        /// would span a situation it does not belong to.
        ///
        /// <para>One walk of the vessel list names every node the pass can
        /// meet, so no hop costs a scan of its own.</para>
        /// </summary>
        private (VesselNodeIndex? Index, System.Func<object?, object?, IReadOnlyList<CommsRouteHop>?>? RouteBetween) BreakObservation(
            List<Vessel> all,
            SignalDelayConfig config)
        {
            var backend = _host != null ? CommsElection.Elected(_host.Kernel) : null;
            if (_journeyWriter == null || backend == null || config == null
                || !config.Enabled || config.CutForNoCommsModel)
            {
                _pathBreaks.Forget();
                return (null, null);
            }
            return (VesselNodeIndex.From(all), backend.RouteBetween);
        }

        /// <summary>
        /// MAIN-THREAD: one vessel's tank levels, or null when nobody is
        /// watching this craft's resources.
        ///
        /// <para>The per-vessel subscription check is the point. The whole
        /// fleet read is already gated on the <c>fleet.</c> prefix, but that
        /// gate opens as soon as ANY fleet topic has a subscriber, so a tracker
        /// watching one probe's contact state would otherwise pay for a
        /// part-walk of every craft in the save on every tick. That is fine at
        /// four vessels and not fine at forty.</para>
        ///
        /// <para>Loaded craft read their live parts; unloaded ones read the
        /// <c>ProtoPartSnapshot</c>s, so a craft parked round the far side of
        /// the Mun still reports what is in its tanks rather than nothing.</para>
        /// </summary>
        private Dictionary<string, object?>? ReadResources(Vessel vessel, string id, double ut)
        {
            if (_host == null || !_host.IsAnyTopicSubscribed(ChannelEngine.FleetNodePrefix + id + ResourcesSuffix))
            {
                return null;
            }

            var resources = new Dictionary<string, object?>();
            try
            {
                if (vessel.loaded && vessel.parts != null)
                {
                    foreach (var part in vessel.parts)
                    {
                        if (part?.Resources == null) continue;
                        foreach (PartResource res in part.Resources)
                        {
                            if (res == null) continue;
                            FleetVesselResourcesBuilder.Add(resources, res.resourceName, res.amount, res.maxAmount);
                        }
                    }
                }
                else
                {
                    var protoParts = vessel.protoVessel?.protoPartSnapshots;
                    if (protoParts != null)
                    {
                        foreach (var pps in protoParts)
                        {
                            if (pps?.resources == null) continue;
                            foreach (var res in pps.resources)
                            {
                                if (res == null) continue;
                                FleetVesselResourcesBuilder.Add(resources, res.resourceName, res.amount, res.maxAmount);
                            }
                        }
                    }
                }
            }
            catch (System.Exception ex)
            {
                // Fail soft and report NOTHING rather than a partial tank list:
                // half a craft's resources read as a craft with half the fuel.
                Debug.LogWarning("[Gonogo] fleet resource read failed for vessel " + id + ", omitting: " + ex.Message);
                return null;
            }

            FleetResourceBudget.Record(resources.Count, ut);
            return FleetVesselResourcesBuilder.Build(resources);
        }

        /// <summary>COURIER-THREAD handle: set each vessel's node delay + emit its orbit/delay/contact.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not FleetCapture cap || _orbitSource == null)
            {
                return;
            }
            foreach (var v in cap.Vessels)
            {
                if (v.OneWaySeconds.HasValue)
                {
                    _host?.SetVesselDelay(v.Id, v.OneWaySeconds.Value);
                    // Written second: SetVesselDelay's plain scalar retires
                    // any journey already held for this node, so the hop
                    // breakdown has to land after it to stick.
                    if (v.Journey != null)
                    {
                        _journeyWriter?.SetVesselJourney(v.Id, v.Journey);
                    }
                }
                // Handles run before the tick's clock advance, so the break is
                // on the books before any delivery it dooms can fire.
                if (v.PathBreak != null)
                {
                    _journeyWriter?.SetVesselPathBreak(v.Id, v.PathBreak.Value);
                }
                // Per-subject freeze (Plan 2b): this vessel freezes on its own link.
                // Reported here as well as by HandleLinksOnCourier because the
                // order matters on a disconnect tick: after the delay, so the last
                // connected light-time is kept, and before the publishes, so they
                // freeze.
                _host?.SetVesselConnectivity(v.Id, v.Connected);
                if (v.Orbit != null)
                {
                    _orbitSource.Publisher(v.Id + ".orbit").Publish(v.Orbit, cap.Ut);
                }
                // Plan 2c: surface the per-vessel delay + connectivity the capture
                // already holds as a display-only fleet.<guid>.delay field (same
                // Delayed namespace as .orbit, so it too arrives light-time-late).
                _orbitSource.Publisher(v.Id + ".delay")
                    .Publish(FleetVesselLinkBuilder.Build(v.OneWaySeconds, v.Connected), cap.Ut);
                // fleet.<guid>.contact: the core connected/lastContactUt facts.
                // Freeze-exempt (ChannelEngine.ContactMetaSuffix), the disconnect
                // edge must escape the reveal-gate freeze or it could never be
                // reported at all.
                _orbitSource.Publisher(v.Id + ChannelEngine.ContactMetaSuffix)
                    .Publish(FleetVesselContactBuilder.Build(v.Connected, v.LastContactUt), cap.Ut);
                // Null means nobody asked for this craft's tanks this tick (see
                // ReadResources), which is different from a craft with none: that
                // is an empty map and still publishes.
                if (v.Resources != null)
                {
                    _orbitSource.Publisher(v.Id + ResourcesSuffix).Publish(v.Resources, cap.Ut);
                }
            }
        }

        private sealed class FleetCapture
        {
            public double Ut { get; set; }
            public List<FleetVesselCapture> Vessels { get; set; } = new List<FleetVesselCapture>();
        }

        private sealed class VesselLinkCapture
        {
            public string Id { get; set; } = string.Empty;
            public bool Connected { get; set; }
        }

        private sealed class FleetVesselCapture
        {
            public string Id { get; set; } = string.Empty;
            public double? OneWaySeconds { get; set; }
            public Journey? Journey { get; set; }
            public PathBreak? PathBreak { get; set; }
            public bool Connected { get; set; }
            public object? Orbit { get; set; }
            public double? LastContactUt { get; set; }
            public Dictionary<string, object?>? Resources { get; set; }
        }
    }
}
