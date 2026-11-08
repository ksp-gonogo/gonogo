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

        // Main thread only. A dock or a grab keeps one of the two craft as the
        // vessel and destroys the other without raising onVesselWillDestroy, so the
        // absorbed craft is told by its persistent id changing while a couple is in
        // progress, and its end is signalled when the destroy that follows names it.
        private bool _coupling;
        private readonly Dictionary<uint, JoinedCraft> _absorbed = new Dictionary<uint, JoinedCraft>();

        private readonly struct JoinedCraft
        {
            public JoinedCraft(string vesselId, string vesselName)
            {
                VesselId = vesselId;
                VesselName = vesselName;
            }

            public string VesselId { get; }
            public string VesselName { get; }
        }

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
            (host as Sitrep.Host.Comms.ICraftStateHost)?.OnTimelineReset(_sampler.NoteTimelineReset);
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
            GameEvents.onCrewBoardVessel.Add(OnCrewBoardVessel);
            GameEvents.onVesselsUndocking.Add(OnVesselsUndocking);
            GameEvents.onPartCouple.Add(OnPartCouple);
            GameEvents.onPartCoupleComplete.Add(OnPartCoupleComplete);
            GameEvents.onVesselPersistentIdChanged.Add(OnVesselPersistentIdChanged);
            GameEvents.onVesselDestroy.Add(OnVesselDestroy);
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
        private void OnVesselExplodeGroundCollision(Vessel vessel) => NoteDeath(vessel, collision: true);

        private void NoteDeath(Vessel vessel, bool collision = false)
        {
            try
            {
                if (vessel == null)
                {
                    return;
                }
                var type = vessel.vesselType.ToString();
                if (!CrashPayload.ShouldPublish(type) || BoardedVessels.Covers(vessel.id.ToString(), Planetarium.GetUniversalTime()))
                {
                    return;
                }
                var id = vessel.id.ToString();
                var name = GameWords.VesselName(vessel);
                var ut = Planetarium.GetUniversalTime();
                if (collision)
                {
                    _deaths.DeathByCollision(id, name, Impacted, ut);
                    return;
                }
                _deaths.Death(id, name, ut);
            }
            catch (Exception ex)
            {
                GonogoLog.Error("flight destruction capture failed", ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD: a kerbal got back into a craft. Stock then destroys the kerbal's own
        /// vessel, which is no loss, so it is noted for every detector that reads destructions.
        /// </summary>
        private void OnCrewBoardVessel(GameEvents.FromToAction<Part, Part> action)
        {
            var vessel = action.from != null ? action.from.vessel : null;
            if (vessel != null)
            {
                BoardedVessels.Note(vessel.id.ToString(), Planetarium.GetUniversalTime());
            }
        }

        /// <summary>MAIN-THREAD: two parts are being coupled, a dock or a grab by a claw.</summary>
        private void OnPartCouple(GameEvents.FromToAction<Part, Part> action)
        {
            _coupling = true;
        }

        /// <summary>MAIN-THREAD: the couple is done, so no absorbed craft is still waiting for its destroy.</summary>
        private void OnPartCoupleComplete(GameEvents.FromToAction<Part, Part> action)
        {
            _coupling = false;
            _absorbed.Clear();
        }

        /// <summary>
        /// MAIN-THREAD: a vessel's persistent id changed from <paramref name="absorbedPid"/> to
        /// <paramref name="survivorPid"/>. While a couple is in progress that is the absorbed craft
        /// naming the one it joined, which is looked up now, before the merge is finished.
        /// </summary>
        private void OnVesselPersistentIdChanged(uint absorbedPid, uint survivorPid)
        {
            try
            {
                if (!_coupling || absorbedPid == survivorPid || _absorbed.ContainsKey(absorbedPid))
                {
                    return;
                }
                var vessels = FlightGlobals.Vessels;
                for (var i = 0; i < vessels.Count; i++)
                {
                    var candidate = vessels[i];
                    if (candidate != null && candidate.persistentId == survivorPid)
                    {
                        _absorbed[absorbedPid] = new JoinedCraft(candidate.id.ToString(), GameWords.VesselName(candidate));
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                GonogoLog.Error("flight dock capture failed", ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD: a vessel was destroyed. One that a couple absorbed ends its flight as
        /// Docked. A death raised through <c>onVesselWillDestroy</c> is a different path and
        /// never reaches this one for an absorbed craft.
        /// </summary>
        private void OnVesselDestroy(Vessel vessel)
        {
            try
            {
                if (vessel == null || _sampler == null || !_absorbed.TryGetValue(vessel.persistentId, out var joined))
                {
                    return;
                }
                _absorbed.Remove(vessel.persistentId);
                if (!CrashPayload.ShouldPublish(vessel.vesselType.ToString()))
                {
                    return;
                }
                _sampler.SignalDocked(vessel.id.ToString(), GameWords.VesselName(vessel), joined.VesselId, joined.VesselName, Planetarium.GetUniversalTime());
            }
            catch (Exception ex)
            {
                GonogoLog.Error("flight dock end failed", ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD: two craft came apart at a port. The one that is not the vessel that
        /// stayed gets its flight now, whoever is flying it.
        /// </summary>
        private void OnVesselsUndocking(Vessel stayed, Vessel released)
        {
            try
            {
                if (released == null || _sampler == null || !CrashPayload.ShouldPublish(released.vesselType.ToString()))
                {
                    return;
                }
                var root = released.rootPart != null ? released.rootPart.flightID.ToString() : null;
                _sampler.SignalReleased(released.id.ToString(), GameWords.VesselName(released), root, Planetarium.GetUniversalTime());
            }
            catch (Exception ex)
            {
                GonogoLog.Error("flight undock capture failed", ex);
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
