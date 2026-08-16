using System.Collections.Generic;
using Gonogo.KSP.SilenceTracking;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
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
    ///
    /// <para><b>The officially-lost capture below is deliberately NOT gated
    /// the same way.</b> <see cref="SilenceTracker"/>'s state machine has to
    /// advance every tick regardless of whether any client is watching -
    /// otherwise whether a vessel is declared lost would depend on which
    /// browser tab happens to be open, exactly the flaw
    /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c> and
    /// <see cref="CurrencyEventUplink.ArmSourceNode"/>'s own doc comment both
    /// warn about. See <see cref="CaptureSilenceOnMain"/>.</para>
    /// </summary>
    public sealed class FleetDelayUplink : ISitrepUplink
    {
        /// <summary>
        /// Soft cap on the always-run silence capture, sized generously above
        /// a realistic career-scale fleet (a few hundred vessels) sampled at
        /// the ~1 UT-second cadence <c>GonogoAddon.SampleIntervalUt</c> uses
        /// at 1x warp; see <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>'s
        /// accepted risk #3 (no budget existed on this path before this work).
        /// </summary>
        private static readonly PerfBudget SilenceCaptureBudget = new PerfBudget(
            "FleetDelayUplink silence capture", threshold: 2000, windowSec: 1.0, unit: "vessels");

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
            SilenceTracking.SilenceGeometrySink.Bind(host.Kernel);
            _orbitSource = host.RegisterDynamicNamespace(ChannelEngine.FleetNodePrefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, ChannelEngine.FleetNodePrefix);

            // Ungated: no subscriptionTopicPrefixes argument, see this
            // class's own doc comment above.
            host.AddSampledSource(CaptureSilenceOnMain, HandleSilenceOnCourier);
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

        /// <summary>
        /// MAIN-THREAD, UNGATED capture: reads every <c>FlightGlobals</c>
        /// vessel's live connectivity/orbit/situation, advances
        /// <see cref="SilenceTracker.Tick"/> (mutating the CURRENT save's
        /// tracker via <see cref="SilenceTrackerSink"/>), and returns an
        /// immutable snapshot of the touched vessels for the Courier thread
        /// to publish.
        ///
        /// <para>Snapshots rather than handing out the tracker's own
        /// <see cref="VesselContactState"/> instances: those are reused and
        /// mutated again in place on the VERY NEXT main-thread tick, which
        /// can run before the Courier thread has processed this one, so a
        /// raw reference crossing the thread boundary here could be read
        /// mid-mutation.</para>
        ///
        /// <para>No tracker bound (e.g. main menu, between scene loads)
        /// simply produces nothing this tick - see
        /// <see cref="SilenceTrackerSink"/>'s own doc comment for why a
        /// quickload/revert cannot leave this pointing at stale state.</para>
        /// </summary>
        internal object? CaptureSilenceOnMain(KspSnapshot? snapshot)
        {
            var tracker = SilenceTrackerSink.Current;
            if (tracker == null)
            {
                return null;
            }

            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }

            var ut = snapshot?.Ut ?? Planetarium.GetUniversalTime();
            var config = CommsCoreUplink.SignalDelayConfig;
            var present = new List<SilenceSample>(all.Count);
            foreach (var vessel in all)
            {
                if (vessel == null)
                {
                    continue;
                }
                var (_, connected) = FleetCommsReader.ReadVessel(vessel, config);
                var orbit = BuildOrbitElements(vessel);
                var landedOrSplashed = vessel.situation == Vessel.Situations.LANDED || vessel.situation == Vessel.Situations.SPLASHED;
                present.Add(new SilenceSample(
                    vessel.id.ToString(),
                    connected,
                    orbit,
                    landedOrSplashed,
                    ReferenceBodyIndexOf(vessel)));
            }

            SilenceCaptureBudget.Record(present.Count, ut);

            var touched = tracker.Tick(present, ut);
            var snapshots = new List<SilenceContactSnapshot>(touched.Count);
            foreach (var state in touched)
            {
                snapshots.Add(new SilenceContactSnapshot
                {
                    VesselId = state.VesselId,
                    Connected = state.Connected,
                    State = state.State,
                    LastContactUt = state.LastContactUt,
                    SilenceSinceUt = state.SilenceSinceUt,
                    DeadlineUt = state.DeadlineUt,
                    DeadlineBasis = state.DeadlineBasis,
                    PredictedReacquisitionUt = state.PredictedReacquisitionUt,
                });
            }

            return new SilenceCapture { Ut = ut, Vessels = snapshots };
        }

        /// <summary>
        /// COURIER-THREAD handle: publish each touched vessel's
        /// <c>fleet.&lt;guid&gt;.contact</c>. This channel shares the Delayed
        /// fleet namespace but is FREEZE-EXEMPT in the engine (see
        /// <see cref="ChannelEngine.ContactMetaSuffix"/>, which the suffix here
        /// must match): everything it has to say is said while the vessel is
        /// dark, so a lane frozen by that same silence would carry none of it.
        /// </summary>
        internal void HandleSilenceOnCourier(object? captured)
        {
            if (captured is not SilenceCapture cap || _orbitSource == null)
            {
                return;
            }
            foreach (var v in cap.Vessels)
            {
                _orbitSource.Publisher(v.VesselId + ChannelEngine.ContactMetaSuffix).Publish(
                    FleetVesselContactBuilder.Build(v.Connected, v.State.ToString(), v.LastContactUt, v.SilenceSinceUt, v.DeadlineUt, v.DeadlineBasis, v.PredictedReacquisitionUt),
                    cap.Ut);
            }
        }

        /// <summary>
        /// The FULL element set, matching <c>KspHost</c>'s <c>vessel.orbit</c>
        /// extraction field for field.
        ///
        /// <para>These used to be sma/ecc/mu with the orientation and phase
        /// zeroed, on the reasoning that the orbital-period deadline policy
        /// read nothing else. That was true of that policy and false of the
        /// predictor: zeroed inc/lan/argPe/meanAnomaly propagate an equatorial
        /// orbit at an arbitrary phase, so every occultation it found would be
        /// for a craft that is not where the game has it. A policy reading
        /// fewer fields costs nothing; a policy reading fabricated ones is
        /// worse than no policy.</para>
        /// </summary>
        private static OrbitElements? BuildOrbitElements(Vessel vessel)
        {
            var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
            if (orbit == null || orbit.referenceBody == null)
            {
                return null;
            }
            return new OrbitElements(
                sma: orbit.semiMajorAxis,
                ecc: orbit.eccentricity,
                inc: orbit.inclination,
                lan: orbit.LAN,
                argPe: orbit.argumentOfPeriapsis,
                meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
                epoch: orbit.epoch,
                mu: orbit.referenceBody.gravParameter);
        }

        /// <summary>
        /// Index into <c>FlightGlobals.Bodies</c> of the body the vessel's
        /// elements are relative to. The elements alone do not say, and a
        /// predictor cannot choose an occluder without it.
        /// </summary>
        private static int? ReferenceBodyIndexOf(Vessel vessel)
        {
            var body = vessel.orbitDriver != null && vessel.orbitDriver.orbit != null
                ? vessel.orbitDriver.orbit.referenceBody
                : null;
            if (body == null)
            {
                return null;
            }
            var index = FlightGlobals.Bodies.IndexOf(body);
            return index >= 0 ? index : (int?)null;
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

        private sealed class SilenceCapture
        {
            public double Ut { get; set; }
            public List<SilenceContactSnapshot> Vessels { get; set; } = new List<SilenceContactSnapshot>();
        }

        /// <summary>
        /// Cross-thread-safe snapshot of one vessel's <see cref="SilenceTracker"/>
        /// state for this tick; see <see cref="CaptureSilenceOnMain"/>'s doc
        /// comment for why this is not the tracker's own
        /// <see cref="VesselContactState"/>.
        /// </summary>
        private sealed class SilenceContactSnapshot
        {
            public string VesselId { get; set; } = string.Empty;
            public bool Connected { get; set; }
            public SilenceState State { get; set; }
            public double? LastContactUt { get; set; }
            public double? SilenceSinceUt { get; set; }
            public double? DeadlineUt { get; set; }
            public string? DeadlineBasis { get; set; }
            public double? PredictedReacquisitionUt { get; set; }
        }
    }
}
