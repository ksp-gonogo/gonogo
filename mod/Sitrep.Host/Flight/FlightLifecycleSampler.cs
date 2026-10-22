using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;

namespace Sitrep.Host.Flight
{
    /// <summary>
    /// KSP-free flight-lifecycle engine: the reusable, headlessly-testable
    /// half of <c>Gonogo.KSP.FlightUplink</c> (mirrors the
    /// <c>VesselViewProvider</c>/<c>VesselEpochSampler</c> split
    /// <c>Gonogo.KSP.VesselUplink</c> already follows). Owns everything the
    /// flight-lifecycle spec calls for except the two GameEvents a tick-driven sampler genuinely
    /// cannot classify on its own (crash vs. destroyed vs. recovered), those
    /// arrive via <see cref="SignalEnd"/> from the KSP-facing uplink and are
    /// drained here, on the Courier thread, at the top of every <see cref="Sample"/>.
    ///
    /// <para><b>Why revert needs no GameEvent hook at all:</b> a revert (or an F9 quickload) is
    /// already, unambiguously signalled by <c>KspSnapshot.Ut</c> jumping
    /// backward: the exact same signal <c>ChannelEngine.ProcessTick</c>
    /// itself uses to trigger <c>Courier.ResetTimeline</c> +
    /// <c>_revealBuffer.Clear()</c>, and the exact same signal
    /// <c>VesselEpochSampler</c> already uses for its own rewind-aware
    /// resync. Driving revert detection off a raw GameEvent instead would
    /// race the engine's own rewind branch: <c>ChannelEngine.ProcessTick</c>
    /// runs its rewind check, then every registered <see cref="ISnapshotSampler"/>,
    /// in that fixed order, every tick: so a publish made from inside
    /// <see cref="Sample"/> is guaranteed to land strictly after this same
    /// tick's <c>_revealBuffer.Clear()</c> (if this tick triggered one),
    /// never at risk of being wiped by the very clear it needs to survive. A
    /// publish fired eagerly off a main-thread GameEvent handler instead has
    /// no such guarantee: it could race ahead of the engine's own tick and
    /// get erased by the same unconditional clear that (correctly) erases a
    /// genuinely un-revealed counterfactual. See
    /// <c>RevertBeforeRevealErasesAReliableOrderedDelayedEventForever</c>
    /// (commit <c>82132a08</c>) for the proof this clear must stay
    /// unconditional, and this class's own <see cref="Sample"/> doc comment
    /// for how sequencing through the sampler sidesteps the race entirely.
    /// </para>
    ///
    /// <para><b>started vs. vesselChanged:</b> <see cref="FlightStarted"/>
    /// fires for a vessel id this session has never announced as started
    /// before (a genuine launch, or deliberately, see <see cref="Sample"/>,
    /// every vessel active immediately after a rewind, even a same-id
    /// quickload-resume, since a rewind is treated as a hard timeline reset
    /// for lifecycle purposes). <see cref="FlightVesselChanged"/> fires on
    /// every other active-vessel-id transition (docking/undocking/
    /// tracking-station reselect): switching focus away from a still-flying
    /// vessel does not end its flight, and switching back to a known one is
    /// not a new flight. An EVA is not one of those transitions any more:
    /// <c>Gonogo.KSP.ActiveVesselScope</c> goes on reporting the craft the
    /// kerbal stepped out of, so the id does not move and no flight changes
    /// hands for the walk outside.</para>
    ///
    /// <para><b>Flight id:</b> minted per flight and opaque, never the vessel's
    /// id. A revert to launch keeps the vessel's <c>Vessel.id</c> while starting a
    /// new flight, so the two cannot be the same value: a flight is told from the
    /// one a revert replaced by its id alone. The vessel's own id is on every
    /// event as <c>VesselId</c>, the key that joins against
    /// <c>VesselIdentity.VesselId</c> and <c>CrashReport.VesselId</c>.</para>
    ///
    /// <para><b>An open flight is announced to whoever has not heard it, not
    /// once per flight.</b> KSP is normally already running when the browser
    /// connects, so the publish a launch makes is dropped by
    /// <c>ChannelEngine.ProcessPublish</c> (which returns early for a topic
    /// nobody is subscribed to) and nothing archives it for a later subscriber
    /// to catch up on. A producer cannot see delivery, so counting our own
    /// publishes answers the wrong question: what matters is whether anyone is
    /// listening who has not been told. <see cref="AnnounceStartedIfUnheard"/>
    /// therefore asks the subscription (the same shape as
    /// <c>Sitrep.Host.Alarms.ScetRosterAudience</c>) and re-announces the open
    /// flight, carrying its original start instant: a flight did not start
    /// when an operator opened the dashboard, and that instant is also what
    /// lets a client tell a re-announce from a revert's genuinely new start
    /// for the same vessel id.</para>
    /// </summary>
    public sealed class FlightLifecycleSampler : ISnapshotSampler
    {
        private readonly IChannelPublisher _current;
        private readonly IChannelPublisher _started;
        private readonly IChannelPublisher _ended;
        private readonly IChannelPublisher _vesselChanged;

