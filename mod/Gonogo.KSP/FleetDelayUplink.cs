using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Fleet delay uplink (Plan 2): registers the <c>fleet.&lt;guid&gt;.*</c>
    /// dynamic namespace and, each fleet-capture tick, reads every
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
    /// <para>Subscription-gated on the <c>fleet.</c> prefix: the whole fleet
    /// read is skipped when no client subscribes to any fleet topic. This is a
    /// DISPLAY delay applied by the ledger (not the reveal gate), so gating is
    /// correct: freeze stays global in Plan 2.</para>
    /// </summary>
    public sealed class FleetDelayUplink : ISitrepUplink
    {
        private IDynamicChannelSource? _orbitSource;
        private IUplinkHost? _host;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "fleet-delay",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

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

        /// <summary>MAIN-THREAD capture: per vessel, its guid + routed delay + orbit-element dict.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }

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
                captures.Add(new FleetVesselCapture
                {
                    Id = vessel.id.ToString(),
                    OneWaySeconds = oneWay,
                    Connected = connected,
                    Orbit = orbit,
                });
            }
            return new FleetCapture { Ut = snapshot != null ? snapshot.Ut : 0.0, Vessels = captures };
        }

        /// <summary>COURIER-THREAD handle: set each vessel's node delay + emit its orbit.</summary>
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
            }
        }

        public UplinkHealth Health() => UplinkHealth.Healthy;

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
        }
    }
}
