using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Crash;
using Sitrep.Host.Flight;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The flight-lifecycle producer: hooks KSP's crash/recovery GameEvents
    /// internally and translates them into the clean <c>flight.*</c> contract
    /// (see <c>Sitrep.Contract.Flight.cs</c>'s doc comment for the full
    /// design). Retires the client-side <c>FlightDetector</c> heuristic.
    ///
    /// <para>Everything that a per-tick vessel-id comparison can classify on
    /// its own: a genuine launch, a revert/quickload, an operator switching
    /// active-vessel focus: lives in the KSP-free
    /// <see cref="FlightLifecycleSampler"/>, registered as an
    /// <see cref="ISnapshotSampler"/> (see that class's own doc comment for
    /// why revert needs no GameEvent hook at all). Only the two end reasons a
    /// sampler cannot distinguish (crashed/destroyed vs. recovered) are
    /// hooked here, mirroring <see cref="CrashUplink"/>/<see cref="RecoveryUplink"/>'s
    /// exact GameEvents and filter discipline, independently (zero coupling to
    /// either uplink: see the contract file's "crash/recovery stayed separate"
    /// note for why). A death is <c>onVesselWillDestroy</c>, or
    /// <c>onVesselExplodeGroundCollision</c> where the vessel is about to be
    /// destroyed by the ground and may not reach <c>Vessel.Die</c>; one death is
    /// published once whichever arrives. A per-part <c>onCrash</c> only names it
    /// Crashed (see <see cref="VesselDeaths{TRecord, TImpact}"/>).</para>
    /// </summary>
    [SitrepUplink("flight")]
    public sealed class FlightUplink : ISitrepUplink
    {
        // Mirrors CrashUplink's ImpactWindowUt.
        private const double ImpactWindowUt = 2.0;

        private static readonly object Impacted = new object();

        private readonly VesselDeaths<string, object> _deaths = new VesselDeaths<string, object>(ImpactWindowUt);
        private FlightLifecycleSampler? _sampler;
        private bool _subscribed;

        private static ChannelDeclaration EventChannel(string topic) => new ChannelDeclaration
        {
            Kind = SampleKind.Event,
            Requires = Requirement.None,
            Topic = topic,
            Delay = DelayRole.Delayed,
            Delivery = Delivery.ReliableOrdered,
            Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
        };

        private static ChannelDeclaration ValueChannel(string topic) => new ChannelDeclaration
        {
            Kind = SampleKind.Discrete,
            Requires = Requirement.None,
            Topic = topic,
            Delay = DelayRole.Delayed,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "flight",
            Bundled = true,
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
        /// channel uplink is Healthy once it has registered without error. A flight end that
        /// arrived for a craft with no start record is counted as a fact, since it was not
        /// published.</summary>
        public UplinkHealth Health()
        {
            var unmatched = _sampler?.EndsWithoutStart ?? 0;
            if (unmatched == 0)
            {
                return UplinkHealth.Healthy;
            }
            return new UplinkHealth(
                UplinkHealthState.Healthy,
                null,
                new[] { new UplinkHealthFact("Flight ends with no start record", unmatched.ToString()) });
        }

        public void Register(IUplinkHost host)
        {
            _sampler = new FlightLifecycleSampler(
                host.Publisher(FlightTopics.CurrentTopic),
                host.Publisher(FlightTopics.StartedTopic),
                host.Publisher(FlightTopics.EndedTopic),
                host.Publisher(FlightTopics.VesselChangedTopic),
                // KSP boots long before a browser does, so the flight that is
                // already in the air when someone opens the dashboard has to be
                // announced to them. See FlightLifecycleSampler's doc comment.
                () => host.IsAnyTopicSubscribed(FlightTopics.StartedTopic),
                GonogoLog.Sink);
            host.AddSampler(_sampler);
            host.AddSampledSource(SignalDeaths, _ => { });

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
            GameEvents.onVesselExplodeGroundCollision.Add(OnVesselExplodeGroundCollision);
            GameEvents.onVesselRecovered.Add(OnVesselRecovered);
            GameEvents.onVesselTerminated.Add(OnVesselTerminated);
            // The hooks live for the whole process: Register runs once, before the
            // main menu, and a flight can end in any scene the player reaches.
        }

        private void OnCrash(EventReport report) => NoteImpact(report);

        private void OnCrashSplashdown(EventReport report) => NoteImpact(report);

        /// <summary>MAIN-THREAD: one part broke on impact, on a craft that may fly on.</summary>
        private void NoteImpact(EventReport report)
        {
            try
            {
                var vessel = report?.origin?.vessel;
                if (vessel == null)
                {
                    return;
                }
                _deaths.Impact(vessel.id.ToString(), Impacted, Planetarium.GetUniversalTime());
            }
            catch (Exception ex)
            {
                GonogoLog.Error("flight impact read failed", ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD: the vessel is about to be destroyed, which ends its flight. Held
        /// until the next tick so an impact that caused it names the end Crashed rather
        /// than Destroyed. Debris, flags and unknown vessels never end a flight.
        /// </summary>
        private void OnVesselWillDestroy(Vessel vessel) => NoteDeath(vessel);

        /// <summary>
        /// MAIN-THREAD: the ground is about to destroy the vessel, raised at the
        /// "crashed through terrain" site before the explosion and before any part
        /// is decoupled. The same death <see cref="OnVesselWillDestroy"/> reports
        /// when <c>Vessel.Die</c> runs, and the only report when it does not.
        /// </summary>
        private void OnVesselExplodeGroundCollision(Vessel vessel) => NoteDeath(vessel);

        private void NoteDeath(Vessel vessel)
        {
            try
            {
                if (vessel == null)
                {
                    return;
                }
                var type = vessel.vesselType.ToString();
                if (!CrashPayload.ShouldPublish(type))
                {
                    return;
                }
                _deaths.Death(vessel.id.ToString(), GameWords.VesselName(vessel), Planetarium.GetUniversalTime());
            }
            catch (Exception ex)
            {
                GonogoLog.Error("flight destruction capture failed", ex);
            }
        }

        /// <summary>MAIN-THREAD: signals every flight end held since the last tick.</summary>
        private object? SignalDeaths(KspSnapshot? snapshot)
        {
            if (_sampler == null)
            {
                return null;
            }
            foreach (var death in _deaths.Drain(snapshot?.Ut ?? Planetarium.GetUniversalTime()))
            {
                var terminated = TerminatedVessels.Covers(death.VesselId, death.Ut);
                var reason = terminated
                    ? FlightEndReason.Terminated
                    : death.Impact != null ? FlightEndReason.Crashed : FlightEndReason.Destroyed;
                _sampler.SignalEnd(death.VesselId, death.Record, reason, death.Ut);
            }
            return null;
        }

        /// <summary>
        /// MAIN-THREAD: the player ended the vessel from the Tracking Station. Noted for
        /// the destruction stock raises with it, which then ends the flight as
        /// Terminated rather than Destroyed.
        /// </summary>
        private void OnVesselTerminated(ProtoVessel vessel)
        {
            if (vessel != null)
            {
                TerminatedVessels.Note(vessel.vesselID.ToString(), Planetarium.GetUniversalTime());
            }
        }

        /// <summary>
        /// MAIN-THREAD: a recovery ends the flight. Hooked on <c>onVesselRecovered</c>, which
        /// stock fires first and for every game mode, rather than on the post-recovery summary
        /// event: that one is raised only once the summary is processed, and a save that
        /// awards nothing gives it no dialog. Only the completion is needed here, not the
        /// earned and total figures <c>RecoveryUplink</c> publishes separately; the relevance
        /// filter is the same.
        /// </summary>
        private void OnVesselRecovered(ProtoVessel vessel, bool quick)
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
                var vesselId = vessel.vesselID.ToString();
                if (!_deaths.TryEnd(vesselId, ut))
                {
                    return;
                }

                _sampler.SignalEnd(vesselId, GameWords.VesselName(vessel.vesselName), FlightEndReason.Recovered, ut);
            }
            catch (Exception ex)
            {
                GonogoLog.Error("flight recovery capture failed", ex);
            }
        }
    }
}