        // Is anything subscribed to flight.started right now? Read on the
        // Courier thread, from the same thread-safe mirror ProcessSubscribe
        // maintains, so it answers exactly what the publish this tick enqueues
        // will meet.
        private readonly Func<bool> _startedHasAudience;

        // Main-thread GameEvent -> Courier-thread handoff. ConcurrentQueue is
        // safe for a single-producer(main)/single-consumer(Courier) pair with
        // no locking; every other piece of sampler state below is
        // Courier-thread-only (touched exclusively from Sample), same
        // discipline ChannelEngine's own Courier-owned fields follow.
        private readonly ConcurrentQueue<EndSignal> _pendingEnds = new ConcurrentQueue<EndSignal>();

        private double? _lastUt;

        // Set from the Courier thread when the engine replaces the game's timeline,
        // and read by the next Sample on the same thread. A different game can
        // load at a UT ahead of the last one seen, which a backward-UT check alone
        // reads as time passing.
        private bool _timelineReplaced;

        private string? _lastVesselId;
        private string? _activeVesselId;
        private string _activeVesselName = "";

        private readonly Func<string> _mintFlightId;

        // Every vessel this session has started a flight for, keyed by vessel id.
        // A rewind empties it (the timeline it described is gone), so a vessel
        // that is active afterwards, whatever its id, starts a flight of its own.
        private readonly Dictionary<string, FlightRecord> _flights = new Dictionary<string, FlightRecord>();

        // The most recently ended flight (crash/recovery via ApplyEnd, OR a
        // PRIOR revert), tracked independent of _activeVesselId's null-out,
        // see Sample's rewind branch doc comment for why: an end signalled
        // by ApplyEnd fires the instant KSP reports it live, with NO idea
        // whether the reveal gate has actually let it reach the operator
        // yet (that visibility lives only in ChannelEngine's reveal buffer,
        // which this sampler cannot see). A rewind whose TARGET Ut is at or
        // before this end's Ut means the end happened on the abandoned
        // branch -- possibly never revealed at all -- so it must ALSO be
        // retroactively re-announced as Reverted, or the operator would be
        // left with a flight that silently never closes (crash.*/recovery.*
        // erased, and now nothing on flight.* either). A rewind targeting a
        // Ut AFTER this end is unrelated (the end safely predates the
        // reverted-to point) and leaves it alone.
        private string? _lastEndedVesselId;
        private string? _lastEndedFlightId;
        private string _lastEndedVesselName = "";
        private double _lastEndedUt;

        // The flight id the CURRENT audience has been sent a flight.started
        // for. Cleared the moment nothing is subscribed, because who is in the
        // audience is not observable from here: the only safe reading of
        // "nobody is listening" is that whoever listens next has heard nothing.
        private string? _announcedStartedFlightId;

