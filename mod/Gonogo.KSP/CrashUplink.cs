using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Crash;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The crash event producer: hooks KSP vessel destruction, builds the
    /// single "last notable crash" record, applies the source-side debris
    /// filter, and publishes it on the <c>crash.lastCrash</c> /
    /// <c>crash.hasRecent</c> <see cref="Delivery.ReliableOrdered"/> channels.
    /// Rides the existing spine (publisher → change-gate → reveal gate →
    /// Courier → reliable outbox lane → WS), adding no new engine plumbing,
    /// the ReliableOrdered event lane replays the last crash to a re-connecting
    /// station via keyframe-on-subscribe, which is exactly the "last crash"
    /// semantics.
    ///
    /// <para>A death is <c>onVesselWillDestroy</c>, or
    /// <c>onVesselExplodeGroundCollision</c>, which is raised at the "crashed through
    /// terrain" site while the vessel is still whole and is the only report when
    /// <c>Vessel.Die</c> does not run. Stock raises <c>onCrash</c> /
    /// <c>onCrashSplashdown</c> once for every part that breaks, on a craft that may
    /// fly on, so those only name the cause of a death they coincide with (see
    /// <see cref="VesselDeaths{TRecord, TImpact}"/>). A death is read as it happens
    /// and published from the next tick, once per death.</para>
    ///
    /// <para>The KSP-free record assembly, the debris filter, and the
    /// per-flight stats tracker all live in <c>Sitrep.Host.Crash</c> (mirroring
    /// how <c>CommsCoreUplink</c> delegates to <c>Sitrep.Host.Comms</c>); this
    /// class is only the live-KSP read + GameEvents wiring.</para>
    /// </summary>
    [SitrepUplink("crash")]
    public sealed class CrashUplink : ISitrepUplink
    {
        // How far apart an impact and the death it caused can be: a hard splashdown
        // reports the impact some frames before the part is killed.
        private const double ImpactWindowUt = 2.0;

        private readonly FlightStatsTracker _tracker = new FlightStatsTracker();
        private readonly VesselDeaths<CrashCapture, CrashImpact> _deaths =
            new VesselDeaths<CrashCapture, CrashImpact>(ImpactWindowUt);

        private IChannelPublisher? _lastCrash;
        private IChannelPublisher? _hasRecent;
        private bool _subscribed;

        private static ChannelDeclaration Channel(string topic, Delivery delivery, SampleKind kind) => new ChannelDeclaration
        {
            Kind = kind,
            Requires = Requirement.None,
            Topic = topic,
            // A crash is a flight event at the vessel, so it is Delayed (rides
            // the light-time reveal clock): behaviourally moot at delay 0, and
            // correct once a comms uplink is elected.
            Delay = DelayRole.Delayed,
            Delivery = delivery,
            // Keyframe-on-change with a coarse interval: a crash is a discrete
            // one-shot, so the change-gate + reliable lane deliver each new
            // value and replay the last one to a late subscriber.
            Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "crash",
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(CrashTopics.LastCrashTopic, Delivery.ReliableOrdered, SampleKind.Event),
                Channel(CrashTopics.HasRecentTopic, Delivery.ReliableOrdered, SampleKind.Discrete),
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _lastCrash = host.Publisher(CrashTopics.LastCrashTopic);
            _hasRecent = host.Publisher(CrashTopics.HasRecentTopic);

            // Per-tick main-thread sample of the active vessel, feeding the
            // per-flight stats tracker. Deliberately UN-gated (no subscription
            // prefixes): the maxima and flight log must accumulate across the
            // whole flight regardless of whether any client is watching, so a
            // station that connects after launch still receives a complete
            // crash record. The same tick publishes the deaths the GameEvents
            // callbacks held since the last one.
            host.AddSampledSource(CaptureFlightSample, _ => { });

            HookGameEvents();
        }

        /// <summary>
        /// MAIN-THREAD capture: publishes the deaths held since the last tick, then
        /// folds the active vessel's current flight state into the stats tracker.
        /// Returns null: nothing goes through the off-thread handler.
        /// </summary>
        private object? CaptureFlightSample(KspSnapshot? snapshot)
        {
            PublishDeaths(snapshot?.Ut ?? Planetarium.GetUniversalTime());
            try
            {
                var vessel = ActiveVesselScope.Current;
                if (vessel == null)
                {
                    return null;
                }

                var splashed = vessel.situation == Vessel.Situations.SPLASHED;
                _tracker.Sample(
                    vessel.id.ToString(),
                    snapshot?.Ut ?? Planetarium.GetUniversalTime(),
                    vessel.altitude,
                    vessel.srfSpeed,
                    vessel.horizontalSrfSpeed,
                    vessel.missionTime,
                    vessel.geeForce,
                    splashed);
            }
            catch (Exception)
            {
                // A torn/unloaded vessel read this tick simply contributes no
                // sample: last-known stats stand, retried next tick.
            }
            return null;
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
            GameEvents.onLaunch.Add(OnLaunch);
            GameEvents.onStageSeparation.Add(OnStageSeparation);
            GameEvents.onPartDie.Add(OnPartDie);
            GameEvents.onCrewKilled.Add(OnCrewKilled);
            // The hooks live for the whole process: the addon that hosts this
            // uplink is KSPAddon(once) + DontDestroyOnLoad, so Register runs once,
            // before the main menu, and crash detection must span every flight.
        }

        private void OnLaunch(EventReport report)
        {
            var vessel = report?.origin?.vessel;
            if (vessel == null)
            {
                return;
            }
            _tracker.RecordEvent(vessel.id.ToString(), 0, "Liftoff!!");
        }

        private void OnStageSeparation(EventReport report)
        {
            var vessel = report?.origin?.vessel;
            if (report == null || vessel == null)
            {
                return;
            }
            _tracker.RecordEvent(
                vessel.id.ToString(),
                vessel.missionTime,
                "Separation of stage " + report.stage + " confirmed");
        }

        private void OnPartDie(Part part)
        {
            var vessel = part?.vessel;
            if (vessel == null)
            {
                return;
            }
            _tracker.RecordPartsLost(vessel.id.ToString());
        }

        private void OnCrewKilled(EventReport report)
        {
            var vessel = report?.origin?.vessel;
            if (vessel == null)
            {
                return;
            }
            _tracker.RecordKerbalsKilled(vessel.id.ToString());
        }

        private void OnCrash(EventReport report) => NoteImpact(report, "Crash");

        private void OnCrashSplashdown(EventReport report) => NoteImpact(report, "CrashSplashdown");

        /// <summary>
        /// MAIN-THREAD: one part broke on impact. Stock raises this per part, on a craft
        /// that may fly on, so it is only noted; the craft's death, if this caused one,
        /// arrives through <see cref="OnVesselWillDestroy"/>.
        /// </summary>
        private void NoteImpact(EventReport report, string eventKind)
        {
            try
            {
                var origin = report?.origin;
                var vessel = origin?.vessel;
                if (origin == null || vessel == null)
                {
                    return;
                }
                _deaths.Impact(
                    vessel.id.ToString(),
                    new CrashImpact(eventKind, GameWords.Text(report!.other), report.msg ?? "", FromPart(origin, report.msg ?? "")),
                    Planetarium.GetUniversalTime());
            }
            catch (Exception ex)
            {
                GonogoLog.Error("crash impact read failed", ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD: the vessel is about to be destroyed. Read now, while it is still
        /// whole, and held until the next tick so an impact that caused it can name it.
        /// </summary>
        private void OnVesselWillDestroy(Vessel vessel) => NoteDeath(vessel, "onVesselWillDestroy");

        /// <summary>
        /// MAIN-THREAD: the ground is about to destroy the vessel, raised at the
        /// "crashed through terrain" site before the explosion and before any part
        /// is decoupled, so the record read here is the whole craft. The same death
        /// <see cref="OnVesselWillDestroy"/> reports when <c>Vessel.Die</c> runs, and
        /// the only report when it does not.
        /// </summary>
        private void OnVesselExplodeGroundCollision(Vessel vessel) => NoteDeath(vessel, "onVesselExplodeGroundCollision");

        private void NoteDeath(Vessel vessel, string eventName)
        {
            try
            {
                if (vessel == null)
                {
                    return;
                }

                var vesselType = vessel.vesselType.ToString();
                var active = ActiveVesselScope.Current;
                if (!CrashPayload.ShouldPublish(vesselType))
                {
                    _tracker.Forget(vessel.id.ToString());
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                // One line per vessel that dies: the debris a crash breaks into
                // and the second event the game raises for the same vessel
                // write nothing.
                if (_deaths.Death(vessel.id.ToString(), BuildCapture(vessel, vesselType, ut), ut))
                {
                    GonogoLog.Info("crash", "crash: " + eventName + " vessel " + vessel.id
                        + " type " + vesselType + " active " + (active != null && active.id == vessel.id));
                }
            }
            catch (Exception ex)
            {
                GonogoLog.Error("crash capture failed", ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD: publishes every death held since the last tick.
        /// <see cref="IChannelPublisher.Publish"/> is main-thread-safe (it hands off to the
        /// engine job queue).
        /// </summary>
        private void PublishDeaths(double nowUt)
        {
            foreach (var death in _deaths.Drain(nowUt))
            {
                try
                {
                    if (TerminatedVessels.Covers(death.VesselId, death.Ut))
                    {
                        continue;
                    }
                    var capture = death.Record;
                    var impact = death.Impact;
                    if (impact != null)
                    {
                        capture.EventKind = impact.Kind;
                        capture.What = impact.What;
                        capture.Msg = impact.Msg;
                        capture.PartsLost = new List<LostPart> { impact.Part };
                    }
                    capture.Events.Add(CrashLine(capture.VesselName, capture.EventKind));

                    // The crash is the lost craft's own report, sent over its own link.
                    SayFrom(_lastCrash, capture.VesselId, CrashPayload.Build(capture), death.Ut);
                    SayFrom(_hasRecent, capture.VesselId, CrashPayload.ToWire(new CrashRecent { Recent = true }), death.Ut);
                }
                catch (Exception ex)
                {
                    GonogoLog.Error("crash publish failed", ex);
                }
            }
        }

        private static void SayFrom(IChannelPublisher? publisher, string vesselId, object payload, double ut)
        {
            if (publisher is Sitrep.Host.ICraftSaidPublisher said)
            {
                said.PublishSaidBy(vesselId, payload, ut);
                return;
            }
            publisher?.Publish(payload, ut);
        }

        private CrashCapture BuildCapture(Vessel vessel, string vesselType, double ut)
        {
            var vesselId = vessel.id.ToString();
            var crew = ReadCrew(vessel);
            var capture = new CrashCapture
            {
                VesselId = vesselId,
                EventKind = "Destroyed",
                VesselType = vesselType,
                Latitude = vessel.latitude,
                Longitude = vessel.longitude,
                PartsLost = ReadRemainingParts(vessel),
                Body = vessel.mainBody?.bodyName ?? "",
                FlightStats = _tracker.Snapshot(vesselId, vessel.missionTime),
                VesselName = GameWords.VesselName(vessel),
                Events = new List<string>(_tracker.Events(vesselId)),
                // Everyone aboard died in the crash.
                KerbalsKilled = new List<string>(crew),
                Situation = vessel.situation.ToString(),
                CrewAboard = crew,
                Altitude = vessel.altitude,
                Ut = ut,
            };

            // The flight is over; drop the tracker state so a re-used id
            // (revert / new craft) starts clean.
            _tracker.Forget(vesselId);
            return capture;
        }

        private static string CrashLine(string name, string eventKind)
        {
            switch (eventKind)
            {
                case "CrashSplashdown":
                    return name + " splashed down hard and was destroyed.";
                case "Crash":
                    return name + " was destroyed on impact.";
                default:
                    return name + " was destroyed.";
            }
        }

        private static List<string> ReadCrew(Vessel vessel)
        {
            var names = new List<string>();
            try
            {
                var roster = vessel.GetVesselCrew();
                if (roster != null)
                {
                    foreach (var member in roster)
                    {
                        if (member != null && !string.IsNullOrEmpty(member.name))
                        {
                            names.Add(member.name);
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Crew read on a torn vessel, leave the list as-is.
            }
            return names;
        }

        /// <summary>
        /// A death with no impact (a burn-up) loses whatever remains of the vessel, which is
        /// often nothing: every part cooked off before the vessel was destroyed.
        /// </summary>
        private static List<LostPart> ReadRemainingParts(Vessel vessel)
        {
            var lost = new List<LostPart>();
            try
            {
                if (vessel.parts == null)
                {
                    return lost;
                }
                foreach (var part in vessel.parts)
                {
                    if (part != null)
                    {
                        lost.Add(FromPart(part, ""));
                    }
                }
            }
            catch (Exception)
            {
                // A torn part read, publish whatever was gathered.
            }
            return lost;
        }

        private static LostPart FromPart(Part part, string msg) => new LostPart
        {
            PartId = part.flightID,
            PartName = part.partInfo?.name ?? "",
            PartTitle = part.partInfo?.title ?? "",
            Msg = msg,
        };

        private sealed class CrashImpact
        {
            public CrashImpact(string kind, string what, string msg, LostPart part)
            {
                Kind = kind;
                What = what;
                Msg = msg;
                Part = part;
            }

            public string Kind { get; }
            public string What { get; }
            public string Msg { get; }
            public LostPart Part { get; }
        }
    }
}
