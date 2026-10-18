using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>trackingStation.vessel.&lt;guid&gt;.*</c> dynamic namespace: each
    /// fleet-capture tick, reads every <c>FlightGlobals.Vessels</c> vessel's own
    /// routed signal delay (<see cref="FleetCommsReader"/>), sets the per-vessel
    /// node delay via <see cref="IUplinkHost.SetVesselDelay"/>, and emits the
    /// craft's link figures on <c>.link</c> and its tanks on <c>.resources</c>,
    /// each delayed by that craft's own signal delay.
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
    /// through a hook installed by <see cref="CommsCoreUplink"/>. Whether each
    /// command centre is in contact with a craft is not here: it is that
    /// centre's own knowledge, on its <c>trackingStation.catalog</c>.</para>
    ///
    /// <para>Subscription-gated on the namespace prefix: the whole fleet
    /// read is skipped when no client subscribes to any of its topics. Each
    /// vessel's link is the exception, read by a second, ungated capture
    /// (<see cref="CaptureLinksOnMain"/>) every tick. An outage that starts or
    /// ends with nobody watching has to be on record for the first client to
    /// subscribe, whose catch-up is graded by it; a gated read would hand that
    /// client a pre-outage sample marked fresh for a craft out of contact. It
    /// costs one connectivity flag per vessel per tick and no path walk, and
    /// the engine then keeps link state for every vessel rather than only
    /// while one of these topics is subscribed.</para>
    ///
    /// <para><b>Not an Uplink discovered by attribute scan, deliberately.</b>
    /// It implements <see cref="ISitrepUplink"/> so <see cref="GonogoAddon"/>
    /// can register it directly (mirroring
    /// <c>CommandCentres.CommandCentreDelayUplink</c>), but carries no
    /// <c>[SitrepUplink]</c> attribute: an Uplink earns an Availability by
    /// being separately installable, and <c>fleet</c> is not, it is a scope,
    /// the same vessel domain seen across every craft instead of the active
    /// one, and ships inside <c>Gonogo.dll</c> unconditionally.</para>
    /// </summary>
    public sealed class FleetChannels : ISitrepUplink
    {
        private const string LinkSuffix = ".link";
        private const string ResourcesSuffix = ".resources";

        /// <summary>
        /// Resource rows read per second across the fleet. This is the one
        /// per-vessel read here that walks a craft's parts rather than a couple
        /// of scalars, so it is the one that would show a fleet outgrowing the
        /// per-vessel subscription gate: a runaway here means the gate stopped
        /// gating, not that the fleet got big.
        /// </summary>
        private static readonly PerfBudget FleetResourceBudget = new PerfBudget(
            "FleetChannels resource rows read", threshold: 2000, windowSec: 1.0, unit: "rows");

        private IDynamicChannelSource? _vesselSource;
        private IUplinkHost? _host;

        /// <summary>
        /// The same host, when it can also take a route's hops rather than only
        /// the scalar <see cref="IUplinkHost.SetVesselDelay"/> carries. Null
        /// leaves the ledger on its scalar tier, which is the correct reading
        /// for a host that has no journey ledger at all.
        /// </summary>
        private IVesselJourneyWriter? _journeyWriter;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "fleet",
            Bundled = true,
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
            _vesselSource = host.RegisterDynamicNamespace(SystemViewProvider.VesselPrefix, new ChannelDeclaration
            {
                Kind = SampleKind.Continuous,
                Requires = Requirement.None,
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Keyed by the craft, so each records on that craft's own node
                // and reveals at its light-time.
                PerVesselNode = true,
            });
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, SystemViewProvider.VesselPrefix);
            // Registered after the gated source, whose handle has to report a
            // link after its delay and before its publishes on a tick it runs.
            host.AddSampledSource(CaptureLinksOnMain, HandleLinksOnCourier);
        }

        /// <summary>
        /// MAIN-THREAD, ungated: every vessel's connectivity, so it stays
        /// true while nobody subscribes to this namespace.
        /// </summary>
        internal object? CaptureLinksOnMain(KspSnapshot? snapshot)
        {
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }

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
            var present = new HashSet<string>(StringComparer.Ordinal);
            foreach (var link in links)
            {
                present.Add(link.Id);
                ReportLink(link.Id, link.Connected);
            }
            foreach (var id in new List<string>(_lastReportedLink.Keys))
            {
                if (!present.Contains(id))
                {
                    _lastReportedLink.Remove(id);
                }
            }
        }

        /* Courier-thread-only: the last link each vessel was reported at. The engine
           counts a vessel on the roster only on the tick it is told a link, so a link
           that cannot be read this tick is told again as the last reading, which is
           also what it stands at, and the craft is not taken for one that has left. */
        private readonly Dictionary<string, bool> _lastReportedLink = new Dictionary<string, bool>(StringComparer.Ordinal);

        private void ReportLink(string vesselId, bool? connected)
        {
            if (connected is { } read)
            {
                _lastReportedLink[vesselId] = read;
                _host?.SetVesselConnectivity(vesselId, read);
                return;
            }
            if (_lastReportedLink.TryGetValue(vesselId, out var lastRead))
            {
                _host?.SetVesselConnectivity(vesselId, lastRead);
            }
        }

        /// <summary>MAIN-THREAD capture: per vessel, its guid, routed delay and, when watched, its tanks.</summary>
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
            foreach (var vessel in all)
            {
                if (vessel == null)
                {
                    continue;
                }
                var (oneWay, connected) = FleetCommsReader.ReadVessel(vessel, config);
                var journey = FleetCommsReader.ReadVesselJourney(vessel, config);
                var id = vessel.id.ToString();
                captures.Add(new FleetVesselCapture
                {
                    Id = id,
                    OneWaySeconds = oneWay,
                    Journey = journey,
                    Connected = connected,
                    // Gated PER VESSEL, not with the rest of the fleet read.
                    // Walking one craft's parts is cheap; walking every craft's
                    // parts every tick because something subscribed to one
                    // craft's link topic is not, and the whole-namespace gate
                    // on this source cannot tell those apart. A tracker watching
                    // one probe pays for one probe.
                    Resources = ReadResources(vessel, id, ut),
                });
            }
            return new FleetCapture { Ut = ut, Vessels = captures };
        }

        /// <summary>
        /// MAIN-THREAD: one vessel's tank levels, or null when nobody is
        /// watching this craft's resources.
        ///
        /// <para>The per-vessel subscription check is the point. The whole
        /// fleet read is already gated on the namespace prefix, but that
        /// gate opens as soon as any of its topics has a subscriber, so a tracker
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
            if (_host == null || !_host.IsAnyTopicSubscribed(SystemViewProvider.VesselPrefix + id + ResourcesSuffix))
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
                            TrackingStationVesselResourcesBuilder.Add(resources, res.resourceName, res.amount, res.maxAmount);
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
                                TrackingStationVesselResourcesBuilder.Add(resources, res.resourceName, res.amount, res.maxAmount);
                            }
                        }
                    }
                }
            }
            catch (System.Exception ex)
            {
                // Fail soft and report NOTHING rather than a partial tank list:
                // half a craft's resources read as a craft with half the fuel.
                GonogoLog.WarnLimited("fleet resource read failed for vessel " + id + ", omitting", ex);
                return null;
            }

            FleetResourceBudget.Record(resources.Count, ut);
            return TrackingStationVesselResourcesBuilder.Build(resources);
        }

        /// <summary>COURIER-THREAD handle: set each vessel's node delay and emit its link and tanks.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not FleetCapture cap || _vesselSource == null)
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
                // Per-subject freeze: this vessel freezes on its own link.
                // Reported here as well as by HandleLinksOnCourier because the
                // order matters on a disconnect tick: after the delay, so the last
                // connected light-time is kept, and before the publishes, so they
                // freeze.
                ReportLink(v.Id, v.Connected);
                _vesselSource.Publisher(v.Id + LinkSuffix)
                    .Publish(TrackingStationVesselLinkBuilder.Build(v.OneWaySeconds, v.Connected), cap.Ut);
                // Null means nobody asked for this craft's tanks this tick (see
                // ReadResources), which is different from a craft with none: that
                // is an empty map and still publishes.
                if (v.Resources != null)
                {
                    _vesselSource.Publisher(v.Id + ResourcesSuffix).Publish(v.Resources, cap.Ut);
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
            public bool? Connected { get; set; }
        }

        private sealed class FleetVesselCapture
        {
            public string Id { get; set; } = string.Empty;
            public double? OneWaySeconds { get; set; }
            public Journey? Journey { get; set; }
            public bool? Connected { get; set; }
            public Dictionary<string, object?>? Resources { get; set; }
        }
    }
}