        private readonly Action<string>? _report;
        private long _endsWithoutStart;

        /// <param name="report">Told, once per occurrence, why an end signal was not published.</param>
        /// <param name="mintFlightId">Makes the id of each new flight. Defaults to a fresh GUID.</param>
        public FlightLifecycleSampler(
            IChannelPublisher current,
            IChannelPublisher started,
            IChannelPublisher ended,
            IChannelPublisher vesselChanged,
            Func<bool> startedHasAudience,
            Action<string>? report = null,
            Func<string>? mintFlightId = null)
        {
            _mintFlightId = mintFlightId ?? (() => Guid.NewGuid().ToString());
            _current = current;
            _started = started;
            _ended = ended;
            _vesselChanged = vesselChanged;
            _startedHasAudience = startedHasAudience;
            _report = report;
        }

        /// <summary>
        /// How many end signals arrived for a vessel this session never announced as
        /// started, and so were not published. Readable from any thread.
        /// </summary>
        public long EndsWithoutStart => Interlocked.Read(ref _endsWithoutStart);

        /// <summary>
        /// Called from a MAIN-THREAD GameEvent handler (crash/recovery
        /// detection: see <c>Gonogo.KSP.FlightUplink</c>) whenever a flight
        /// ends for a reason this sampler's own per-tick vessel-id comparison
        /// cannot distinguish. Thread-safe (enqueue-only); the actual state
        /// mutation + publish happens on the Courier thread, drained at the
        /// top of the next <see cref="Sample"/> call.
        /// </summary>
        public void SignalEnd(string vesselId, string vesselName, FlightEndReason reason, double ut)
        {
            _pendingEnds.Enqueue(new EndSignal(vesselId, vesselName, reason, ut));
        }

        /// <summary>
        /// Courier thread only, from the engine's timeline-reset notification, which
        /// the engine raises before the samplers of the same tick run. A reset that
        /// also sent the clock back is a rewind already. A game loaded at a later UT
        /// is told apart from time passing by this call alone, and ends every open
        /// flight the way a revert does.
        /// </summary>
        public void NoteTimelineReset() => _timelineReplaced = true;

        /// <summary>
        /// Courier-thread, tick-driven. Order matters: draining
        /// <see cref="_pendingEnds"/> first means a crash/recovery signalled
        /// just before a rewind is applied before the rewind branch below
        /// re-derives <see cref="_activeVesselId"/> from this tick's
        /// snapshot: so an already-ended flight is never double-ended by
        /// the revert branch too.
        /// </summary>
        public void Sample(KspSnapshot snapshot)
        {
            var currentId = VesselViewProvider.TryGetActiveVesselId(snapshot);
            var endedThisTick = new HashSet<string>();

            while (_pendingEnds.TryDequeue(out var end))
            {
                ApplyEnd(end.VesselId, end.VesselName, end.Reason, end.Ut, currentId, snapshot);
                endedThisTick.Add(end.VesselId);
            }

            // Rewind detection -- mirrors VesselEpochSampler.Sample exactly
            // (see that class's doc comment for the full rationale): by the
            // time THIS Sample call observes a backward Ut, ChannelEngine.
            // ProcessTick's own rewind branch has ALREADY run for this same
            // tick, so any publish from here is guaranteed to land on the
            // already-reset timeline. See this class's own doc comment for
            // why that guarantee is exactly what makes revert-handling safe.
            var utWentBack = _lastUt.HasValue && snapshot.Ut < _lastUt.Value;
            var isRewind = utWentBack || _timelineReplaced;
            var replacedForward = _timelineReplaced && !utWentBack;
            _timelineReplaced = false;
            _lastUt = snapshot.Ut;

            if (isRewind)
            {
                EndRevertedFlights(snapshot.Ut, endedThisTick);

                // A game loaded at a later UT has no flight in common with the last
                // end seen, so it must not be announced again by a rewind in this one.
                if (replacedForward)
                {
                    _lastEndedVesselId = null;
                    _lastEndedFlightId = null;
                    _lastEndedVesselName = "";
                }

                // Resync WITHOUT further switch-detection this tick -- a
                // rewind's loaded state can ordinarily show a DIFFERENT
                // vessel than whatever was active immediately pre-rewind;
                // that is an artifact of the rewind, not a genuine switch.
                _lastVesselId = currentId;

                if (currentId != null && !endedThisTick.Contains(currentId))
                {
                    StartNewFlight(currentId, snapshot);
                }

                AnnounceStartedIfUnheard();
                PublishCurrent(snapshot, currentId);
                return;
            }

            if (currentId != null)
            {
                ObserveActiveVessel(currentId, snapshot);
                _lastVesselId = currentId;
            }

            AnnounceStartedIfUnheard();
            PublishCurrent(snapshot, currentId);
        }

