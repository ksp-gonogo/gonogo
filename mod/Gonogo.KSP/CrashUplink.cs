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
    /// Courier → reliable outbox lane → WS), adding no new engine plumbing —
    /// the ReliableOrdered event lane replays the last crash to a re-connecting
    /// station via keyframe-on-subscribe, which is exactly the "last crash"
    /// semantics.
    ///
    /// <para>Three destruction detectors are hooked on the main thread:
    /// <c>onCrash</c> / <c>onCrashSplashdown</c> (collision / hard splashdown)
    /// and <c>onVesselWillDestroy</c> (the catch-all for a non-collision death
    /// such as a re-entry burn-up, which fires no <c>onCrash</c>). A single
    /// death can raise more than one of them, so a per-vessel de-dupe on
    /// <c>(id, ut)</c> guarantees one publish per death.</para>
    ///
    /// <para>The KSP-free record assembly, the debris filter, and the
    /// per-flight stats tracker all live in <c>Sitrep.Host.Crash</c> (mirroring
    /// how <c>CommsCoreUplink</c> delegates to <c>Sitrep.Host.Comms</c>); this
    /// class is only the live-KSP read + GameEvents wiring.</para>
    /// </summary>
    [SitrepUplink("crash")]
    public sealed class CrashUplink : ISitrepUplink
    {
        // A single death can raise onCrashSplashdown/onCrash AND
        // onVesselWillDestroy within the same physics frame; the first detector
        // for a given vessel wins and any further detector inside this UT
        // window is suppressed, so one death publishes exactly once.
        private const double DedupWindowUt = 2.0;

        private readonly FlightStatsTracker _tracker = new FlightStatsTracker();
        private readonly Dictionary<string, double> _lastPublishedUt = new Dictionary<string, double>();

        private IChannelPublisher? _lastCrash;
        private IChannelPublisher? _hasRecent;
        private bool _subscribed;

        private static ChannelDeclaration Channel(string topic, Delivery delivery) => new ChannelDeclaration
        {
            Topic = topic,
            // A crash is a flight event at the vessel, so it is Delayed (rides
            // the light-time reveal clock) — behaviourally moot at delay 0, and
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
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(CrashTopics.LastCrashTopic, Delivery.ReliableOrdered),
                Channel(CrashTopics.HasRecent, Delivery.ReliableOrdered),
            },
        };

        public void Register(IUplinkHost host)
        {
            _lastCrash = host.Publisher(CrashTopics.LastCrashTopic);
            _hasRecent = host.Publisher(CrashTopics.HasRecent);

            // Per-tick main-thread sample of the active vessel, feeding the
            // per-flight stats tracker. Deliberately UN-gated (no subscription
            // prefixes): the maxima and flight log must accumulate across the
            // whole flight regardless of whether any client is watching, so a
            // station that connects after launch still receives a complete
            // crash record. The capture publishes nothing itself (returns
            // null) — the crash publish happens from the GameEvents callbacks.
            host.AddSampledSource(CaptureFlightSample, _ => { });

            HookGameEvents();
        }

        /// <summary>
        /// MAIN-THREAD capture: folds the active vessel's current flight state
        /// into the stats tracker. Reads live KSP (main-thread-only), returns
        /// null so nothing is published on the tick path.
        /// </summary>
        private object? CaptureFlightSample(KspSnapshot? snapshot)
        {
            try
            {
                var vessel = FlightGlobals.ActiveVessel;
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
                // sample — last-known stats stand, retried next tick.
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
            GameEvents.onLaunch.Add(OnLaunch);
            GameEvents.onStageSeparation.Add(OnStageSeparation);
            GameEvents.onPartDie.Add(OnPartDie);
            // The addon that hosts this uplink is KSPAddon(once) +
            // DontDestroyOnLoad, so Register runs once for the whole process and
            // these handlers are meant to live process-wide (crash detection
            // must span every flight). Unsubscribe on scene teardown anyway so a
            // hypothetical re-Register can't double-hook.
            GameEvents.onGameSceneLoadRequested.Add(OnSceneUnload);
        }

        private void OnSceneUnload(GameScenes scene)
        {
            // Only tear down when leaving flight back to a non-flight scene;
            // staying subscribed across ordinary flight scene work is intended.
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
            GameEvents.onLaunch.Remove(OnLaunch);
            GameEvents.onStageSeparation.Remove(OnStageSeparation);
            GameEvents.onPartDie.Remove(OnPartDie);
            GameEvents.onGameSceneLoadRequested.Remove(OnSceneUnload);
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

        private void OnCrash(EventReport report) => HandleCrash(report?.origin?.vessel, report, "Crash");

        private void OnCrashSplashdown(EventReport report) =>
            HandleCrash(report?.origin?.vessel, report, "CrashSplashdown");

        private void OnVesselWillDestroy(Vessel vessel) => HandleCrash(vessel, null, "Destroyed");

        /// <summary>
        /// MAIN-THREAD crash handler: filters debris, de-dupes co-firing
        /// detectors, assembles the record from live KSP, and publishes it.
        /// <see cref="IChannelPublisher.Publish"/> is main-thread-safe (it hands
        /// off to the engine job queue), so publishing straight from a
        /// GameEvents callback is correct.
        /// </summary>
        private void HandleCrash(Vessel? vessel, EventReport? report, string eventKind)
        {
            try
            {
                if (vessel == null)
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

                if (_lastPublishedUt.TryGetValue(vesselId, out var previous)
                    && Math.Abs(ut - previous) <= DedupWindowUt)
                {
                    return; // a co-firing detector already published this death
                }
                _lastPublishedUt[vesselId] = ut;

                var capture = BuildCapture(vessel, report, eventKind, vesselType, ut);

                _lastCrash?.Publish(CrashPayload.Build(capture), ut);
                _hasRecent?.Publish(true, ut);

                // The flight is over; drop the tracker state so a re-used id
                // (revert / new craft) starts clean.
                _tracker.Forget(vesselId);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] crash capture failed: " + ex);
            }
        }

        private CrashCapture BuildCapture(Vessel vessel, EventReport? report, string eventKind, string vesselType, double ut)
        {
            var vesselId = vessel.id.ToString();
            var crew = ReadCrew(vessel);

            // Log the crash line before snapshotting so it appears in events[].
            _tracker.RecordEvent(vesselId, vessel.missionTime, CrashLine(vessel, eventKind));

            return new CrashCapture
            {
                VesselId = vesselId,
                EventKind = eventKind,
                What = report?.other ?? "",
                VesselType = vesselType,
                Msg = report?.msg ?? "",
                Latitude = vessel.latitude,
                Longitude = vessel.longitude,
                PartsLost = ReadPartsLost(vessel, report),
                Body = vessel.mainBody?.bodyName ?? "",
                FlightStats = _tracker.Snapshot(vesselId),
                VesselName = vessel.vesselName ?? "",
                Events = new List<string>(_tracker.Events(vesselId)),
                // Everyone aboard died in the crash.
                KerbalsKilled = new List<string>(crew),
                Situation = vessel.situation.ToString(),
                CrewAboard = crew,
                Altitude = vessel.altitude,
                Ut = ut,
            };
        }

        private static string CrashLine(Vessel vessel, string eventKind)
        {
            var name = vessel.vesselName ?? "Vessel";
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
                // Crew read on a torn vessel — leave the list as-is.
            }
            return names;
        }

        private static List<LostPart> ReadPartsLost(Vessel vessel, EventReport? report)
        {
            var lost = new List<LostPart>();
            try
            {
                var origin = report?.origin;
                if (origin != null)
                {
                    // A collision / hard splashdown names the destroyed part.
                    lost.Add(FromPart(origin, report?.msg ?? ""));
                }
                else if (vessel.parts != null)
                {
                    // A non-collision death (burn-up): whatever remains of the
                    // vessel at destruction (often already empty — every part
                    // cooked off before the vessel-destroy fired).
                    foreach (var part in vessel.parts)
                    {
                        if (part != null)
                        {
                            lost.Add(FromPart(part, ""));
                        }
                    }
                }
            }
            catch (Exception)
            {
                // A torn part read — publish whatever was gathered.
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
    }
}
