using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using UnityEngine;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// The <c>silence.&lt;guid&gt;.*</c> dynamic namespace: the SilenceTracker's
    /// officially-lost reckoning for every fleet vessel (link state, when it
    /// went quiet, its deadline, whether it has been declared Lost). A
    /// COMMS-OWNED model's opinion, not a fact stock KSP hands you, so it is
    /// registered from <see cref="CommsCoreUplink.Register"/> rather than
    /// alongside the always-on core <see cref="FleetChannels"/>. See
    /// <see cref="Sitrep.Contract.FleetVesselContact"/>'s doc comment for the
    /// full core/comms split and
    /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c> for the
    /// feature.
    ///
    /// <para><b>Ungated, deliberately, unlike <see cref="FleetChannels"/>.</b>
    /// <see cref="SilenceTracker"/>'s state machine has to advance every tick
    /// regardless of whether any client is watching, otherwise whether a
    /// vessel is declared lost would depend on which browser tab happens to be
    /// open. See <see cref="CaptureSilenceOnMain"/>.</para>
    /// </summary>
    public sealed class FleetSilenceChannels
    {
        /// <summary>
        /// Soft cap on the always-run silence capture, sized generously above
        /// a realistic career-scale fleet (a few hundred vessels) sampled at
        /// the ~1 UT-second cadence <c>GonogoAddon.SampleIntervalUt</c> uses
        /// at 1x warp; see <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>'s
        /// accepted risk #3 (no budget existed on this path before this work).
        /// </summary>
        private static readonly PerfBudget SilenceCaptureBudget = new PerfBudget(
            "FleetSilenceChannels silence capture", threshold: 2000, windowSec: 1.0, unit: "vessels");

        private IDynamicChannelSource? _silenceSource;

        /// <summary>
        /// Called from <see cref="CommsCoreUplink.Register"/>, on that uplink's
        /// registration pass, so everything here is owned by the <c>comms</c>
        /// uplink for availability and health purposes.
        /// </summary>
        public void RegisterInto(IUplinkHost host)
        {
            SilenceGeometrySink.Bind(host.Kernel);
            _silenceSource = host.RegisterDynamicNamespace(ChannelEngine.SilenceEventPrefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // silence.<guid>.<field> is this vessel's own reckoning, so it
                // records on that craft's node. Declared here rather than known
                // to the engine.
                PerVesselNode = true,
            });

            // Ungated: no subscriptionTopicPrefixes argument, see this
            // class's own doc comment above.
            host.AddSampledSource(CaptureSilenceOnMain, HandleSilenceOnCourier);
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
                SilenceTrace.NoTracker();
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
            SilenceTrace.Captured(present.Count, ut);

            var touched = tracker.Tick(present, ut);
            var snapshots = new List<SilenceContactSnapshot>(touched.Count);
            foreach (var state in touched)
            {
                snapshots.Add(new SilenceContactSnapshot
                {
                    VesselId = state.VesselId,
                    State = state.State,
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
        /// <c>silence.&lt;guid&gt;.state</c>. This channel rides its own Delayed
        /// namespace but is FREEZE-EXEMPT in the engine (see
        /// <see cref="ChannelEngine.SilenceStateSuffix"/>, which the suffix here
        /// must match): everything it has to say is said while the vessel is
        /// dark, so a lane frozen by that same silence would carry none of it.
        /// </summary>
        internal void HandleSilenceOnCourier(object? captured)
        {
            if (captured is not SilenceCapture cap || _silenceSource == null)
            {
                SilenceTrace.NotPublished(captured, _silenceSource == null);
                return;
            }
            SilenceTrace.Publishing(cap.Vessels.Count);
            foreach (var v in cap.Vessels)
            {
                _silenceSource.Publisher(v.VesselId + ChannelEngine.SilenceStateSuffix).Publish(
                    FleetVesselSilenceBuilder.Build(v.State.ToString(), v.SilenceSinceUt, v.DeadlineUt, v.DeadlineBasis, v.PredictedReacquisitionUt),
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
            return OrbitElements.FromKspDegrees(
                sma: orbit.semiMajorAxis,
                ecc: orbit.eccentricity,
                incDegrees: orbit.inclination,
                lanDegrees: orbit.LAN,
                argPeDegrees: orbit.argumentOfPeriapsis,
                meanAnomalyAtEpochRadians: orbit.meanAnomalyAtEpoch,
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
            public SilenceState State { get; set; }
            public double? SilenceSinceUt { get; set; }
            public double? DeadlineUt { get; set; }
            public string? DeadlineBasis { get; set; }
            public double? PredictedReacquisitionUt { get; set; }
        }
    }
}