        /// <summary>
        /// A rewind discards the timeline every open flight was flying on, so
        /// each ends Reverted, and no vessel's flight carries over: whatever is
        /// active afterwards starts a new one, even with the vessel id it had.
        /// </summary>
        private void EndRevertedFlights(double ut, HashSet<string> endedThisTick)
        {
            foreach (var flight in _flights.Values)
            {
                if (flight.Open)
                {
                    PublishEnded(flight, FlightEndReason.Reverted, ut);
                    flight.Open = false;
                }
            }
            _activeVesselId = null;
            _activeVesselName = "";

            // An end applied this very tick belongs to the flight the sample
            // that follows is about, so it keeps its record.
            foreach (var vesselId in new List<string>(_flights.Keys))
            {
                if (!endedThisTick.Contains(vesselId)) _flights.Remove(vesselId);
            }

            if (_lastEndedVesselId == null || !(_lastEndedUt >= ut)) return;

            // The most recent end (crash/recovery) happened ON the
            // abandoned branch this rewind erases. The end may never have
            // been revealed to an operator at a signal delay, and this
            // sampler cannot see the reveal buffer, so it is announced
            // again as Reverted at the revert-target Ut. A client that
            // already holds the first end for that flight keeps it.
            PublishEnded(_lastEndedFlightId!, _lastEndedVesselId, _lastEndedVesselName, FlightEndReason.Reverted, ut);
            _lastEndedVesselId = null;
            _lastEndedFlightId = null;
            _lastEndedVesselName = "";
        }

        private void ObserveActiveVessel(string currentId, KspSnapshot snapshot)
        {
            if (_lastVesselId == null)
            {
                // Cold start (first-ever observation this session).
                if (_flights.ContainsKey(currentId))
                {
                    _activeVesselId = currentId;
                    _activeVesselName = ReadVesselName(snapshot) ?? _activeVesselName;
                    return;
                }
                StartNewFlight(currentId, snapshot);
                return;
            }
            if (currentId == _lastVesselId) return;

            if (_flights.TryGetValue(currentId, out var known))
            {
                _activeVesselId = currentId;
                _activeVesselName = ReadVesselName(snapshot) ?? _activeVesselName;

                // Switching back onto a known vessel is not a new flight,
                // and the vesselChanged below is what tells the current
                // audience the focus moved: so they count as told, and
                // AnnounceStartedIfUnheard stays quiet for them. It still
                // fires for whoever subscribes after this, because an
                // empty audience clears this the same as any other.
                _announcedStartedFlightId = known.FlightId;
                PublishVesselChanged(known, snapshot, _lastVesselId);
                return;
            }
            PublishVesselChanged(StartNewFlight(currentId, snapshot), snapshot, _lastVesselId);
        }

