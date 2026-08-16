using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

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
    /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c> and
    /// <see cref="Sitrep.Contract.FleetVesselContact"/>'s doc comment for the
    /// full split.</para>
    ///
    /// <para>Subscription-gated on the <c>fleet.</c> prefix: the whole fleet
    /// read is skipped when no client subscribes to any fleet topic. This is a
    /// DISPLAY delay applied by the ledger (not the reveal gate), so gating is
    /// correct: freeze stays global in Plan 2.</para>
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
        private IDynamicChannelSource? _orbitSource;
        private IUplinkHost? _host;

        // Main-thread-only bookkeeping: the last UT each vessel was observed
        // connected. Trivial derived state (no hysteresis, no model), so it
        // lives here rather than needing anything like SilenceTracker. Read
        // and mutated only from CaptureOnMain; the cross-thread snapshot each
        // FleetVesselCapture carries is what HandleOnCourier (Courier thread)
        // actually reads.
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
            _orbitSource = host.RegisterDynamicNamespace(ChannelEngine.FleetNodePrefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, ChannelEngine.FleetNodePrefix);
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
            foreach (var vessel in all)
            {
                if (vessel == null)
                {
                    continue;
                }
                var (oneWay, connected) = FleetCommsReader.ReadVessel(vessel, config);
                var orbit = vessel.orbitDriver != null ? KspHost.BuildOrbit(vessel.orbitDriver.orbit) : null;
                var id = vessel.id.ToString();
                if (connected)
                {
                    _lastContactUt[id] = ut;
                }
                captures.Add(new FleetVesselCapture
                {
                    Id = id,
                    OneWaySeconds = oneWay,
                    Connected = connected,
                    Orbit = orbit,
                    LastContactUt = _lastContactUt.TryGetValue(id, out var last) ? (double?)last : null,
                });
            }
            return new FleetCapture { Ut = ut, Vessels = captures };
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
                }
                // Per-subject freeze (Plan 2b): this vessel freezes on its own link.
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
            }
        }

        private sealed class FleetCapture
        {
            public double Ut { get; set; }
            public List<FleetVesselCapture> Vessels { get; set; } = new List<FleetVesselCapture>();
        }

        private sealed class FleetVesselCapture
        {
            public string Id { get; set; } = string.Empty;
            public double? OneWaySeconds { get; set; }
            public bool Connected { get; set; }
            public object? Orbit { get; set; }
            public double? LastContactUt { get; set; }
        }
    }
}
