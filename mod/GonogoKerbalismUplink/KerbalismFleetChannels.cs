using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// The <c>kerbalism.vessel.&lt;guid&gt;.*</c> namespace: life support and
    /// crew survival for craft OTHER than the one being flown.
    ///
    /// <para><b>Why this can exist at all.</b> Kerbalism simulates the whole
    /// fleet, not the active craft: its resource cache walks proto part
    /// snapshots for an unloaded vessel, its habitat info has an unloaded mode,
    /// and its per-kerbal rule accumulators advance on each craft's own
    /// background turn. So the single-vessel scope the active-vessel channels
    /// had was our capture's, never Kerbalism's.</para>
    ///
    /// <para><b>Registered by <see cref="KerbalismUplink"/>, owned by it.</b>
    /// Same arrangement as <c>FleetSilenceChannels</c> inside the comms uplink:
    /// availability and health belong to the Uplink that registers it, this
    /// class only holds the namespace and its capture.</para>
    ///
    /// <para><b>Gated per craft, not per namespace</b>
    /// (<see cref="KerbalismFleetScope"/>): a namespace-wide gate would let one
    /// watched probe drag every vessel in the save through habitat, resource and
    /// rule reflection on every tick.</para>
    /// </summary>
    public sealed class KerbalismFleetChannels
    {
        /// <summary>
        /// Per-craft Kerbalism reads per second. A career-scale save is a few
        /// hundred craft and the sample cadence is ~1 UT-second at 1x, but the
        /// gate means the realistic steady state is the handful a dashboard
        /// actually shows, so this is set to catch the gate FAILING rather than
        /// to bound normal use: a namespace-wide gate on a large save would
        /// breach it immediately.
        /// </summary>
        private static readonly PerfBudget FleetCaptureBudget = new PerfBudget(
            "KerbalismFleetChannels per-vessel capture", threshold: 500, windowSec: 1.0, unit: "vessels");

        private readonly KerbalismReflection _k;
        private readonly Func<Vessel, double, KerbalismUplink.KerbalismCaptured?> _captureVessel;

        private IDynamicChannelSource? _source;
        private IUplinkHost? _host;

        internal KerbalismFleetChannels(
            KerbalismReflection k,
            Func<Vessel, double, KerbalismUplink.KerbalismCaptured?> captureVessel)
        {
            _k = k;
            _captureVessel = captureVessel;
        }

        public void RegisterInto(IUplinkHost host)
        {
            _host = host;
            _source = host.RegisterDynamicNamespace(KerbalismFleetScope.Prefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Each craft's oxygen arrives at ITS light-time. Without this the
                // whole namespace records on the main node and a Munar base's
                // life support would reveal at the delay of whatever craft the
                // player is flying, silently.
                PerVesselNode = true,
            });
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, KerbalismFleetScope.Prefix);
        }

        /// <summary>MAIN-THREAD capture: one bundle per WATCHED craft, nothing for the rest.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var all = FlightGlobals.Vessels;
            if (all == null || _host == null || !_k.IsAvailable)
            {
                return null;
            }

            var ut = snapshot?.Ut ?? 0.0;
            var captures = new List<VesselCapture>();
            foreach (var vessel in all)
            {
                if (vessel == null)
                {
                    continue;
                }
                var id = vessel.id.ToString();
                if (!_host.IsAnyTopicSubscribed(KerbalismFleetScope.TopicPrefixFor(id)))
                {
                    continue;
                }
                // Debris, a rescue-contract craft and a dead EVA kerbal are not
                // simulated by Kerbalism, so their habitat and resource values
                // are whatever they were left at. Publishing those would report
                // a frozen state as a live one.
                if (_k.IsSimulated(vessel) != true)
                {
                    continue;
                }
                var captured = _captureVessel(vessel, ut);
                if (captured == null)
                {
                    continue;
                }
                captures.Add(new VesselCapture { Id = id, Captured = captured });
            }

            FleetCaptureBudget.Record(captures.Count, ut);
            return captures.Count == 0 ? null : new FleetCapture { Ut = ut, Vessels = captures };
        }

        /// <summary>COURIER-THREAD handle: publish each craft's payloads. No KSP access.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not FleetCapture cap || _source == null)
            {
                return;
            }
            foreach (var v in cap.Vessels)
            {
                var c = v.Captured;
                _source.Publisher(KerbalismFleetScope.LifeSupportSubTopic(v.Id)).Publish(
                    KerbalismCapture.BuildLifeSupport(
                        c.Snapshot, c.Processes, c.Snapshot.Rates, c.RuleEnvModifiers, c.AsOfUt),
                    cap.Ut);
                _source.Publisher(KerbalismFleetScope.CrewSubTopic(v.Id)).Publish(
                    KerbalismCapture.BuildCrew(c.Crew, c.RuleConstants, c.AsOfUt, c.DeathClocks()),
                    cap.Ut);
            }
        }

        private sealed class FleetCapture
        {
            public double Ut;
            public List<VesselCapture> Vessels = new List<VesselCapture>();
        }

        private sealed class VesselCapture
        {
            public string Id = string.Empty;
            public KerbalismUplink.KerbalismCaptured Captured = null!;
        }
    }
}