        private void ApplyEnd(
            string vesselId,
            string vesselName,
            FlightEndReason reason,
            double ut,
            string? currentId,
            KspSnapshot snapshot)
        {
            var seenMidWay = false;
            if (!_flights.ContainsKey(vesselId) && vesselId == currentId)
            {
                // The end was signalled before any sample showed this vessel
                // (a flight that began from a load or revert and ended within
                // the same tick), yet the snapshot says it is the vessel in
                // focus. It was flown, so it gets its start now. A flight still
                // open on another vessel belongs to the timeline this load or
                // revert replaced, so it ends Reverted before the new start
                // takes its place as the open flight.
                if (_activeVesselId != null && _activeVesselId != vesselId)
                {
                    EndOpenFlight(_activeVesselId, FlightEndReason.Reverted, ut);
                    _activeVesselId = null;
                    _activeVesselName = "";
                }
                StartNewFlight(vesselId, snapshot);
                _lastVesselId = vesselId;
                seenMidWay = true;
            }

            if (!_flights.TryGetValue(vesselId, out var flight))
            {
                // A craft nobody flew this session (a vessel destroyed out of
                // focus, say) has no flight to end, and one the sampler did
                // not see start would otherwise vanish without a trace.
                Interlocked.Increment(ref _endsWithoutStart);
                _report?.Invoke(
                    "flight end (" + reason + ") for vessel " + vesselId + " \"" + vesselName
                    + "\" at UT " + ut.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)
                    + " has no start record, not published");
                return;
            }

            // A vessel the game reports lost twice (a crash, then its destruction) ends one flight.
            if (!flight.Open) return;

            flight.Open = false;
            PublishEnded(flight, vesselName, reason, ut);
            if (_activeVesselId == vesselId)
            {
                _activeVesselId = null;
                _activeVesselName = "";
            }

            // A flight met mid-way on a rewind tick ended after the rewind
            // target, so it is not on the abandoned branch the revert erases.
            if (seenMidWay) return;

            _lastEndedVesselId = vesselId;
            _lastEndedFlightId = flight.FlightId;
            _lastEndedVesselName = vesselName;
            _lastEndedUt = ut;
        }

        private FlightRecord StartNewFlight(string vesselId, KspSnapshot snapshot)
        {
            _activeVesselId = vesselId;
            _activeVesselName = ReadVesselName(snapshot) ?? "";
            var flight = new FlightRecord(_mintFlightId(), vesselId, snapshot.Ut, _activeVesselName);
            _flights[vesselId] = flight;

            // This is news to everyone, including an audience that was already
            // told about the flight this one replaces (a revert's restart).
            _announcedStartedFlightId = null;
            AnnounceStartedIfUnheard();
            return flight;
        }

        /// <summary>
        /// Put the open flight's <c>flight.started</c> on the wire for an
        /// audience that has not been told about it, and do nothing at all for
        /// one that has. The sole <c>flight.started</c> publish site, so a
        /// launch nobody was subscribed for cannot be banked as announced: see
        /// the class doc comment for why a producer counting its own publishes
        /// answers the wrong question.
        ///
        /// <para>The payload and the wire stamp both carry the flight's
        /// original start UT rather than now. That keeps the event honest (a
        /// flight begun an hour ago did not begin when someone opened a
        /// dashboard), puts the frame on the timeline where it belongs, and
        /// reveals it immediately, since its signal delay elapsed long ago.</para>
        /// </summary>
        private void AnnounceStartedIfUnheard()
        {
            if (!_startedHasAudience())
            {
                _announcedStartedFlightId = null;
                return;
            }

            if (_activeVesselId == null
                || !_flights.TryGetValue(_activeVesselId, out var flight)
                || _announcedStartedFlightId == flight.FlightId)
            {
                return;
            }

            _announcedStartedFlightId = flight.FlightId;
            _started.Publish(new FlightStarted
            {
                FlightId = flight.FlightId,
                VesselId = flight.VesselId,
                VesselName = _activeVesselName,
                Ut = flight.StartUt,
            }, flight.StartUt);
        }

        private void PublishVesselChanged(FlightRecord flight, KspSnapshot snapshot, string? previousVesselId)
        {
            _vesselChanged.Publish(new FlightVesselChanged
            {
                FlightId = flight.FlightId,
                VesselId = flight.VesselId,
                VesselName = _activeVesselName,
                PreviousVesselId = previousVesselId,
                Ut = snapshot.Ut,
            }, snapshot.Ut);
        }

