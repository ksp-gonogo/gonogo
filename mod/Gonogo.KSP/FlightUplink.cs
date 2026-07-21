using System;
using System.Collections.Generic;
using KSP.UI.Screens;
using KSP.UI.Screens.SpaceCenter.MissionSummaryDialog;
using Sitrep.Contract;
using Sitrep.Host.Crash;
using Sitrep.Host.Flight;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The flight-lifecycle producer — hooks KSP's crash/recovery GameEvents
    /// internally and translates them into the clean <c>flight.*</c> contract
    /// (see <c>Sitrep.Contract.Flight.cs</c>'s doc comment for the full
    /// design). Retires the client-side <c>FlightDetector</c> heuristic.
    ///
    /// <para>Everything that a per-tick vessel-id comparison CAN classify on
    /// its own — a genuine launch, a revert/quickload, an operator switching
    /// active-vessel focus — lives in the KSP-free
    /// <see cref="FlightLifecycleSampler"/>, registered as an
    /// <see cref="ISnapshotSampler"/> (see that class's own doc comment for
    /// why revert needs no GameEvent hook at all). Only the two end reasons a
    /// sampler cannot distinguish — crashed/destroyed vs. recovered — are
    /// hooked here, mirroring <see cref="CrashUplink"/>/<see cref="RecoveryUplink"/>'s
    /// exact GameEvents and dedupe/filter discipline, independently (zero
    /// coupling to either uplink — see the contract file's "crash/recovery
    /// stayed separate" note for why).</para>
    /// </summary>
    [SitrepUplink("flight")]
    public sealed class FlightUplink : ISitrepUplink
    {
        // Mirrors CrashUplink's DedupWindowUt: a single death can raise
        // onCrash/onCrashSplashdown AND onVesselWillDestroy within the same
        // physics frame.
        private const double DedupWindowUt = 2.0;

        private readonly Dictionary<string, double> _lastPublishedEndUt = new Dictionary<string, double>();
        private FlightLifecycleSampler? _sampler;
        private bool _subscribed;

        private static ChannelDeclaration EventChannel(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delay = DelayRole.Delayed,
            Delivery = Delivery.ReliableOrdered,
            Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
        };

        private static ChannelDeclaration ValueChannel(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delay = DelayRole.Delayed,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "flight",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                ValueChannel(FlightTopics.CurrentTopic),
                EventChannel(FlightTopics.StartedTopic),
                EventChannel(FlightTopics.EndedTopic),
                EventChannel(FlightTopics.VesselChangedTopic),
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _sampler = new FlightLifecycleSampler(
                host.Publisher(FlightTopics.CurrentTopic),
                host.Publisher(FlightTopics.StartedTopic),
                host.Publisher(FlightTopics.EndedTopic),
                host.Publisher(FlightTopics.VesselChangedTopic));
            host.AddSampler(_sampler);

            HookGameEvents();
        }

        private void HookGameEvents()
        {
            if (_subscribed)
            {
                return;
            }
            _subscribed = true;

            GameEvents.onCrash.Add(OnCrash);
            GameEvents.onCrashSplashdown.Add(OnCrashSplashdown);
            GameEvents.onVesselWillDestroy.Add(OnVesselWillDestroy);
            GameEvents.onVesselRecoveryProcessingComplete.Add(OnRecoveryComplete);
            // Same process-wide-lifetime rationale as CrashUplink/RecoveryUplink
            // (this uplink's host addon is KSPAddon(once) + DontDestroyOnLoad):
            // unsubscribe only on a return to the main menu.
            GameEvents.onGameSceneLoadRequested.Add(OnSceneUnload);
        }

        private void OnSceneUnload(GameScenes scene)
        {
            if (scene == GameScenes.MAINMENU)
            {
                UnhookGameEvents();
            }
        }

        private void UnhookGameEvents()
        {
            if (!_subscribed)
            {
                return;
            }
            _subscribed = false;

            GameEvents.onCrash.Remove(OnCrash);
            GameEvents.onCrashSplashdown.Remove(OnCrashSplashdown);
            GameEvents.onVesselWillDestroy.Remove(OnVesselWillDestroy);
            GameEvents.onVesselRecoveryProcessingComplete.Remove(OnRecoveryComplete);
            GameEvents.onGameSceneLoadRequested.Remove(OnSceneUnload);
        }

        private void OnCrash(EventReport report) =>
            HandleDestruction(report?.origin?.vessel, FlightEndReason.Crashed);

        private void OnCrashSplashdown(EventReport report) =>
            HandleDestruction(report?.origin?.vessel, FlightEndReason.Crashed);

        private void OnVesselWillDestroy(Vessel vessel) =>
            HandleDestruction(vessel, FlightEndReason.Destroyed);

        /// <summary>
        /// MAIN-THREAD: mirrors <c>CrashUplink.HandleCrash</c>'s de-dupe +
        /// source-side relevance filter exactly (a single death can raise
        /// more than one detector; debris/flag/unknown vessels never
        /// contribute a flight record) and its Crash/CrashSplashdown vs.
        /// Destroyed distinction — <paramref name="reason"/> is
        /// <see cref="FlightEndReason.Crashed"/> for a collision/hard
        /// splashdown detector, <see cref="FlightEndReason.Destroyed"/> for
        /// the catch-all (a non-collision death such as a re-entry burn-up,
        /// which fires no <c>onCrash</c>). The de-dupe window means whichever
        /// detector fires FIRST for a given death wins the reason.
        /// </summary>
        private void HandleDestruction(Vessel? vessel, FlightEndReason reason)
        {
            try
            {
                if (vessel == null || _sampler == null)
                {
                    return;
                }

                var vesselType = vessel.vesselType.ToString();
                if (!CrashPayload.ShouldPublish(vesselType))
                {
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                var vesselId = vessel.id.ToString();
                if (_lastPublishedEndUt.TryGetValue(vesselId, out var previous)
                    && Math.Abs(ut - previous) <= DedupWindowUt)
                {
                    return; // a co-firing detector already signalled this death
                }
                _lastPublishedEndUt[vesselId] = ut;

                _sampler.SignalEnd(vesselId, vessel.vesselName ?? "", reason, ut);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] flight destruction capture failed: " + ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD: mirrors <c>RecoveryUplink.OnRecoveryComplete</c>'s
        /// hook choice (decompile-confirmed — see that class's doc comment)
        /// and relevance filter. Only the completion signal is needed here,
        /// not the rich earned/total breakdown <c>RecoveryUplink</c> already
        /// publishes separately.
        /// </summary>
        private void OnRecoveryComplete(ProtoVessel vessel, MissionRecoveryDialog dialog, float recoveryPercent)
        {
            try
            {
                if (vessel == null || _sampler == null)
                {
                    return;
                }

                var vesselType = vessel.vesselType.ToString();
                if (!CrashPayload.ShouldPublish(vesselType))
                {
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                _sampler.SignalEnd(vessel.vesselID.ToString(), vessel.vesselName ?? "", FlightEndReason.Recovered, ut);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] flight recovery capture failed: " + ex);
            }
        }
    }
}
