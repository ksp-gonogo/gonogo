using System.Collections.Concurrent;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Flight
{
    /// <summary>
    /// KSP-free flight-lifecycle engine — the reusable, headlessly-testable
    /// half of <c>Gonogo.KSP.FlightUplink</c> (mirrors the
    /// <c>VesselViewProvider</c>/<c>VesselEpochSampler</c> split
    /// <c>Gonogo.KSP.VesselUplink</c> already follows). Owns everything the
    /// flight-lifecycle spec (<c>docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md</c>)
    /// calls for except the two GameEvents a tick-driven sampler genuinely
    /// cannot classify on its own (crash vs. destroyed vs. recovered) — those
    /// arrive via <see cref="SignalEnd"/> from the KSP-facing uplink and are
    /// drained here, on the Courier thread, at the top of every <see cref="Sample"/>.
    ///
    /// <para><b>Why REVERT needs no GameEvent hook at all (a deliberate
    /// deviation from the spec's suggested <c>onGameStateLoad</c>/
    /// <c>onLevelWasLoaded</c> hook):</b> a revert (or an F9 quickload) is
    /// ALREADY, unambiguously signalled by <c>KspSnapshot.Ut</c> jumping
    /// backward — the exact same signal <c>ChannelEngine.ProcessTick</c>
    /// itself uses to trigger <c>Courier.ResetTimeline</c> +
    /// <c>_revealBuffer.Clear()</c>, and the exact same signal
    /// <c>VesselEpochSampler</c> already uses for its own rewind-aware
    /// resync. Driving revert detection off a raw GameEvent instead would
    /// race the engine's OWN rewind branch: <c>ChannelEngine.ProcessTick</c>
    /// runs its rewind check, THEN every registered <see cref="ISnapshotSampler"/>,
    /// in that fixed order, every tick — so a publish made from INSIDE
    /// <see cref="Sample"/> is GUARANTEED to land strictly after this same
    /// tick's <c>_revealBuffer.Clear()</c> (if this tick triggered one),
    /// never at risk of being wiped by the very clear it needs to survive. A
    /// publish fired eagerly off a main-thread GameEvent handler instead has
    /// no such guarantee — it could race ahead of the engine's own tick and
    /// get erased by the SAME unconditional clear that (correctly) erases a
    /// genuinely un-revealed counterfactual. See
    /// <c>RevertBeforeRevealErasesAReliableOrderedDelayedEventForever</c>
    /// (commit <c>82132a08</c>) for the proof this clear must stay
    /// unconditional, and this class's own <see cref="Sample"/> doc comment
    /// for how sequencing through the sampler sidesteps the race entirely.
    /// </para>
    ///
    /// <para><b>started vs. vesselChanged:</b> <see cref="FlightStarted"/>
    /// fires for a vessel id this SESSION has never announced as started
    /// before (a genuine launch, or — deliberately, see <see cref="Sample"/> —
    /// EVERY vessel active immediately after a rewind, even a same-id
    /// quickload-resume, since a rewind is treated as a hard timeline reset
    /// for lifecycle purposes). <see cref="FlightVesselChanged"/> fires on
    /// every OTHER active-vessel-id transition (docking/undocking/EVA/
    /// tracking-station reselect) — switching focus away from a still-flying
    /// vessel does not end its flight, and switching back to a known one is
    /// not a new flight.</para>
    ///
    /// <para><b>Flight id:</b> the mod-minted "stable id" the spec calls for
    /// is simply <c>Vessel.id</c> (as a string) — the exact currency
    /// <c>VesselIdentity.VesselId</c>/<c>CrashReport.VesselId</c> already use.
    /// No separate id space; <c>FlightId == VesselId</c> always.</para>
    /// </summary>
    public sealed class FlightLifecycleSampler : ISnapshotSampler
    {
        private readonly IChannelPublisher _current;
        private readonly IChannelPublisher _started;
        private readonly IChannelPublisher _ended;
        private readonly IChannelPublisher _vesselChanged;

        // Main-thread GameEvent -> Courier-thread handoff. ConcurrentQueue is
        // safe for a single-producer(main)/single-consumer(Courier) pair with
        // no locking; every other piece of sampler state below is
        // Courier-thread-only (touched exclusively from Sample), same
        // discipline ChannelEngine's own Courier-owned fields follow.
        private readonly ConcurrentQueue<EndSignal> _pendingEnds = new ConcurrentQueue<EndSignal>();

        private double? _lastUt;
        private string? _lastVesselId;
        private string? _activeVesselId;
        private string _activeVesselName = "";

        // The most recently ended flight (crash/recovery via ApplyEnd, OR a
        // PRIOR revert), tracked independent of _activeVesselId's null-out —
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
        private string _lastEndedVesselName = "";
        private double _lastEndedUt;

        // Monotonically-growing for the session -- deliberately never
        // .Remove()'d on end (see the class doc comment's started-vs-
        // vesselChanged note): a destroyed/recovered Vessel.id can never
        // become FlightGlobals.ActiveVessel again in stock KSP, so treating
        // "ever started" as permanent-for-session is strictly safer than
        // trying to track open/closed and risking a spurious double-start.
        private readonly HashSet<string> _startedVesselIds = new HashSet<string>();

        public FlightLifecycleSampler(
            IChannelPublisher current,
            IChannelPublisher started,
            IChannelPublisher ended,
            IChannelPublisher vesselChanged)
        {
            _current = current;
            _started = started;
            _ended = ended;
            _vesselChanged = vesselChanged;
        }

        /// <summary>
        /// Called from a MAIN-THREAD GameEvent handler (crash/recovery
        /// detection — see <c>Gonogo.KSP.FlightUplink</c>) whenever a flight
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
        /// Courier-thread, tick-driven. Order matters: draining
        /// <see cref="_pendingEnds"/> first means a crash/recovery signalled
        /// just before a rewind is applied BEFORE the rewind branch below
        /// re-derives <see cref="_activeVesselId"/> from this tick's
        /// snapshot — so an already-ended flight is never double-ended by
        /// the revert branch too.
        /// </summary>
        public void Sample(KspSnapshot snapshot)
        {
            while (_pendingEnds.TryDequeue(out var end))
            {
                ApplyEnd(end.VesselId, end.VesselName, end.Reason, end.Ut);
            }

            var currentId = VesselViewProvider.TryGetActiveVesselId(snapshot);

            // Rewind detection -- mirrors VesselEpochSampler.Sample exactly
            // (see that class's doc comment for the full rationale): by the
            // time THIS Sample call observes a backward Ut, ChannelEngine.
            // ProcessTick's own rewind branch has ALREADY run for this same
            // tick, so any publish from here is guaranteed to land on the
            // already-reset timeline. See this class's own doc comment for
            // why that guarantee is exactly what makes revert-handling safe.
            var isRewind = _lastUt.HasValue && snapshot.Ut < _lastUt.Value;
            _lastUt = snapshot.Ut;

            if (isRewind)
            {
                if (_activeVesselId != null)
                {
                    PublishEnded(_activeVesselId, _activeVesselName, FlightEndReason.Reverted, snapshot.Ut);
                    _activeVesselId = null;
                    _activeVesselName = "";
                }
                else if (_lastEndedVesselId != null && _lastEndedUt >= snapshot.Ut)
                {
                    // The most recent end (crash/recovery) happened ON the
                    // abandoned branch this rewind erases -- retroactively
                    // re-announce it as Reverted at the revert-target Ut, so
                    // the operator (who may never have seen the original end
                    // reveal at all) still learns this flight is over, and
                    // why. See the field's own doc comment.
                    PublishEnded(_lastEndedVesselId, _lastEndedVesselName, FlightEndReason.Reverted, snapshot.Ut);
                    _lastEndedVesselId = null;
                    _lastEndedVesselName = "";
                }

                // Resync WITHOUT further switch-detection this tick -- a
                // rewind's loaded state can ordinarily show a DIFFERENT
                // vessel than whatever was active immediately pre-rewind;
                // that is an artifact of the rewind, not a genuine switch.
                _lastVesselId = currentId;

                if (currentId != null)
                {
                    StartNewFlight(currentId, snapshot);
                }

                PublishCurrent(snapshot, currentId);
                return;
            }

            if (currentId != null && _lastVesselId != null && currentId != _lastVesselId)
            {
                if (_startedVesselIds.Contains(currentId))
                {
                    _activeVesselId = currentId;
                    _activeVesselName = ReadVesselName(snapshot) ?? _activeVesselName;
                    PublishVesselChanged(currentId, snapshot, _lastVesselId);
                }
                else
                {
                    StartNewFlight(currentId, snapshot);
                    PublishVesselChanged(currentId, snapshot, _lastVesselId);
                }
            }
            else if (currentId != null && _lastVesselId == null)
            {
                // Cold start (first-ever observation this session).
                if (_startedVesselIds.Contains(currentId))
                {
                    _activeVesselId = currentId;
                    _activeVesselName = ReadVesselName(snapshot) ?? _activeVesselName;
                }
                else
                {
                    StartNewFlight(currentId, snapshot);
                }
            }

            if (currentId != null)
            {
                _lastVesselId = currentId;
            }

            PublishCurrent(snapshot, currentId);
        }

        private void ApplyEnd(string vesselId, string vesselName, FlightEndReason reason, double ut)
        {
            if (!_startedVesselIds.Contains(vesselId))
            {
                // Never observed as started this session (e.g. a filtered
                // debris/flag death that never reached SignalEnd, or a
                // duplicate signal) -- nothing to end.
                return;
            }

            PublishEnded(vesselId, vesselName, reason, ut);
            if (_activeVesselId == vesselId)
            {
                _activeVesselId = null;
                _activeVesselName = "";
            }

            _lastEndedVesselId = vesselId;
            _lastEndedVesselName = vesselName;
            _lastEndedUt = ut;
        }

        private void StartNewFlight(string vesselId, KspSnapshot snapshot)
        {
            var name = ReadVesselName(snapshot) ?? "";
            _activeVesselId = vesselId;
            _activeVesselName = name;
            _startedVesselIds.Add(vesselId);
            _started.Publish(new FlightStarted
            {
                FlightId = vesselId,
                VesselId = vesselId,
                VesselName = name,
                Ut = snapshot.Ut,
            }, snapshot.Ut);
        }

        private void PublishVesselChanged(string vesselId, KspSnapshot snapshot, string? previousVesselId)
        {
            _vesselChanged.Publish(new FlightVesselChanged
            {
                FlightId = vesselId,
                VesselId = vesselId,
                VesselName = _activeVesselName,
                PreviousVesselId = previousVesselId,
                Ut = snapshot.Ut,
            }, snapshot.Ut);
        }

        private void PublishEnded(string vesselId, string vesselName, FlightEndReason reason, double ut)
        {
            _ended.Publish(new FlightEnded
            {
                FlightId = vesselId,
                VesselId = vesselId,
                VesselName = vesselName,
                Reason = reason,
                Ut = ut,
            }, ut);
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

            _current.Publish(new FlightCurrent
            {
                FlightId = vesselId,
                VesselId = vesselId,
                VesselName = ReadVesselName(snapshot) ?? _activeVesselName,
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