        /// <summary>
        /// A craft lost to a crash or a destruction says so over its own link,
        /// so the end reaches each centre at that craft's delay and none that had
        /// no route to it. A recovery and a rewind are the ground's own news.
        /// </summary>
        private void EndOpenFlight(string vesselId, FlightEndReason reason, double ut)
        {
            if (!_flights.TryGetValue(vesselId, out var flight) || !flight.Open) return;
            flight.Open = false;
            PublishEnded(flight, reason, ut);
        }

        private void PublishEnded(FlightRecord flight, FlightEndReason reason, double ut)
            => PublishEnded(flight.FlightId, flight.VesselId, flight.VesselName, reason, ut);

        private void PublishEnded(FlightRecord flight, string vesselName, FlightEndReason reason, double ut)
            => PublishEnded(flight.FlightId, flight.VesselId, vesselName, reason, ut);

        private void PublishEnded(string flightId, string vesselId, string vesselName, FlightEndReason reason, double ut)
        {
            var ended = new FlightEnded
            {
                FlightId = flightId,
                VesselId = vesselId,
                VesselName = vesselName,
                Reason = reason,
                Ut = ut,
            };
            if ((reason == FlightEndReason.Crashed || reason == FlightEndReason.Destroyed) && _ended is ICraftSaidPublisher said)
            {
                said.PublishSaidBy(vesselId, ended, ut);
                return;
            }
            _ended.Publish(ended, ut);
        }

        private void PublishCurrent(KspSnapshot snapshot, string? vesselId)
        {
            if (vesselId == null)
            {
                // No active vessel this tick -- nothing to report; the last
                // published value stands (sticky), matching how every
                // vessel.* channel already behaves with no active vessel.
                return;
            }

            // No record means no flight has started for this vessel, so there is no id to name.
            if (!_flights.TryGetValue(vesselId, out var flight)) return;

            var name = ReadVesselName(snapshot) ?? _activeVesselName;
            flight.VesselName = name;
            _current.Publish(new FlightCurrent
            {
                FlightId = flight.FlightId,
                VesselId = vesselId,
                VesselName = name,
                Phase = ReadSituation(snapshot),
            }, snapshot.Ut);
        }

        private static IDictionary<string, object?>? GetVesselIdentityGroup(KspSnapshot? snapshot)
        {
            if (snapshot == null
                || !snapshot.Values.TryGetValue("vessel", out var v)
                || v is not IDictionary<string, object?> vessel)
            {
                return null;
            }

            return vessel.TryGetValue("identity", out var id) && id is IDictionary<string, object?> identity
                ? identity
                : null;
        }

        private static string? ReadVesselName(KspSnapshot snapshot)
        {
            var identity = GetVesselIdentityGroup(snapshot);
            return identity != null ? SnapshotDict.GetString(identity, "name") : null;
        }

        private static Situation ReadSituation(KspSnapshot snapshot)
        {
            var identity = GetVesselIdentityGroup(snapshot);
            return SharedMappers.ParseSituation(identity != null ? SnapshotDict.GetString(identity, "situation") : null);
        }

        private sealed class FlightRecord
        {
            public readonly string FlightId;
            public readonly string VesselId;
            public readonly double StartUt;
            public string VesselName;
            public bool Open = true;

            public FlightRecord(string flightId, string vesselId, double startUt, string vesselName)
            {
                FlightId = flightId;
                VesselId = vesselId;
                StartUt = startUt;
                VesselName = vesselName;
            }
        }

        private readonly struct EndSignal
        {
            public readonly string VesselId;
            public readonly string VesselName;
            public readonly FlightEndReason Reason;
            public readonly double Ut;

            public EndSignal(string vesselId, string vesselName, FlightEndReason reason, double ut)
            {
                VesselId = vesselId;
                VesselName = vesselName;
                Reason = reason;
                Ut = ut;
            }
        }
    }
}
